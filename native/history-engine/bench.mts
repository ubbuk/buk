// Benchmark for the history engine: WebAssembly (C++20) vs the TypeScript reference.
// Synthetic data only, generated in memory with a seeded PRNG -- nothing here
// touches a database or storage, so it can never mix into real data.
//
//   npx tsx native/history-engine/bench.mts
import { ACTION_CODES as A, statusToCode, STATUS_UNKNOWN, type EngineInput } from "../../lib/monitoring/history/codes.ts";
import { getHistoryEngineInfo, runHistory } from "../../lib/monitoring/history/engine.ts";
import { runHistoryJs } from "../../lib/monitoring/history/engine-js.ts";

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// Each request walks a random prefix of the real approval flow (some are returned and resubmitted).
function synthetic(requests: number): EngineInput {
  const base = Date.UTC(2026, 0, 1);
  const reqs: EngineInput["requests"] = [];
  const events: EngineInput["events"] = [];
  const stage = ["PENDING_DEPARTMENT_APPROVAL", "PENDING_WAREHOUSE_CHECK", "PENDING_BRANCH_APPROVAL", "PENDING_FINANCE_APPROVAL", "PENDING_EXECUTIVE_APPROVAL", "PENDING_ACCOUNTING", "ACCOUNTING_COMPLETED"];
  for (let i = 0; i < requests; i++) {
    let t = base + Math.floor(rnd() * 300) * 86_400_000;
    const created = t;
    const steps = 1 + Math.floor(rnd() * 7);
    const push = (action: number, hint = STATUS_UNKNOWN) => events.push({ reqIndex: i, action, timeMs: (t += 60_000 + Math.floor(rnd() * 7_200_000)), hint });
    push(A.SUBMIT);
    if (steps > 1) push(A.APPROVE);
    if (steps > 2) push(A.RESERVE_STOCK, statusToCode("PENDING_BRANCH_APPROVAL"));
    if (rnd() < 0.15) {
      push(A.RETURN);
      push(A.RESUBMIT);
    }
    for (let s = 3; s < steps; s++) push(s < 6 ? A.APPROVE : A.ACCOUNTING_RECORD);
    reqs.push({ createdAtMs: created, currentStatus: statusToCode(stage[Math.min(steps - 1, 6)]) });
  }
  // Real audit rows arrive in time order; shuffle a little to exercise re-sorting.
  for (let i = events.length - 1; i > 0; i -= 1 + Math.floor(rnd() * 40)) {
    const j = Math.floor(rnd() * i);
    [events[i], events[j]] = [events[j], events[i]];
  }
  return { asOfMs: Date.UTC(2026, 9, 1), requests: reqs, events };
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function time(fn: () => unknown, runs = 5) {
  await fn(); // warm-up (JIT, WASM memory growth)
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    ms.push(performance.now() - t0);
  }
  return median(ms);
}

const info = await getHistoryEngineInfo();
console.log(`engine: ${info.name} ${info.version} (${info.kind}), node ${process.version}`);
console.log("requests    events  | C++/WASM ms | TS reference ms | speed-up | events/s (WASM) | same result");
for (const n of [1_000, 10_000, 100_000, 250_000]) {
  const input = synthetic(n);
  const runs = n >= 100_000 ? 3 : 5;
  const wasm = await time(() => runHistory(input), runs);
  const js = await time(() => runHistoryJs(input), runs);
  const same = (await runHistory(input)).output.stateHash === runHistoryJs(input).stateHash;
  console.log(
    `${String(n).padStart(8)} ${String(input.events.length).padStart(9)}  | ${wasm.toFixed(1).padStart(11)} | ${js.toFixed(1).padStart(15)} | ${(js / wasm).toFixed(1).padStart(7)}x | ${Math.round(input.events.length / (wasm / 1000)).toLocaleString().padStart(15)} | ${same ? "yes" : "NO"}`
  );
}
