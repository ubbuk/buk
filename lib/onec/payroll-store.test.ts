import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { PayrollMonth } from "./payroll";
import { candidateMonths, MAX_CONSECUTIVE_FAILURES, monthsToSync, payrollYears, PAYROLL_LOG_KIND, readPayrollMonths, syncPayroll, writePayrollMonth } from "./payroll-store";

const YEAR = "2098";
const NOW = "2098-04";
const pm = (month: string, accrued = 100): PayrollMonth => ({ month, accrued, employerNdsh: 10, employeeNdsh: 8, hhoat: 5, paidBank: 90, paidCash: 1, closingPayable: 12.5, lines: 7, benefit: 4, sickPay: 2, board: 20, boardNdsh: 1.5, boardHhoat: 1, boardPaid: 12, otherDeductions: 3 });
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

  it("одоогийн, өмнөх сар түрүүлж, дараа нь байхгүй сарууд (шинээс хуучин); бүгд байвал зөвхөн 2 сар, хуучин сар дахин татагдахгүй", () => {
    expect(monthsToSync(new Set(), NOW, {})).toEqual(["2098-04", "2098-03", "2098-02", "2098-01"]);
    expect(monthsToSync(new Set(["2098-01", "2098-02", "2098-03", "2098-04"]), NOW, {})).toEqual(["2098-04", "2098-03"]);
    expect(monthsToSync(new Set(["2098-01", "2098-03", "2098-04"]), NOW, {})).toEqual(["2098-04", "2098-03", "2098-02"]);
    expect(monthsToSync(new Set(), "2098-01", {})).toEqual(["2098-01"]); // оны эхний сард өмнөх сар (өмнөх он) бааз холбоогүй бол орохгүй
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
    expect(rows[0]).toMatchObject({ month: "2098-01", accrued: 250.75, employerNdsh: 10, paidBank: 90, closingPayable: 12.5, lines: 7, benefit: 4, sickPay: 2, board: 20, boardNdsh: 1.5, boardHhoat: 1, boardPaid: 12, otherDeductions: 3, breakdown: true });
  });

  it("задаргаагүй хуучин мөр (board IS NULL): breakdown=false, нийт дүн хэвээр; sync дахин татаж задаргааг бөглөнө", async () => {
    await prisma.$executeRaw`INSERT INTO onec_payroll_month (month, accrued, employer_ndsh, employee_ndsh, hhoat, paid_bank, paid_cash, closing_payable, lines) VALUES ('2098-01', 500, 1, 1, 1, 1, 1, 1, 1), ('2098-02', 600, 1, 1, 1, 1, 1, 1, 1), ('2098-03', 700, 1, 1, 1, 1, 1, 1, 1)`;
    const old = await readPayrollMonths(YEAR);
    expect(old.map((r) => [r.month, r.accrued, r.breakdown, r.board])).toEqual([["2098-01", 500, false, 0], ["2098-02", 600, false, 0], ["2098-03", 700, false, 0]]);
    const fetchMonth = vi.fn(async (m: string) => pm(m, 111));
    await syncPayroll(fetchMonth, NOW);
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-04", "2098-03", "2098-02", "2098-01"]); // өнгөрсөн сар ч задаргаагүй бол дахин татагдана
    expect((await readPayrollMonths(YEAR)).every((r) => r.breakdown && r.board === 20)).toBe(true);
    fetchMonth.mockClear();
    await syncPayroll(fetchMonth, NOW);
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-04", "2098-03"]); // задаргаатай болсон тул хуучин сар дахин татагдахгүй
  });

  it("sync: байхгүй сарууд бичигдэнэ, sync_log-д ok; дахин ажиллуулахад зөвхөн сүүлийн 2 сар татагдана", async () => {
    const fetchMonth = vi.fn(async (m: string) => pm(m));
    const first = await syncPayroll(fetchMonth, NOW);
    expect(first.map((s) => [s.period, s.ok])).toEqual([["2098-04", true], ["2098-03", true], ["2098-02", true], ["2098-01", true]]);
    expect((await readPayrollMonths(YEAR)).map((r) => r.month)).toEqual(["2098-01", "2098-02", "2098-03", "2098-04"]);
    expect(await prisma.onecSyncLog.count({ where: { kind: PAYROLL_LOG_KIND, period: { startsWith: "2098" }, ok: true } })).toBe(4);
    fetchMonth.mockClear();
    await syncPayroll(fetchMonth, NOW);
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-04", "2098-03"]);
  });

  it("нэг сар унасан ч бусад үргэлжилнэ, хуучин мөр хэвээр, sync_log-д ok=false", async () => {
    await writePayrollMonth(pm("2098-02", 777));
    const steps = await syncPayroll(async (m) => {
      if (m === "2098-02") throw new Error("1С холбогдсонгүй");
      return pm(m);
    }, "2098-03");
    expect(steps.map((s) => [s.period, s.ok])).toEqual([["2098-03", true], ["2098-02", false], ["2098-01", true]]);
    expect((await readPayrollMonths(YEAR)).find((r) => r.month === "2098-02")?.accrued).toBe(777);
    expect(await prisma.onecSyncLog.count({ where: { kind: PAYROLL_LOG_KIND, period: "2098-02", ok: false } })).toBe(1);
  });

  it("бодолтгүй сар (бичилт 0) алдаа биш: ok=true, 0 мөр гэж бүртгэгдэнэ", async () => {
    const steps = await syncPayroll(async (m) => ({ ...pm(m, 0), employerNdsh: 0, employeeNdsh: 0, hhoat: 0, paidBank: 0, paidCash: 0, lines: 0 }), "2098-01");
    expect(steps).toEqual([expect.objectContaining({ period: "2098-01", ok: true, rows: 0 })]);
    expect(await prisma.onecSyncLog.count({ where: { kind: PAYROLL_LOG_KIND, period: "2098-01", ok: true, rows: 0 } })).toBe(1);
    expect(await prisma.onecSyncLog.count({ where: { kind: PAYROLL_LOG_KIND, ok: false, period: { startsWith: "2098" } } })).toBe(0);
    expect((await readPayrollMonths(YEAR))[0]).toMatchObject({ month: "2098-01", accrued: 0, lines: 0 });
  });

  it("нийт хугацааны дээд хязгаар: хэтэрвэл зогсоод үлдсэн сарыг дараагийн удаад үргэлжлүүлнэ (алдаа биш)", async () => {
    let now = 0;
    const fetchMonth = vi.fn(async (m: string) => {
      now += 100_000; // сар бүр 100 сек
      return pm(m);
    });
    const first = await syncPayroll(fetchMonth, NOW, { budgetMs: 180_000, clock: () => now });
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-04", "2098-03"]); // 2 сар = 200 сек > 180: 3 дахь нь эхлэхгүй
    expect(first.some((s) => s.ok === false)).toBe(false);
    expect(first[first.length - 1]).toMatchObject({ period: "stopped", ok: true });
    expect(first[first.length - 1].message).toContain("дараагийн удаа үргэлжилнэ");
    expect(await prisma.onecSyncLog.count({ where: { kind: PAYROLL_LOG_KIND, ok: false, period: { startsWith: "2098" } } })).toBe(0);
    // дараагийн удаа: байгаа 2 сар дахин татагдана (одоогийн, өмнөх), дараа нь үлдсэн байхгүй сарууд
    fetchMonth.mockClear();
    now = 0;
    await syncPayroll(fetchMonth, NOW, { budgetMs: 1_000_000, clock: () => now });
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-04", "2098-03", "2098-02", "2098-01"]);
    expect((await readPayrollMonths(YEAR)).map((r) => r.month)).toEqual(["2098-01", "2098-02", "2098-03", "2098-04"]);
  });

  it("хүсэлтийн хугацаа үлдсэн хугацаанаас хэтрэхгүй", async () => {
    let now = 0;
    const seen: number[] = [];
    await syncPayroll(async (m, o) => {
      seen.push(o.timeoutMs);
      now += 150_000;
      return pm(m);
    }, "2098-02", { budgetMs: 180_000, clock: () => now });
    expect(seen).toEqual([45_000, 30_000]); // анхдагч 45 сек; 150 сек өнгөрсний дараа үлдсэн 30 сек
  });

  it(`дараалан ${MAX_CONSECUTIVE_FAILURES} сар унавал 1С-д ачаалал өгөхгүйн тулд зогсоно`, async () => {
    const fetchMonth = vi.fn(async (): Promise<PayrollMonth> => {
      throw new Error("1С хугацаандаа хариу өгсөнгүй (45 сек)");
    });
    const steps = await syncPayroll(fetchMonth, NOW);
    expect(fetchMonth).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);
    expect(steps.filter((s) => !s.ok)).toHaveLength(MAX_CONSECUTIVE_FAILURES);
    expect(steps[steps.length - 1]).toMatchObject({ period: "stopped" });
    expect(await prisma.onecSyncLog.count({ where: { kind: PAYROLL_LOG_KIND, ok: false, period: { startsWith: "2098" } } })).toBe(MAX_CONSECUTIVE_FAILURES);
  });

  it("ХҮН, ХЭЛТСИЙН мэдээлэл хадгалагдахгүй: хүснэгтэд зөвхөн нийт дүнгийн багана", async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'onec_payroll_month' ORDER BY ordinal_position`;
    expect(cols.map((c) => c.column_name)).toEqual(["id", "month", "accrued", "employer_ndsh", "employee_ndsh", "hhoat", "paid_bank", "paid_cash", "closing_payable", "lines", "synced_at", "benefit", "sick_pay", "board", "board_ndsh", "board_hhoat", "board_paid", "other_deductions"]);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE 'onec_payroll%'`;
    expect(tables.map((t) => t.table_name)).toEqual(["onec_payroll_month"]); // ажилтан, хэлтсийн хүснэгт байхгүй
  });
});
