import { describe, expect, it } from "vitest";
import { ACTION_CODES as A, FLAG, STATUS_UNKNOWN, statusToCode, type EngineInput } from "./codes";
import { getHistoryEngineInfo, runHistory } from "./engine";
import { runHistoryJs } from "./engine-js";

// Deterministic fixtures for the C++20 history engine. Every case runs through
// the real WebAssembly build and is cross-checked against the TypeScript
// reference implementation.

const T = 1_700_000_000_000;
const U = STATUS_UNKNOWN;
const st = statusToCode;
const ev = (reqIndex: number, action: number, ms: number, hint = U) => ({ reqIndex, action, timeMs: T + ms, hint });
const req = (current: string) => ({ createdAtMs: T, currentStatus: st(current) });

async function run(input: EngineInput) {
  const { output, engine } = await runHistory(input);
  expect(engine.kind).toBe("wasm");
  const ref = runHistoryJs(input);
  expect(output).toEqual(ref); // C++ and the reference agree on every field
  return output;
}

describe("history engine: loading", () => {
  it("runs the embedded WebAssembly module (not the fallback)", async () => {
    const info = await getHistoryEngineInfo();
    expect(info.kind).toBe("wasm");
    expect(info.version).toBe("1.0.0");
    expect(info.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("history engine: replay", () => {
  const flow = [ev(0, A.SUBMIT, 1000), ev(0, A.APPROVE, 2000), ev(0, A.RESERVE_STOCK, 3000, st("PENDING_BRANCH_APPROVAL")), ev(0, A.APPROVE, 4000)];

  it("reconstructs the status at each moment", async () => {
    const input = (asOfMs: number): EngineInput => ({ asOfMs: T + asOfMs, requests: [req("PENDING_FINANCE_APPROVAL")], events: flow });

    const before = await run(input(500)); // before the first event
    expect(before.statuses[0]).toBe(U);
    expect(before.flags[0] & FLAG.NO_HISTORY).toBeTruthy();
    expect(before.since[0]).toBe(-1);

    const warehouse = await run(input(2500));
    expect(warehouse.statuses[0]).toBe(st("PENDING_WAREHOUSE_CHECK"));
    expect(warehouse.since[0]).toBe(T + 2000);
    expect(warehouse.counters.future).toBe(2);
    expect(warehouse.flags[0] & FLAG.MISMATCH_CURRENT).toBe(0); // later events exist, so not comparable

    const finance = await run(input(10_000));
    expect(finance.statuses[0]).toBe(st("PENDING_FINANCE_APPROVAL"));
    expect(finance.since[0]).toBe(T + 4000);
    expect(finance.flags[0]).toBe(0);
    expect(finance.stages.find((s) => s.status === st("PENDING_FINANCE_APPROVAL"))).toMatchObject({ count: 1, sumSeconds: 6, avgSeconds: 6, medianSeconds: 6, maxSeconds: 6 });
  });

  it("follows return -> resubmit and the full chain to accounting", async () => {
    const out = await run({
      asOfMs: T + 100_000,
      requests: [req("PENDING_DEPARTMENT_APPROVAL"), req("ACCOUNTING_COMPLETED")],
      events: [
        ev(0, A.SUBMIT, 1000), ev(0, A.RETURN, 2000), ev(0, A.RESUBMIT, 3000),
        ev(1, A.SUBMIT, 1000), ev(1, A.APPROVE, 2000), ev(1, A.RESERVE_STOCK, 3000, st("PENDING_BRANCH_APPROVAL")),
        ev(1, A.APPROVE, 4000), ev(1, A.APPROVE, 5000), ev(1, A.APPROVE, 6000), ev(1, A.ACCOUNTING_RECORD, 7000),
      ],
    });
    expect(out.statuses).toEqual([st("PENDING_DEPARTMENT_APPROVAL"), st("ACCOUNTING_COMPLETED")]);
    expect(out.flags).toEqual([0, 0]);
  });

  it("handles cancel and a warehouse check that completes the request", async () => {
    const out = await run({
      asOfMs: T + 100_000,
      requests: [req("CANCELLED"), req("COMPLETED")],
      events: [ev(0, A.SUBMIT, 1000), ev(0, A.CANCEL, 2000), ev(1, A.SUBMIT, 1000), ev(1, A.APPROVE, 2000), ev(1, A.RESERVE_STOCK, 3000, st("COMPLETED"))],
    });
    expect(out.statuses).toEqual([st("CANCELLED"), st("COMPLETED")]);
    expect(out.flags).toEqual([0, 0]);
  });
});

describe("history engine: imperfect audit data", () => {
  it("re-sorts out-of-order events and notes it, without calling it incomplete", async () => {
    const out = await run({ asOfMs: T + 10_000, requests: [req("PENDING_WAREHOUSE_CHECK")], events: [ev(0, A.APPROVE, 2000), ev(0, A.SUBMIT, 1000)] });
    expect(out.statuses[0]).toBe(st("PENDING_WAREHOUSE_CHECK"));
    expect(out.flags[0]).toBe(FLAG.OUT_OF_ORDER);
    expect(out.counters.outOfOrder).toBe(1);
  });

  it("collapses exact duplicate events (same time and action)", async () => {
    const out = await run({ asOfMs: T + 10_000, requests: [req("PENDING_DEPARTMENT_APPROVAL")], events: [ev(0, A.SUBMIT, 1000), ev(0, A.SUBMIT, 1000)] });
    expect(out.statuses[0]).toBe(st("PENDING_DEPARTMENT_APPROVAL"));
    expect(out.flags[0]).toBe(FLAG.DUPLICATE);
    expect(out.counters).toMatchObject({ duplicates: 1, applied: 1 });
  });

  it("orders distinct events with an identical timestamp by their input position", async () => {
    const ordered = await run({ asOfMs: T + 10_000, requests: [req("PENDING_WAREHOUSE_CHECK")], events: [ev(0, A.SUBMIT, 1000), ev(0, A.APPROVE, 1000)] });
    expect(ordered.statuses[0]).toBe(st("PENDING_WAREHOUSE_CHECK"));
    expect(ordered.flags[0]).toBe(FLAG.SAME_TIME);

    // The reverse input order is not guessed at: APPROVE cannot apply to an unknown state.
    const reversed = await run({ asOfMs: T + 10_000, requests: [req("PENDING_DEPARTMENT_APPROVAL")], events: [ev(0, A.APPROVE, 1000), ev(0, A.SUBMIT, 1000)] });
    expect(reversed.flags[0] & FLAG.UNEXPLAINED).toBeTruthy();
    expect(reversed.statuses[0]).toBe(st("PENDING_DEPARTMENT_APPROVAL")); // the later SUBMIT re-establishes a known state
  });

  it("never invents history for a request with no events", async () => {
    const out = await run({ asOfMs: T + 10_000, requests: [req("PENDING_FINANCE_APPROVAL")], events: [] });
    expect(out.statuses[0]).toBe(U);
    expect(out.flags[0]).toBe(FLAG.NO_HISTORY);
    expect(out.statusCounts[U]).toBe(1);
  });

  it("flags a missing event instead of guessing the stage", async () => {
    // SUBMIT -> (missing APPROVE) -> RESERVE_STOCK: the warehouse check cannot follow a department stage.
    const out = await run({ asOfMs: T + 10_000, requests: [req("PENDING_BRANCH_APPROVAL")], events: [ev(0, A.SUBMIT, 1000), ev(0, A.RESERVE_STOCK, 3000, st("PENDING_BRANCH_APPROVAL"))] });
    expect(out.statuses[0]).toBe(U);
    expect(out.flags[0] & FLAG.UNEXPLAINED).toBeTruthy();
    expect(out.counters.unexplained).toBe(1);
  });

  it("does not choose between warehouse outcomes without evidence", async () => {
    const events = [ev(0, A.SUBMIT, 1000), ev(0, A.APPROVE, 2000), ev(0, A.RESERVE_STOCK, 3000, U)];
    const out = await run({ asOfMs: T + 10_000, requests: [req("COMPLETED")], events });
    expect(out.statuses[0]).toBe(U);
    expect(out.flags[0] & FLAG.AMBIGUOUS).toBeTruthy();
    expect(out.counters.ambiguous).toBe(1);
  });

  it("flags a result that contradicts the live status when nothing happened later", async () => {
    const out = await run({ asOfMs: T + 10_000, requests: [req("PENDING_BRANCH_APPROVAL")], events: [ev(0, A.SUBMIT, 1000)] });
    expect(out.statuses[0]).toBe(st("PENDING_DEPARTMENT_APPROVAL"));
    expect(out.flags[0] & FLAG.MISMATCH_CURRENT).toBeTruthy();
  });

  it("ignores events that point at a request that does not exist", async () => {
    const out = await run({ asOfMs: T + 10_000, requests: [req("PENDING_DEPARTMENT_APPROVAL")], events: [ev(0, A.SUBMIT, 1000), ev(7, A.SUBMIT, 1000), ev(-1, A.APPROVE, 1000)] });
    expect(out.statuses).toEqual([st("PENDING_DEPARTMENT_APPROVAL")]);
  });
});

describe("history engine: waiting-time statistics", () => {
  it("computes count, sum, average, median and max per stage (seconds)", async () => {
    // Waiting in finance since the last event: asOf = T + 100s.
    const waits = [10, 20, 40];
    const events = waits.flatMap((w, n) => [ev(n, A.SUBMIT, 0), ev(n, A.APPROVE, 1), ev(n, A.RESERVE_STOCK, 2, st("PENDING_BRANCH_APPROVAL")), ev(n, A.APPROVE, 100_000 - w * 1000)]);
    // plus one request waiting 5s at the branch stage and an even-count stage (10s, 15s) elsewhere
    events.push(ev(3, A.SUBMIT, 0), ev(3, A.APPROVE, 1), ev(3, A.RESERVE_STOCK, 100_000 - 5000, st("PENDING_BRANCH_APPROVAL")));
    events.push(ev(4, A.SUBMIT, 100_000 - 10_000), ev(5, A.SUBMIT, 100_000 - 15_000));
    const requests = [req("PENDING_FINANCE_APPROVAL"), req("PENDING_FINANCE_APPROVAL"), req("PENDING_FINANCE_APPROVAL"), req("PENDING_BRANCH_APPROVAL"), req("PENDING_DEPARTMENT_APPROVAL"), req("PENDING_DEPARTMENT_APPROVAL")];
    const out = await run({ asOfMs: T + 100_000, requests, events });

    const stage = (s: string) => out.stages.find((x) => x.status === st(s))!;
    expect(stage("PENDING_FINANCE_APPROVAL")).toMatchObject({ count: 3, sumSeconds: 70, avgSeconds: 23, medianSeconds: 20, maxSeconds: 40 });
    expect(stage("PENDING_BRANCH_APPROVAL")).toMatchObject({ count: 1, sumSeconds: 5, avgSeconds: 5, medianSeconds: 5, maxSeconds: 5 });
    // even count: median is the rounded mean of the two middle values (same rule as /admin/monitoring)
    expect(stage("PENDING_DEPARTMENT_APPROVAL")).toMatchObject({ count: 2, sumSeconds: 25, avgSeconds: 13, medianSeconds: 13, maxSeconds: 15 });
    expect(out.flags.every((f) => f === 0)).toBe(true);
  });
});

describe("history engine: determinism", () => {
  const base: EngineInput = {
    asOfMs: T + 50_000,
    requests: [req("PENDING_FINANCE_APPROVAL"), req("PENDING_DEPARTMENT_APPROVAL")],
    events: [ev(0, A.SUBMIT, 1000), ev(0, A.APPROVE, 2000), ev(0, A.RESERVE_STOCK, 3000, st("PENDING_BRANCH_APPROVAL")), ev(0, A.APPROVE, 4000), ev(1, A.SUBMIT, 5000)],
  };

  it("gives the identical state hash on every run", async () => {
    const a = await run(base);
    const b = await run(base);
    expect(a.stateHash).toBe(b.stateHash);
    expect(a.stateHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is independent of the order events arrive in when their timestamps differ", async () => {
    const reference = await run(base);
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 25; i++) {
      const events = [...base.events].sort(() => rnd() - 0.5);
      const out = await run({ ...base, events });
      expect(out.statuses).toEqual(reference.statuses);
      expect(out.since).toEqual(reference.since);
      expect(out.stages).toEqual(reference.stages);
    }
  });

  it("agrees with the reference on 400 random scenarios (including invalid data)", async () => {
    let seed = 2026;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let t = 0; t < 400; t++) {
      const nReq = 1 + Math.floor(rnd() * 6);
      const requests = Array.from({ length: nReq }, () => ({ createdAtMs: T, currentStatus: Math.floor(rnd() * 16) }));
      const events = Array.from({ length: Math.floor(rnd() * 30) }, () => ({
        reqIndex: Math.floor(rnd() * (nReq + 1)) - (rnd() < 0.05 ? 1 : 0),
        action: Math.floor(rnd() * 8),
        timeMs: T + Math.floor(rnd() * 12) * 1000,
        hint: rnd() < 0.5 ? 4 : rnd() < 0.5 ? 13 : 15,
      }));
      await run({ asOfMs: T + Math.floor(rnd() * 14) * 1000, requests, events });
    }
  });
});
