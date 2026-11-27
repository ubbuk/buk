import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildCash, type CashEntry, type CashResult } from "./cash";
import { fixtureInputs, K } from "./cash-accounts.fixture";
import { backfillCashLastMoves, CASH_LAST_BACKFILL_KIND, CASH_LAST_KIND, isLastMoveBackfilled, lastMoveRowsOf, readLatestMoves, readMoveBefore, syncCashLastMonth, syncCashLastMoves } from "./cash-last-store";

// «Хөдөлгөөнгүй данс»-ны сүүлийн гүйлгээ: sync (1С-ээс уншиж DB-д бичнэ) ба хуудасны DB уншилт. Бусад тестийн мөртэй мөргөлдөхгүйн тулд өвөрмөц түлхүүр, 2098 оны сарууд.
const TAG = Date.now().toString(36);
const base: CashResult = buildCash(fixtureInputs());
const myKey = (k: string) => `${k}~${TAG}`;
const mine = (key: string) => key.endsWith(`~${TAG}`);

/** Fixture-ийн сарын мэдээг (2026-09) өөр сар, өвөрмөц түлхүүртэй болгоно */
function cashFor(month: string, extra: CashEntry[] = []): CashResult {
  const re = (e: CashEntry): CashEntry => ({ ...e, accountKey: myKey(e.accountKey), ...(e.counterKey ? { counterKey: myKey(e.counterKey) } : {}), date: e.date.replace("2026-09", month) });
  return { ...base, month, accounts: base.accounts.map((a) => ({ ...a, key: myKey(a.key) })), entries: [...base.entries.map(re), ...extra], transfers: base.transfers.map(re) };
}
const KEY = { main: myKey(K.main), usd: myKey(K.usd), cash: myKey(K.cash), hidden: myKey(K.hidden) };
const regulatory = (month: string): CashEntry => ({ ...base.entries[0], id: "reg", accountKey: KEY.main, date: `${month}-30`, docType: "РегламентнаяОперация", amount: 5 });

const cleanup = async () => {
  await prisma.onecCashLastMove.deleteMany({ where: { key: { endsWith: `~${TAG}` } } });
  await prisma.onecSyncLog.deleteMany({ where: { kind: { in: [CASH_LAST_KIND, CASH_LAST_BACKFILL_KIND] }, period: { startsWith: "2098-" } } });
};
beforeEach(cleanup);
afterAll(cleanup);

const rows = async () => (await prisma.onecCashLastMove.findMany({ where: { key: { endsWith: `~${TAG}` } }, orderBy: [{ month: "asc" }, { key: "asc" }] })).map((r) => ({ key: r.key.replace(`~${TAG}`, ""), month: r.month, date: r.lastDate, amount: Number(r.amount) }));

describe("lastMoveRowsOf: сарын мэдээнээс данс бүрийн сүүлийн бодит гүйлгээ", () => {
  it("гүйлгээтэй дансууд (шилжүүлэг ч): огноо, дансны талаас тэмдэгтэй дүн; гүйлгээгүй данс мөргүй", () => {
    const r = lastMoveRowsOf(cashFor("2098-01"));
    const by = Object.fromEntries(r.map((x) => [x.key.replace(`~${TAG}`, ""), x]));
    expect(Object.keys(by).sort()).toEqual([K.cash, K.main, K.usd].sort());
    expect(by[K.main]).toMatchObject({ month: "2098-01", lastDate: "2098-01-07", amount: -300 }); // зарлага 300 ба шилжүүлэг −200 нэг цагтай: эхний (бичилт) нь
    expect(by[K.usd]).toMatchObject({ lastDate: "2098-01-25", amount: -100 });
    expect(by[K.cash]).toMatchObject({ lastDate: "2098-01-25", amount: 100 });
    expect(by[K.hidden]).toBeUndefined();
  });
  it("ханшийн тохируулга (Тогтмол үйлдэл) сүүлийн гүйлгээ БОЛОХГҮЙ", () => {
    const r = lastMoveRowsOf(cashFor("2098-01", [regulatory("2098-01")]));
    expect(r.find((x) => x.key === KEY.main)!.lastDate).toBe("2098-01-07");
  });
});

describe("syncCashLastMonth: 1С-ээс (fetch) уншиж DB-д бичнэ", () => {
  it("сарын мөрүүдийг бичиж, onec_sync_log-д амжилттай гэж тэмдэглэнэ", async () => {
    const fetch = vi.fn(async (m: string) => cashFor(m));
    const r = await syncCashLastMonth("2098-01", fetch);
    expect(r).toMatchObject({ ok: true, rows: 3 });
    expect(fetch).toHaveBeenCalledWith("2098-01");
    expect((await rows()).map((x) => [x.key, x.month, x.date])).toEqual([[K.cash, "2098-01", "2098-01-25"], [K.main, "2098-01", "2098-01-07"], [K.usd, "2098-01", "2098-01-25"]].sort((a, b) => a[0].localeCompare(b[0])));
    expect(await prisma.onecSyncLog.count({ where: { kind: CASH_LAST_KIND, period: "2098-01", ok: true } })).toBe(1);
  });
  it("дахин ажиллуулахад тэр сарын мөрүүд бүхэлд нь солигдоно (давхардахгүй)", async () => {
    await syncCashLastMonth("2098-01", async (m) => cashFor(m));
    await syncCashLastMonth("2098-01", async (m) => ({ ...cashFor(m), entries: cashFor(m).entries.filter((e) => e.accountKey === KEY.main), transfers: [] }));
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: K.main, date: "2098-01-07", amount: -300 }); // бүх гүйлгээг устгасан өгөгдлөөр: үлдсэн нь л
  });
  it("1С алдаа өгвөл хуучин мөр хэвээр, лог ok=false, алдаа шидэхгүй", async () => {
    await syncCashLastMonth("2098-01", async (m) => cashFor(m));
    const r = await syncCashLastMonth("2098-01", async () => {
      throw new Error("1С холбогдсонгүй");
    });
    expect(r).toMatchObject({ ok: false, rows: 0, message: "1С холбогдсонгүй" });
    expect(await rows()).toHaveLength(3);
    expect(await prisma.onecSyncLog.count({ where: { kind: CASH_LAST_KIND, period: "2098-01", ok: false } })).toBe(1);
  });
});

describe("syncCashLastMoves (regular): өмнөх + одоогийн сар", () => {
  it("2 сар дарааллаар, нэг нь унасан ч нөгөө нь үргэлжилнэ", async () => {
    const seen: string[] = [];
    const out = await syncCashLastMoves("2098-02", async (m) => {
      seen.push(m);
      if (m === "2098-01") throw new Error("унасан");
      return cashFor(m);
    });
    expect(seen).toEqual(["2098-01", "2098-02"]);
    expect(out.map((x) => [x.month, x.ok])).toEqual([["2098-01", false], ["2098-02", true]]);
    expect((await rows()).every((x) => x.month === "2098-02")).toBe(true);
  });
  it("өмнөх жилийн 12-р сар: 2098-01-ийн өмнөх нь 2097-12", async () => {
    const seen: string[] = [];
    await syncCashLastMoves("2098-01", async (m) => (seen.push(m), cashFor(m)));
    expect(seen).toEqual(["2097-12", "2098-01"]);
    await prisma.onecCashLastMove.deleteMany({ where: { month: "2097-12", key: { endsWith: `~${TAG}` } } });
    await prisma.onecSyncLog.deleteMany({ where: { kind: CASH_LAST_KIND, period: "2097-12" } });
  });
});

describe("backfillCashLastMoves: анх нэг удаа (≤ 24 сар)", () => {
  const fetchOk = (calls: string[]) => async (m: string) => (calls.push(m), cashFor(m));
  it("сар бүр дараалан, завсарлагатай (хамгийн эхний сарын өмнө үгүй); бичигдсэн сарыг алгасна; бүрэн дуусвал нөхөлтийн лог", async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const r1 = await backfillCashLastMoves({ from: "2098-01", to: "2098-03", pauseSeconds: 7 }, fetchOk(calls), async (ms) => void sleeps.push(ms));
    expect(r1).toEqual({ done: ["2098-01", "2098-02", "2098-03"], skipped: [], failed: [] });
    expect(calls).toEqual(["2098-01", "2098-02", "2098-03"]);
    expect(sleeps).toEqual([7000, 7000]);
    expect(await prisma.onecSyncLog.count({ where: { kind: CASH_LAST_BACKFILL_KIND, period: "2098-01..2098-03", ok: true } })).toBe(1);
    expect(await isLastMoveBackfilled()).toBe(true);

    const calls2: string[] = [];
    const r2 = await backfillCashLastMoves({ from: "2098-01", to: "2098-04", pauseSeconds: 0 }, fetchOk(calls2));
    expect(r2).toEqual({ done: ["2098-04"], skipped: ["2098-01", "2098-02", "2098-03"], failed: [] });
    expect(calls2).toEqual(["2098-04"]);

    const calls3: string[] = [];
    const r3 = await backfillCashLastMoves({ from: "2098-01", to: "2098-02", pauseSeconds: 0, force: true }, fetchOk(calls3));
    expect(r3.done).toEqual(["2098-01", "2098-02"]);
    expect(calls3).toHaveLength(2);
  });
  it("алдаатай сар байвал нөхөлтийн лог бичигдэхгүй («олдсонгүй» гэж хэлэхгүй), бусад сар үргэлжилнэ", async () => {
    const r = await backfillCashLastMoves({ from: "2098-01", to: "2098-02", pauseSeconds: 0 }, async (m) => {
      if (m === "2098-01") throw new Error("унасан");
      return cashFor(m);
    });
    expect(r).toEqual({ done: ["2098-02"], skipped: [], failed: ["2098-01"] });
    expect(await prisma.onecSyncLog.count({ where: { kind: CASH_LAST_BACKFILL_KIND, period: "2098-01..2098-02" } })).toBe(0);
  });
  it("буруу огноо, 24-өөс илүү сар → алдаа (1С руу хандахгүй)", async () => {
    const fetch = vi.fn(async (m: string) => cashFor(m));
    await expect(backfillCashLastMoves({ from: "2098-03", to: "2098-01" }, fetch)).rejects.toThrow();
    await expect(backfillCashLastMoves({ from: "nope", to: "2098-01" }, fetch)).rejects.toThrow();
    await expect(backfillCashLastMoves({ from: "2096-01", to: "2098-02" }, fetch)).rejects.toThrow("24");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("хуудасны уншилт: зөвхөн DB (1С-гүй)", () => {
  beforeEach(async () => {
    await syncCashLastMonth("2098-01", async (m) => cashFor(m));
    await syncCashLastMonth("2098-03", async (m) => ({ ...cashFor(m), entries: cashFor(m).entries.filter((e) => e.accountKey === KEY.main), transfers: [] }));
  });
  it("readLatestMoves: данс бүрийн хамгийн сүүлийн САРЫН сүүлийн гүйлгээ", async () => {
    const latest = await readLatestMoves();
    expect(latest.get(KEY.main)).toEqual({ date: "2098-03-07", amount: -300 }); // 2098-03 нь 2098-01-ээс сүүлийн
    expect(latest.get(KEY.usd)).toEqual({ date: "2098-01-25", amount: -100 }); // 03-д гүйлгээгүй
    expect(latest.has(KEY.hidden)).toBe(false);
    expect([...latest.keys()].filter(mine).length).toBe(3);
  });
  it("readMoveBefore: заасан сараас ӨМНӨХ хамгийн сүүлийн гүйлгээ (тухайн сар орохгүй)", async () => {
    expect(await readMoveBefore(KEY.main, "2098-03")).toEqual({ date: "2098-01-07", amount: -300 });
    expect(await readMoveBefore(KEY.main, "2098-01")).toBeNull();
    expect(await readMoveBefore(KEY.main, "2098-04")).toEqual({ date: "2098-03-07", amount: -300 });
    expect(await readMoveBefore(KEY.hidden, "2098-12")).toBeNull();
  });
});
