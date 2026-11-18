import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// 1С-ийн татаалтыг дуурайлгана (энэ тест 1С руу огт хандахгүй); Postgres нь жинхэнэ (туршилтын) DB.
const cash = vi.hoisted(() => ({ fetch: vi.fn() }));
const usage = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./cash", () => ({ fetchCashBalances: cash.fetch }));
vi.mock("./usage", () => ({ fetchUsage: usage.fetch }));

import { cashSnapshotRows, syncCashBalance, syncSnapshots, syncUsageMonth } from "./snapshots-store";
import { currentMonth, today } from "./dates";

const DAY = "2099-01-15";
const MONTH = "2099-01";
const KINDS = ["cash-balance", "usage-month"];
const clean = async () => {
  await prisma.$executeRaw`DELETE FROM onec_cash_balance WHERE snapshot_date IN (${DAY}::date, ${today()}::date)`;
  await prisma.$executeRaw`DELETE FROM onec_usage_month WHERE month IN (${MONTH}, ${currentMonth()})`;
  await prisma.onecSyncLog.deleteMany({ where: { kind: { in: KINDS }, period: { in: [DAY, MONTH, today(), currentMonth()] } } });
};

describe("мөнгө, зарцуулалтын агшин зураг (sync)", () => {
  beforeEach(async () => {
    cash.fetch.mockReset();
    usage.fetch.mockReset();
    await clean();
  });
  afterEach(clean);

  it("cashSnapshotRows: хоосон бол 0-тэй тэмдэглэгээ мөр", () => {
    expect(cashSnapshotRows([])).toEqual([{ code: "", name: "", balance: 0 }]);
    expect(cashSnapshotRows([{ code: "1101", name: "Касс", balance: 5 }])).toHaveLength(1);
  });

  it("мөнгө: өдрийн мөрүүдийг солино (дахин ажиллуулахад давхардахгүй), sync_log-д ok", async () => {
    cash.fetch.mockResolvedValue([{ code: "1101", name: "Касс", balance: 1000.5 }, { code: "1102", name: "Банк", balance: 2000 }]);
    expect((await syncCashBalance(DAY)).ok).toBe(true);
    cash.fetch.mockResolvedValue([{ code: "1101", name: "Касс", balance: 700 }]);
    expect((await syncCashBalance(DAY)).ok).toBe(true);
    const rows = await prisma.$queryRaw<{ account_code: string; balance: number }[]>`SELECT account_code, balance::float8 AS balance FROM onec_cash_balance WHERE snapshot_date = ${DAY}::date`;
    expect(rows).toEqual([{ account_code: "1101", balance: 700 }]);
    expect(await prisma.onecSyncLog.count({ where: { kind: "cash-balance", period: DAY, ok: true } })).toBe(2);
  });

  it("зарцуулалт: сар бүрт нэг мөр (upsert)", async () => {
    usage.fetch.mockResolvedValue({ totals: { amount: 123.45, documents: 3, materials: 2 } });
    await syncUsageMonth(MONTH);
    usage.fetch.mockResolvedValue({ totals: { amount: 999, documents: 4, materials: 2 } });
    expect((await syncUsageMonth(MONTH)).ok).toBe(true);
    const rows = await prisma.$queryRaw<{ amount: number; documents: number }[]>`SELECT amount::float8 AS amount, documents FROM onec_usage_month WHERE month = ${MONTH}`;
    expect(rows).toEqual([{ amount: 999, documents: 4 }]);
  });

  it("мөнгөний татаалт унасан ч алдаа шидэхгүй, хуучин мөр хэвээр, sync_log-д ok=false", async () => {
    await prisma.$executeRaw`INSERT INTO onec_cash_balance (snapshot_date, account_code, account_name, balance) VALUES (${DAY}::date, '1101', 'Касс', 50)`;
    cash.fetch.mockRejectedValue(new Error("1С холбогдсонгүй"));
    const r = await syncCashBalance(DAY);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("1С холбогдсонгүй");
    expect(await prisma.onecSyncLog.count({ where: { kind: "cash-balance", period: DAY, ok: false } })).toBe(1);
    const rows = await prisma.$queryRaw<{ balance: number }[]>`SELECT balance::float8 AS balance FROM onec_cash_balance WHERE snapshot_date = ${DAY}::date`;
    expect(rows).toEqual([{ balance: 50 }]);
  });

  it("syncSnapshots: мөнгө унасан ч зарцуулалт ажиллана, зарцуулалт унасан ч мөнгө бичигдсэн байна", async () => {
    cash.fetch.mockRejectedValue(new Error("1С холбогдсонгүй"));
    usage.fetch.mockResolvedValue({ totals: { amount: 10, documents: 1, materials: 1 } });
    expect((await syncSnapshots()).map((s) => [s.kind, s.ok])).toEqual([["cash-balance", false], ["usage-month", true]]);

    cash.fetch.mockResolvedValue([{ code: "1101", name: "Касс", balance: 1 }]);
    usage.fetch.mockRejectedValue(new Error("1С 500"));
    expect((await syncSnapshots()).map((s) => [s.kind, s.ok])).toEqual([["cash-balance", true], ["usage-month", false]]);
    const rows = await prisma.$queryRaw<{ balance: number }[]>`SELECT balance::float8 AS balance FROM onec_cash_balance WHERE snapshot_date = ${today()}::date`;
    expect(rows).toEqual([{ balance: 1 }]);
  });
});
