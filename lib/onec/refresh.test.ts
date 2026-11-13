import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { acquireLock, getSyncStatus, isLocked, MONTH_STALE_MS, refreshStock, releaseLock, startMonthRefresh, STOCK_MIN_INTERVAL_MS } from "./refresh";

// Real DB (isolated test database); only the outgoing fetch to 1С is replaced. Far-future dates keep this file clear of other data.
const DATE = "2031-03-15";
const MONTH = "2031-03";
const OTHER_MONTH = "2031-04";
const ENV = { ONEC_BASE_URL: "http://1c.test/base", ONEC_USER: "svc", ONEC_PASSWORD: "pw" };

type Mode = "ok" | "fail" | "timeout" | "empty" | "pl-fails";
let mode: Mode = "ok";
const calls: { url: string; init: RequestInit }[] = [];

const stockRow = { org: "Байгууллага", warehouse_code: "00-001", warehouse: "Төв агуулах", item_code: "M1", item: "Бараа", unit: "ш", account: "1510", qty: 5, amount: 500 };
const salesRow = { date: `${MONTH}-02`, org: "o", item_code: "M1", item: "Бараа", unit: "ш", qty: 1, amount: 100, vat: 10, cost: 60, client_code: "C1", client: "Харилцагч", client_reg: "", dept: "", doc: "D1", row_type: "" };
const plRow = { month: MONTH, item_code: "", item: "Орлого", account: "5000", group: "Борлуулалт", side: "income", amount: 100 };
const cashRow = { date: `${MONTH}-03`, account: "1110", client_code: "", client: "", item_code: "", item: "Касс", inflow: 50, outflow: 0, memo: "", doc: "K1" };

const respond = (url: string): Response => {
  if (mode === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  if (mode === "fail") return new Response("1С алдаа", { status: 500 });
  const rows = mode === "empty" ? [] : url.includes("/stock") ? [stockRow] : url.includes("/sales") ? [salesRow] : url.includes("/pl") ? [plRow] : [cashRow];
  // 401 is not retried by the client (the sync backs off 5 s / 10 s on other errors): keeps the test fast
  if (mode === "pl-fails" && url.includes("/pl")) return new Response("no", { status: 401 });
  return new Response(JSON.stringify({ rows, count: rows.length, generated: "x" }), { status: 200 });
};

const dataCalls = () => calls.filter((c) => /\/hs\/dash\//.test(c.url));
const stockRows = () => prisma.onecStock.count({ where: { snapshotDate: new Date(`${DATE}T00:00:00Z`) } });
const monthRows = async () => ({
  sales: await prisma.onecSales.count({ where: { date: { gte: new Date(`${MONTH}-01T00:00:00Z`), lte: new Date(`${MONTH}-31T00:00:00Z`) } } }),
  pl: await prisma.onecPl.count({ where: { month: MONTH } }),
  cash: await prisma.onecCash.count({ where: { date: { gte: new Date(`${MONTH}-01T00:00:00Z`), lte: new Date(`${MONTH}-31T00:00:00Z`) } } }),
});

async function wipe() {
  await prisma.onecStock.deleteMany({ where: { snapshotDate: new Date(`${DATE}T00:00:00Z`) } });
  await prisma.onecSales.deleteMany({ where: { date: { gte: new Date(`${MONTH}-01T00:00:00Z`), lte: new Date(`${OTHER_MONTH}-30T00:00:00Z`) } } });
  await prisma.onecCash.deleteMany({ where: { date: { gte: new Date(`${MONTH}-01T00:00:00Z`), lte: new Date(`${OTHER_MONTH}-30T00:00:00Z`) } } });
  await prisma.onecPl.deleteMany({ where: { month: { in: [MONTH, OTHER_MONTH] } } });
  await prisma.onecSyncLog.deleteMany({ where: { period: { in: [DATE, MONTH, OTHER_MONTH] } } });
  await prisma.$executeRaw`DELETE FROM onec_sync_lock`;
}

beforeAll(wipe);
afterAll(wipe);
beforeEach(async () => {
  await wipe();
  mode = "ok";
  calls.length = 0;
  Object.assign(process.env, ENV);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url);
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

/** Runs the scheduled job when told to, so a test can look at the state while the job has not run yet */
function scheduler() {
  const jobs: (() => Promise<void>)[] = [];
  return { schedule: (job: () => Promise<void>) => void jobs.push(job), runAll: async () => { for (const j of jobs.splice(0)) await j(); }, pending: () => jobs.length };
}

describe("stock: refreshed from 1С on page open", () => {
  it("pulls the snapshot into Postgres, logs it, and reads 1С with GET only", async () => {
    const r = await refreshStock({ date: DATE });
    expect(r.status).toBe("refreshed");
    expect(r.lastSyncedAt).toBeTruthy();
    expect(await stockRows()).toBe(1);
    expect(dataCalls()).toHaveLength(1);
    expect(dataCalls()[0].url).toContain("/hs/dash/stock");
    expect(dataCalls()[0].url).toContain(`asof=${DATE}`);
    for (const c of calls) {
      expect(c.init.method ?? "GET").toBe("GET");
      expect(c.init.body).toBeUndefined();
    }
    expect(await isLocked()).toBe(false);
  });

  it("uses a 10 second timeout and a single attempt (no 5 minute wait, no retries)", async () => {
    mode = "timeout";
    const t0 = Date.now();
    const r = await refreshStock({ date: DATE });
    expect(r.status).toBe("failed");
    expect(dataCalls()).toHaveLength(1); // not 3 retries
    expect(Date.now() - t0).toBeLessThan(3000); // not the 5 s / 10 s back-off of the sync
    expect(dataCalls()[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("calls 1С at most once a minute: any attempt in the last 60 s (success or failure) means Postgres is served", async () => {
    await refreshStock({ date: DATE });
    expect((await refreshStock({ date: DATE })).status).toBe("recent");
    expect((await refreshStock({ date: DATE, now: () => Date.now() + STOCK_MIN_INTERVAL_MS - 5_000 })).status).toBe("recent");
    expect(dataCalls()).toHaveLength(1);
    expect((await refreshStock({ date: DATE, now: () => Date.now() + STOCK_MIN_INTERVAL_MS + 2_000 })).status).toBe("refreshed");
    expect(dataCalls()).toHaveLength(2);
  });

  it("when 1С does not answer, the last saved data is kept and the failure still counts towards the minute", async () => {
    await refreshStock({ date: DATE });
    const before = await prisma.onecSyncLog.findFirstOrThrow({ where: { kind: "stock", ok: true }, orderBy: { finishedAt: "desc" } });
    mode = "timeout";
    const failed = await refreshStock({ date: DATE, now: () => Date.now() + STOCK_MIN_INTERVAL_MS + 2_000 });
    expect(failed.status).toBe("failed");
    expect(await stockRows()).toBe(1); // the saved snapshot is untouched
    expect(failed.lastSyncedAt).toBe(before.finishedAt.toISOString()); // «сүүлийн өгөгдөл: HH:mm» is the last SUCCESSFUL pull
    expect(await prisma.onecSyncLog.count({ where: { kind: "stock", ok: false } })).toBe(1);
    // the dead 1С is not hammered: the next page opens within the minute do not call it
    const callsBefore = dataCalls().length;
    expect((await refreshStock({ date: DATE })).status).toBe("recent");
    expect(dataCalls()).toHaveLength(callsBefore);
    expect(await isLocked()).toBe(false); // the lock is released after a failure too
  });

  it("an HTTP error or an empty answer over existing data keeps the data and reports failed", async () => {
    await refreshStock({ date: DATE });
    mode = "fail";
    expect((await refreshStock({ date: DATE, now: () => Date.now() + 61_000 })).status).toBe("failed");
    expect(await stockRows()).toBe(1);
    mode = "empty"; // 1С answered with 0 rows although Postgres has a snapshot: skipped, reported as failed
    expect((await refreshStock({ date: DATE, now: () => Date.now() + 122_000 })).status).toBe("failed");
    expect(await stockRows()).toBe(1);
  });

  it("many people opening the page at once cause one call to 1С", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => refreshStock({ date: DATE })));
    expect(results.filter((r) => r.status === "refreshed")).toHaveLength(1);
    expect(results.filter((r) => r.status !== "refreshed").every((r) => r.status === "busy" || r.status === "recent")).toBe(true);
    expect(dataCalls()).toHaveLength(1);
  });

  it("a lock held by somebody else means no call to 1С; a lock whose lease ran out is taken over", async () => {
    expect(await acquireLock("someone-else", 60_000)).toBe(true);
    expect((await refreshStock({ date: DATE })).status).toBe("busy");
    expect(dataCalls()).toHaveLength(0);
    await prisma.$executeRaw`UPDATE onec_sync_lock SET locked_until = now() - interval '1 second'`; // the holder died
    expect((await refreshStock({ date: DATE })).status).toBe("refreshed");
    expect(dataCalls()).toHaveLength(1);
  });
});

describe("month (sales, P&L): refreshed in the background; cash is no longer pulled from the 1С HTTP service", () => {
  it("starts when never pulled: returns at once, does the work later, one job at a time, two sequential reads, none for cash (the tab reads OData now)", async () => {
    const s = scheduler();
    const r = await startMonthRefresh(MONTH, s.schedule);
    expect(r.status).toBe("started");
    expect(s.pending()).toBe(1);
    expect(dataCalls()).toHaveLength(0); // the caller did not wait for 1С
    expect(await isLocked()).toBe(true); // the lock is taken before the answer, so no second job can start
    await s.runAll();
    expect(dataCalls().map((c) => c.url.match(/\/hs\/dash\/(\w+)/)![1])).toEqual(["sales", "pl"]);
    expect(await monthRows()).toEqual({ sales: 1, pl: 1, cash: 0 });
    expect(await isLocked()).toBe(false);
    for (const c of calls) expect(c.init.method ?? "GET").toBe("GET");
  });

  it("only the kinds the open tab needs are pulled (Expenses: P&L only, Sales: sales + P&L); the 5 minute limit follows the same kinds", async () => {
    const s = scheduler();
    expect((await startMonthRefresh(MONTH, s.schedule, undefined, ["pl"])).status).toBe("started");
    await s.runAll();
    expect(dataCalls().map((c) => c.url.match(/\/hs\/dash\/(\w+)/)![1])).toEqual(["pl"]);
    expect(await monthRows()).toEqual({ sales: 0, pl: 1, cash: 0 });
    // P&L is fresh, sales was never pulled: the Sales tab may start its own pull right away
    expect((await startMonthRefresh(MONTH, s.schedule, undefined, ["pl"])).status).toBe("recent");
    expect((await startMonthRefresh(MONTH, s.schedule, undefined, ["sales"])).status).toBe("started");
    await s.runAll();
    expect(await monthRows()).toEqual({ sales: 1, pl: 1, cash: 0 });
  });

  it("does nothing while the data is under 5 minutes old, and says when it may be asked again (the button follows the same limit)", async () => {
    const s = scheduler();
    await startMonthRefresh(MONTH, s.schedule);
    await s.runAll();
    const again = await startMonthRefresh(MONTH, s.schedule);
    expect(again.status).toBe("recent");
    if (again.status === "recent") {
      expect(again.retryAfterSeconds).toBeGreaterThan(0);
      expect(again.retryAfterSeconds).toBeLessThanOrEqual(300);
    }
    expect(s.pending()).toBe(0);
    expect(dataCalls()).toHaveLength(2);
    // 4m59s: still fresh; 5m01s: stale again
    expect((await startMonthRefresh(MONTH, s.schedule, () => Date.now() + MONTH_STALE_MS - 1_000)).status).toBe("recent");
    expect((await startMonthRefresh(MONTH, s.schedule, () => Date.now() + MONTH_STALE_MS + 1_000)).status).toBe("started");
  });

  it("only one background job at a time, however many pages ask", async () => {
    const s = scheduler();
    const results = await Promise.all(Array.from({ length: 6 }, () => startMonthRefresh(MONTH, s.schedule)));
    expect(results.filter((r) => r.status === "started")).toHaveLength(1);
    expect(results.filter((r) => r.status !== "started").every((r) => r.status === "busy" || r.status === "recent")).toBe(true);
    expect(s.pending()).toBe(1);
    await s.runAll();
    expect(dataCalls()).toHaveLength(2);
  });

  it("a job running for one month blocks another month too (one pull at a time overall)", async () => {
    const s = scheduler();
    expect((await startMonthRefresh(MONTH, s.schedule)).status).toBe("started");
    expect((await startMonthRefresh(OTHER_MONTH, s.schedule)).status).toBe("busy");
    expect((await refreshStock({ date: DATE })).status).toBe("busy"); // stock waits for the same single slot
  });

  it("one failing source does not stop the others; the lock is released; the status says which one failed", async () => {
    mode = "pl-fails";
    const s = scheduler();
    await startMonthRefresh(MONTH, s.schedule);
    await s.runAll();
    expect(await monthRows()).toEqual({ sales: 1, pl: 0, cash: 0 });
    expect(await isLocked()).toBe(false);
    const status = await getSyncStatus(MONTH);
    expect(status.running).toBe(false);
    expect(status.month.kinds.sales?.ok).toBe(true);
    expect(status.month.kinds.pl?.ok).toBe(false);
    expect(status.month.lastSyncedAt).toBeTruthy();
    // the failed attempt counts too: not retried at once
    expect((await startMonthRefresh(MONTH, s.schedule)).status).toBe("recent");
  });

  it("the status shows the job as running until it is done", async () => {
    const s = scheduler();
    await startMonthRefresh(MONTH, s.schedule);
    expect((await getSyncStatus(MONTH)).running).toBe(true);
    await s.runAll();
    expect((await getSyncStatus(MONTH)).running).toBe(false);
  });

  it("if the job cannot be scheduled the lock is released, not left until it expires", async () => {
    await expect(
      startMonthRefresh(MONTH, () => {
        throw new Error("no scheduler");
      })
    ).rejects.toThrow("no scheduler");
    expect(await isLocked()).toBe(false);
  });

  it("a lock is only released by its holder", async () => {
    expect(await acquireLock("a", 60_000)).toBe(true);
    await releaseLock("b");
    expect(await isLocked()).toBe(true);
    await releaseLock("a");
    expect(await isLocked()).toBe(false);
  });
});
