import {
  ACTION_CODES,
  PENDING_STATUS_CODES,
  STATUS_UNKNOWN,
  type EngineInput,
  type EngineOutput,
  type StageStat,
} from "./codes";
import { runHistoryJs } from "./engine-js";
import { HISTORY_ENGINE_WASM_BASE64, HISTORY_ENGINE_WASM_SHA256 } from "./history-engine.wasm.generated";

// Server-side loader for the C++20 history engine (WebAssembly). The module is
// embedded in the bundle (see native/history-engine/embed.mjs), compiled once
// per process, and cross-checked against the TypeScript reference before it is
// trusted; on any problem the reference implementation runs instead and the
// result says so.

export const HISTORY_ENGINE_NAME = "history-engine";
export const HISTORY_ENGINE_VERSION = "1.0.0";

export type HistoryEngineKind = "wasm" | "js-fallback";
export interface HistoryEngineInfo {
  name: string;
  version: string;
  kind: HistoryEngineKind;
  /** sha256 of the embedded WASM module. */
  wasmSha256: string;
  /** Why WASM was not used, when kind is js-fallback. */
  note?: string;
}

interface Exports {
  he_version: () => number;
  he_begin: (r: number, e: number, asOf: number) => void;
  he_set_request: (i: number, createdAt: number, current: number) => void;
  he_add_event: (r: number, action: number, time: number, hint: number) => void;
  he_run: () => void;
  he_req_status: (i: number) => number;
  he_req_since: (i: number) => number;
  he_req_flags: (i: number) => number;
  he_status_count: (s: number) => number;
  he_stage_stat: (s: number, which: number) => number;
  he_counter: (id: number) => number;
  he_hash_hi: () => number;
  he_hash_lo: () => number;
  _initialize?: () => void;
}

function runWasm(x: Exports, input: EngineInput): EngineOutput {
  const n = input.requests.length;
  x.he_begin(n, input.events.length, input.asOfMs);
  input.requests.forEach((r, i) => x.he_set_request(i, r.createdAtMs, r.currentStatus));
  for (const e of input.events) x.he_add_event(e.reqIndex, e.action, e.timeMs, e.hint);
  x.he_run();

  const statuses: number[] = new Array(n);
  const since: number[] = new Array(n);
  const flags: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    statuses[i] = x.he_req_status(i);
    since[i] = x.he_req_since(i);
    flags[i] = x.he_req_flags(i);
  }
  const statusCounts = Array.from({ length: 16 }, (_, s) => x.he_status_count(s));
  const stages: StageStat[] = PENDING_STATUS_CODES.map((s) => ({
    status: s,
    count: x.he_stage_stat(s, 0),
    sumSeconds: x.he_stage_stat(s, 1),
    avgSeconds: x.he_stage_stat(s, 2),
    medianSeconds: x.he_stage_stat(s, 3),
    maxSeconds: x.he_stage_stat(s, 4),
  }));
  const hex = (v: number) => v.toString(16).padStart(8, "0");
  return {
    statuses,
    since,
    flags,
    statusCounts,
    stages,
    counters: {
      input: x.he_counter(0),
      applied: x.he_counter(1),
      future: x.he_counter(2),
      duplicates: x.he_counter(3),
      outOfOrder: x.he_counter(4),
      sameTime: x.he_counter(5),
      unexplained: x.he_counter(6),
      ambiguous: x.he_counter(7),
    },
    stateHash: hex(x.he_hash_hi()) + hex(x.he_hash_lo()),
  };
}

// Small scripted run used to prove the WASM build and the reference agree.
function selfCheckInput(): EngineInput {
  const A = ACTION_CODES;
  const t = 1_700_000_000_000;
  return {
    asOfMs: t + 100_000,
    requests: [
      { createdAtMs: t, currentStatus: 4 },
      { createdAtMs: t, currentStatus: 14 },
      { createdAtMs: t, currentStatus: 1 },
    ],
    events: [
      { reqIndex: 0, action: A.APPROVE, timeMs: t + 20_000, hint: STATUS_UNKNOWN }, // out of order
      { reqIndex: 0, action: A.SUBMIT, timeMs: t + 10_000, hint: STATUS_UNKNOWN },
      { reqIndex: 0, action: A.RESERVE_STOCK, timeMs: t + 30_000, hint: 4 },
      { reqIndex: 1, action: A.SUBMIT, timeMs: t + 5_000, hint: STATUS_UNKNOWN },
      { reqIndex: 1, action: A.SUBMIT, timeMs: t + 5_000, hint: STATUS_UNKNOWN }, // duplicate
      { reqIndex: 1, action: A.CANCEL, timeMs: t + 6_000, hint: STATUS_UNKNOWN },
      { reqIndex: 2, action: A.SUBMIT, timeMs: t + 200_000, hint: STATUS_UNKNOWN }, // after asOf
    ],
  };
}

const sameOutput = (a: EngineOutput, b: EngineOutput) => JSON.stringify(a) === JSON.stringify(b);

interface Loaded {
  exports: Exports | null;
  info: HistoryEngineInfo;
}

async function load(): Promise<Loaded> {
  const base = { name: HISTORY_ENGINE_NAME, version: HISTORY_ENGINE_VERSION, wasmSha256: HISTORY_ENGINE_WASM_SHA256 };
  try {
    if (typeof WebAssembly === "undefined") throw new Error("WebAssembly дэмжигдэхгүй");
    const bytes = Buffer.from(HISTORY_ENGINE_WASM_BASE64, "base64");
    const compiled = await WebAssembly.compile(bytes);
    // A standalone module may import tiny runtime hooks; the engine needs none.
    const imports: WebAssembly.Imports = {};
    for (const imp of WebAssembly.Module.imports(compiled)) {
      if (imp.kind !== "function") throw new Error(`Дэмжигдээгүй WASM import: ${imp.module}.${imp.name}`);
      (imports[imp.module] ??= {})[imp.name] = () => 0;
    }
    const instance = await WebAssembly.instantiate(compiled, imports);
    const x = instance.exports as unknown as Exports;
    x._initialize?.();
    if (typeof x.he_run !== "function") throw new Error("WASM экспорт дутуу");
    const fixture = selfCheckInput();
    if (!sameOutput(runWasm(x, fixture), runHistoryJs(fixture))) throw new Error("WASM болон JS reference тооцоолол зөрсөн");
    return { exports: x, info: { ...base, kind: "wasm" } };
  } catch (e) {
    return { exports: null, info: { ...base, kind: "js-fallback", note: e instanceof Error ? e.message : "WASM ачаалж чадсангүй" } };
  }
}

const g = globalThis as unknown as { __historyEngine?: Promise<Loaded> };
const loaded = () => (g.__historyEngine ??= load());

export async function getHistoryEngineInfo(): Promise<HistoryEngineInfo> {
  return (await loaded()).info;
}

// The WASM instance keeps one working state, so a run must not be interleaved:
// everything between he_begin and the last getter is synchronous.
export async function runHistory(input: EngineInput): Promise<{ output: EngineOutput; engine: HistoryEngineInfo }> {
  const l = await loaded();
  const output = l.exports ? runWasm(l.exports, input) : runHistoryJs(input);
  return { output, engine: l.info };
}
