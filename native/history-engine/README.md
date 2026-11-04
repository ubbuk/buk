# history-engine (C++20 → WebAssembly, server-side)

Deterministic replay of material-request audit events. It answers "what status
was each request in at moment T, how long had it been waiting, and where were
requests piling up?" for the Time Machine and for historical snapshots.

It is **separate from** `native/timeline-engine` (the 3D animation clock that runs in the browser).

## Contract

| Input | Meaning |
|---|---|
| `asOfMs` | the historical moment |
| requests | `createdAtMs` and the **live** status code (used only to cross-check the result) |
| events | `(requestIndex, action, timeMs, hint)` from `AuditLog` rows (`SUBMIT`, `APPROVE`, `RETURN`, `RESUBMIT`, `RESERVE_STOCK`, `ACCOUNTING_RECORD`, `CANCEL`, `REJECT`) |

| Output | Meaning |
|---|---|
| status / since / flags per request | reconstructed `RequestStatus` (or `UNKNOWN`), when it entered it, data-quality flags |
| status counts, per-stage count / sum / average / median / max waiting seconds | bottleneck analysis for the six waiting stages |
| counters and a 64-bit FNV-1a `stateHash` | determinism probe, stored in every snapshot |

Status codes, action codes and flag bits are shared with TypeScript in
`lib/monitoring/history/codes.ts`.

## How it never invents history

The audit log does not store the status after an event, so the engine replays the
workflow state machine of `lib/workflow.ts`. Anything the log cannot explain is
**flagged, not guessed**, and the caller reports the reconstruction as incomplete:

| Flag | When |
|---|---|
| `NO_HISTORY` | the request existed but no event up to T explains any state |
| `UNEXPLAINED` | an event does not fit the workflow from the prior state (e.g. a missing event) |
| `AMBIGUOUS` | warehouse check could end at the branch approver or at `COMPLETED`, and the data gave no evidence which |
| `MISMATCH_CURRENT` | nothing happened after T, yet the result differs from the live status |
| `DUPLICATE`, `OUT_OF_ORDER`, `SAME_TIME` | informational: exact duplicates collapsed, events re-sorted by time (ties by input order) |

Deterministic by construction: integer milliseconds, stable ordering `(time, input position)`, no clock, no randomness.

## Build and load

```
bash native/history-engine/build.sh            # emsdk on PATH, or C:\emsdk on Windows
bash native/history-engine/build.sh docker     # without emsdk
```

`build.sh` compiles `history_engine.cpp` to `dist/history_engine.wasm` and runs
`embed.mjs`, which writes `lib/monitoring/history/history-engine.wasm.generated.ts`
(the module as base64 plus its SHA-256). **Commit the generated `.ts`:** the production
build does not run Emscripten, and embedding means the API route needs no file access on Vercel.

At runtime `lib/monitoring/history/engine.ts` compiles the module once per process,
runs a scripted fixture through both it and the TypeScript reference
(`engine-js.ts`), and only trusts the WASM build if every field agrees. On any
failure it falls back to the reference and every result says `engine.kind = "js-fallback"` with the reason.

## Tests and benchmark

* `lib/monitoring/history/engine.test.ts`: fixtures for the normal flow, return/resubmit, cancel, out-of-order events, duplicate timestamps, same-timestamp ordering, missing events, ambiguous warehouse outcome, mismatch with live status, invalid indexes, stage statistics, state-hash determinism, shuffle independence and 400 random scenarios (C++ vs reference).
* `lib/monitoring/history/{snapshots,reconstruct}.test.ts`, `lib/storage-list.test.ts`, `app/api/admin/time-machine/route.test.ts`: storage, snapshots, tampering, authorization, end-to-end workflow.
* `npx tsx native/history-engine/bench.mts`: synthetic data only, in memory.

Reference benchmark (Node 24, one run on the development machine, median of 3–5; marshalling included):

| requests | events | C++/WASM | TS reference | speed-up |
|---:|---:|---:|---:|---:|
| 1,000 | 4,195 | 0.9 ms | 5.5 ms | 6.3× |
| 10,000 | 42,887 | 5.2 ms | 37.3 ms | 7.1× |
| 100,000 | 429,102 | 51.7 ms | 357.3 ms | 6.9× |
| 250,000 | 1,075,374 | 111.1 ms | 1,149.8 ms | 10.4× |

Database reads, not the engine, dominate the real cost of a reconstruction.
