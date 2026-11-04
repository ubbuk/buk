import {
  ACTION_CODES,
  FLAG,
  PENDING_STATUS_CODES,
  STATUS_UNKNOWN,
  type EngineInput,
  type EngineOutput,
  type StageStat,
} from "./codes";

// Line-for-line TypeScript port of native/history-engine/history_engine.cpp.
// It is the executable specification the tests compare the WASM build against,
// and the fallback if the WASM module cannot be loaded. Keep in sync.

const S = {
  PENDING_DEPARTMENT: 1,
  RETURNED_DEPARTMENT: 2,
  PENDING_WAREHOUSE: 3,
  PENDING_BRANCH: 4,
  RETURNED_BRANCH: 5,
  PENDING_FINANCE: 6,
  RETURNED_FINANCE: 7,
  PENDING_EXECUTIVE: 8,
  RETURNED_EXECUTIVE: 9,
  PENDING_ACCOUNTING: 10,
  ACCOUNTING_COMPLETED: 11,
  COMPLETED: 13,
  CANCELLED: 14,
} as const;
const STATUS_COUNT = 16;
const A = ACTION_CODES;

function nextStatus(prev: number, action: number, hint: number): { next: number; explained: boolean; ambiguous: boolean } {
  const ok = (next: number) => ({ next, explained: true, ambiguous: false });
  const bad = { next: STATUS_UNKNOWN, explained: false, ambiguous: false };
  switch (action) {
    case A.SUBMIT:
      return ok(S.PENDING_DEPARTMENT);
    case A.CANCEL:
      return ok(S.CANCELLED);
    case A.APPROVE:
      if (prev === S.PENDING_DEPARTMENT) return ok(S.PENDING_WAREHOUSE as number);
      if (prev === S.PENDING_BRANCH) return ok(S.PENDING_FINANCE);
      if (prev === S.PENDING_FINANCE) return ok(S.PENDING_EXECUTIVE);
      if (prev === S.PENDING_EXECUTIVE) return ok(S.PENDING_ACCOUNTING);
      return bad;
    case A.RETURN:
      if (prev === S.PENDING_DEPARTMENT) return ok(S.RETURNED_DEPARTMENT);
      if (prev === S.PENDING_BRANCH) return ok(S.RETURNED_BRANCH);
      if (prev === S.PENDING_FINANCE) return ok(S.RETURNED_FINANCE);
      if (prev === S.PENDING_EXECUTIVE) return ok(S.RETURNED_EXECUTIVE);
      return bad;
    case A.RESUBMIT:
      if (prev === S.RETURNED_DEPARTMENT) return ok(S.PENDING_DEPARTMENT);
      if (prev === S.RETURNED_BRANCH) return ok(S.PENDING_BRANCH);
      if (prev === S.RETURNED_FINANCE) return ok(S.PENDING_FINANCE);
      if (prev === S.RETURNED_EXECUTIVE) return ok(S.PENDING_EXECUTIVE);
      return bad;
    case A.RESERVE_STOCK:
      if (prev === S.PENDING_WAREHOUSE) {
        if (hint === S.PENDING_BRANCH || hint === S.COMPLETED) return ok(hint);
        return { next: STATUS_UNKNOWN, explained: true, ambiguous: true };
      }
      return bad;
    case A.ACCOUNTING_RECORD:
      return prev === S.PENDING_ACCOUNTING ? ok(S.ACCOUNTING_COMPLETED) : bad;
    default:
      return bad; // REJECT and anything unmodelled
  }
}

// 64-bit FNV-1a. BigInt() calls (not literals): the project targets below ES2020.
const FNV_PRIME = BigInt("1099511628211");
const FNV_OFFSET = BigInt("1469598103934665603");
const BYTE = BigInt(255);
function fnv(h: bigint, v: bigint): bigint {
  let x = h;
  for (let i = 0; i < 8; i++) {
    x = x ^ ((v >> BigInt(i * 8)) & BYTE);
    x = BigInt.asUintN(64, x * FNV_PRIME);
  }
  return x;
}

function medianOf(v: number[]): number {
  if (v.length === 0) return 0;
  v.sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

export function runHistoryJs(input: EngineInput): EngineOutput {
  const n = input.requests.length;
  const asOf = input.asOfMs;
  type Ev = { req: number; action: number; time: number; hint: number; seq: number; skip: boolean };
  const evs: Ev[] = input.events.map((e, seq) => ({ req: e.reqIndex, action: e.action, time: e.timeMs, hint: e.hint, seq, skip: false }));
  const buckets: Ev[][] = Array.from({ length: n }, () => []);
  for (const e of evs) if (e.req >= 0 && e.req < n) buckets[e.req].push(e);

  const statuses = new Array<number>(n).fill(STATUS_UNKNOWN);
  const since = new Array<number>(n).fill(-1);
  const flags = new Array<number>(n).fill(0);
  const statusCounts = new Array<number>(STATUS_COUNT).fill(0);
  const c = { input: evs.length, applied: 0, future: 0, duplicates: 0, outOfOrder: 0, sameTime: 0, unexplained: 0, ambiguous: 0 };
  const waits: number[][] = Array.from({ length: STATUS_COUNT }, () => []);

  for (let r = 0; r < n; r++) {
    const list = buckets[r];
    let maxSeen = -Infinity;
    for (const e of list) {
      if (e.time < maxSeen) {
        flags[r] |= FLAG.OUT_OF_ORDER;
        c.outOfOrder++;
      }
      maxSeen = Math.max(maxSeen, e.time);
    }
    list.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.seq - b.seq));
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      const prev = list[i - 1];
      if (cur.time === prev.time) {
        if (cur.action === prev.action) {
          cur.skip = true;
          flags[r] |= FLAG.DUPLICATE;
          c.duplicates++;
        } else {
          flags[r] |= FLAG.SAME_TIME;
          c.sameTime++;
        }
      }
    }

    let status = STATUS_UNKNOWN;
    let sinceMs = -1;
    let applied = 0;
    let later = 0;
    for (const e of list) {
      if (e.skip) continue;
      if (e.time > asOf) {
        later++;
        c.future++;
        continue;
      }
      const res = nextStatus(status, e.action, e.hint);
      applied++;
      c.applied++;
      if (!res.explained) {
        flags[r] |= FLAG.UNEXPLAINED;
        c.unexplained++;
        status = STATUS_UNKNOWN;
      } else if (res.ambiguous) {
        flags[r] |= FLAG.AMBIGUOUS;
        c.ambiguous++;
        status = STATUS_UNKNOWN;
      } else {
        status = res.next;
      }
      sinceMs = e.time;
    }
    if (applied === 0) {
      flags[r] |= FLAG.NO_HISTORY;
      status = STATUS_UNKNOWN;
      sinceMs = -1;
    }
    statuses[r] = status;
    since[r] = sinceMs;
    if (later === 0 && status !== STATUS_UNKNOWN && status !== input.requests[r].currentStatus) flags[r] |= FLAG.MISMATCH_CURRENT;

    statusCounts[status]++;
    if ((PENDING_STATUS_CODES as readonly number[]).includes(status) && sinceMs >= 0) {
      waits[status].push(Math.max(0, Math.floor((asOf - sinceMs) / 1000)));
    }
  }

  const stages: StageStat[] = PENDING_STATUS_CODES.map((s) => {
    const v = waits[s];
    const count = v.length;
    const sum = v.reduce((a, b) => a + b, 0);
    return {
      status: s,
      count,
      sumSeconds: sum,
      avgSeconds: count ? Math.round(sum / count) : 0,
      medianSeconds: medianOf(v),
      maxSeconds: count ? Math.max(...v) : 0,
    };
  });

  let h = FNV_OFFSET;
  h = fnv(h, BigInt(1));
  for (let r = 0; r < n; r++) {
    h = fnv(h, BigInt(statuses[r]));
    h = fnv(h, BigInt.asUintN(64, BigInt(Math.trunc(since[r]))));
    h = fnv(h, BigInt(flags[r]));
  }
  h = fnv(h, BigInt(c.applied));

  return { statuses, since, flags, statusCounts, stages, counters: c, stateHash: h.toString(16).padStart(16, "0") };
}
