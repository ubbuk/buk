import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { PayrollMonth } from "./payroll";
import { candidateMonths, monthsToSync, payrollYears, PAYROLL_LOG_KIND, readPayrollMonths, syncPayroll, writePayrollMonth } from "./payroll-store";

const YEAR = "2098";
const NOW = "2098-04";
const pm = (month: string, accrued = 100): PayrollMonth => ({ month, accrued, employerNdsh: 10, employeeNdsh: 8, hhoat: 5, paidBank: 90, paidCash: 1, closingPayable: 12.5, lines: 7 });
const clean = async () => {
  await prisma.$executeRaw`DELETE FROM onec_payroll_month WHERE month LIKE ${`${YEAR}-%`} OR month LIKE '2097-%'`;
  await prisma.onecSyncLog.deleteMany({ where: { kind: PAYROLL_LOG_KIND, period: { startsWith: "209" } } });
};

describe("татах сарууд", () => {
  it("нэг баазын горимд зөвхөн энэ он; ONEC_BASES-д өмнөх он нэмэгдвэл тэр оныг ч автоматаар", () => {
    expect(payrollYears(NOW, {})).toEqual([YEAR]);
    expect(candidateMonths(NOW, {})).toEqual(["2098-01", "2098-02", "2098-03", "2098-04"]);
    const env = { ONEC_BASES: JSON.stringify({ "2097": "http://h/BUK_2097", [YEAR]: "http://h/BUK_2098", "2099": "http://h/BUK_2099" }) };
    expect(payrollYears(NOW, env)).toEqual(["2097", YEAR]); // ирээдүйн он орохгүй
    expect(candidateMonths(NOW, env)).toHaveLength(12 + 4);
  });

  it("байхгүй бүх сар + сүүлийн 2 сар; бусад сар дахин татагдахгүй", () => {
    expect(monthsToSync(new Set(), NOW, {})).toEqual(["2098-01", "2098-02", "2098-03", "2098-04"]);
    expect(monthsToSync(new Set(["2098-01", "2098-02", "2098-03", "2098-04"]), NOW, {})).toEqual(["2098-03", "2098-04"]);
    expect(monthsToSync(new Set(["2098-01", "2098-03", "2098-04"]), NOW, {})).toEqual(["2098-02", "2098-03", "2098-04"]);
  });
});

describe("цалингийн сарын агшин зураг (Postgres)", () => {
  beforeEach(clean);
  afterEach(clean);

  it("сар бүрт нэг мөр (upsert): дахин ажиллуулахад давхардахгүй, утга шинэчлэгдэнэ", async () => {
    await writePayrollMonth(pm("2098-01", 100));
    await writePayrollMonth(pm("2098-01", 250.75));
    const rows = await readPayrollMonths(YEAR);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ month: "2098-01", accrued: 250.75, employerNdsh: 10, paidBank: 90, closingPayable: 12.5, lines: 7 });
  });

  it("sync: байхгүй сарууд бичигдэнэ, sync_log-д ok; дахин ажиллуулахад зөвхөн сүүлийн 2 сар татагдана", async () => {
    const fetchMonth = vi.fn(async (m: string) => pm(m));
    const first = await syncPayroll(fetchMonth, NOW);
    expect(first.map((s) => [s.period, s.ok])).toEqual([["2098-01", true], ["2098-02", true], ["2098-03", true], ["2098-04", true]]);
    expect((await readPayrollMonths(YEAR)).map((r) => r.month)).toEqual(["2098-01", "2098-02", "2098-03", "2098-04"]);
    expect(await prisma.onecSyncLog.count({ where: { kind: PAYROLL_LOG_KIND, period: { startsWith: "2098" }, ok: true } })).toBe(4);
    fetchMonth.mockClear();
    await syncPayroll(fetchMonth, NOW);
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-03", "2098-04"]);
  });

  it("нэг сар унасан ч бусад үргэлжилнэ, хуучин мөр хэвээр, sync_log-д ok=false", async () => {
    await writePayrollMonth(pm("2098-02", 777));
    const steps = await syncPayroll(async (m) => {
      if (m === "2098-02") throw new Error("1С холбогдсонгүй");
      return pm(m);
    }, "2098-03");
    expect(steps.map((s) => [s.period, s.ok])).toEqual([["2098-01", true], ["2098-02", false], ["2098-03", true]]);
    expect((await readPayrollMonths(YEAR)).find((r) => r.month === "2098-02")?.accrued).toBe(777);
    expect(await prisma.onecSyncLog.count({ where: { kind: PAYROLL_LOG_KIND, period: "2098-02", ok: false } })).toBe(1);
  });

  it("ХҮН, ХЭЛТСИЙН мэдээлэл хадгалагдахгүй: хүснэгтэд зөвхөн нийт дүнгийн багана", async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'onec_payroll_month' ORDER BY ordinal_position`;
    expect(cols.map((c) => c.column_name)).toEqual(["id", "month", "accrued", "employer_ndsh", "employee_ndsh", "hhoat", "paid_bank", "paid_cash", "closing_payable", "lines", "synced_at"]);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE 'onec_payroll%'`;
    expect(tables.map((t) => t.table_name)).toEqual(["onec_payroll_month"]); // ажилтан, хэлтсийн хүснэгт байхгүй
  });
});
