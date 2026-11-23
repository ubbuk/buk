import { describe, expect, it } from "vitest";
import type { PayrollMonthRow } from "./payroll-store";
import { buildPayrollView, PAYROLL_PART_LABEL, PAYROLL_PART_ORDER, partAmounts } from "./payroll-view";

const row = (month: string, over: Partial<PayrollMonthRow> = {}): PayrollMonthRow => ({
  month,
  accrued: 1_184_609_016.62,
  employerNdsh: 150_000_000.5,
  employeeNdsh: 121_222_176.33,
  hhoat: 104_298_558.71,
  paidBank: 1_125_467_606.06,
  paidCash: 702_000,
  closingPayable: 0,
  lines: 10,
  benefit: 13_440_000,
  sickPay: 1_496_916,
  board: 18_000_000,
  boardNdsh: 1_641_500,
  boardHhoat: 1_479_850,
  boardPaid: 5_643_600,
  otherDeductions: 10_169_765,
  syncedAt: "2026-09-30T00:00:00Z",
  breakdown: true,
  ...over,
});
const months12 = (last: string) => {
  const [y, m] = last.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
};
const round = (v: number) => Math.round(v * 100) / 100;
const months = months12("2026-09");

describe("buildPayrollView", () => {
  it("задаргааны нийлбэр = цалингийн нийт зардал = бодсон + ТУЗ + ажил олгогчийн НДШ", () => {
    const v = buildPayrollView([row("2026-09")], months);
    expect(round(v.parts.reduce((s, p) => s + p.amount, 0))).toBe(v.total);
    expect(v.total).toBe(round(1_184_609_016.62 + 18_000_000 + 150_000_000.5));
    expect(v.parts.map((p) => p.id)).toEqual(PAYROLL_PART_ORDER);
    expect(v.parts.find((p) => p.id === "main")?.amount).toBe(1_169_672_100.62);
    expect(v.employeesGross).toBe(1_184_609_016.62);
    expect(Math.round(v.parts.reduce((s, p) => s + p.share, 0))).toBe(100);
  });

  it("сар бүрийн задаргааны нийлбэр 12 сарын графикийн дүнтэй тэнцүү", () => {
    const rows = months.map((m, i) => row(m, { accrued: 1000 + i, board: i % 3 === 0 ? 50 : 0, benefit: 10, sickPay: 5, employerNdsh: 100 + i }));
    const v = buildPayrollView(rows, months);
    v.months.forEach((m, i) => expect(round(v.parts.reduce((s, p) => s + p.series[i], 0))).toBe(m.total));
    expect(v.months.every((m) => m.loaded)).toBe(true);
  });

  it("өмнөх сартай харьцуулалт; өмнөх сар татагдаагүй бол «татагдаагүй» (0 биш, өөрчлөлтгүй)", () => {
    const zero = { benefit: 0, sickPay: 0, board: 0, employerNdsh: 0 };
    const withPrev = buildPayrollView([row("2026-08", { accrued: 1000, ...zero }), row("2026-09", { accrued: 1100, ...zero })], months);
    expect(withPrev).toMatchObject({ prevLoaded: true, prevTotal: 1000, total: 1100, changePct: 10, prevMonth: "2026-08" });
    const noPrev = buildPayrollView([row("2026-09")], months);
    expect(noPrev).toMatchObject({ prevLoaded: false, changePct: null });
    expect(noPrev.parts.every((p) => p.changePct === null)).toBe(true);
    expect(noPrev.months.find((m) => m.month === "2026-08")).toMatchObject({ loaded: false, total: 0 });
  });

  it("хаашаа очсон: гарт олгосон (банк+касс+ТУЗ), ХХОАТ, ажилтны НДШ (ТУЗ-ийнхыг оруулаад), бусад суутгал", () => {
    const v = buildPayrollView([row("2026-09")], months);
    expect(v.went).toEqual({
      paid: round(1_125_467_606.06 + 702_000 + 5_643_600),
      paidBank: 1_125_467_606.06,
      paidCash: 702_000,
      hhoat: round(104_298_558.71 + 1_479_850),
      employeeNdsh: round(121_222_176.33 + 1_641_500),
      other: 10_169_765,
    });
  });

  it("бодолт бичигдээгүй сар: хаашаа очсон = null («Бодолт хараахан бүртгэгдээгүй»), нийт дүн нь өвчний тэтгэмжээс л бүрдэнэ", () => {
    const empty = { benefit: 0, board: 0, employerNdsh: 0, employeeNdsh: 0, hhoat: 0, paidBank: 0, paidCash: 0, boardNdsh: 0, boardHhoat: 0, boardPaid: 0, otherDeductions: 0 };
    const v = buildPayrollView([row("2026-10", { accrued: 1_496_916, sickPay: 1_496_916, ...empty })], months12("2026-10"));
    expect(v).toMatchObject({ ready: true, posted: false, went: null, total: 1_496_916, changePct: null });
    expect(v.parts.every((p) => p.changePct === null)).toBe(true); // өмнөх сартай харьцуулахгүй
  });

  it("задаргаагүй хуучин мөр: ready=false, pending=true (нийт дүнг буруу гаргахгүй); огт татагдаагүй сар: pending=false", () => {
    const old = buildPayrollView([row("2026-09", { breakdown: false, board: 0, benefit: 0, sickPay: 0 })], months);
    expect(old).toMatchObject({ ready: false, pending: true, total: 0 });
    expect(old.months[11].loaded).toBe(false);
    expect(buildPayrollView([], months)).toMatchObject({ ready: false, pending: false });
  });

  it("partAmounts: үндсэн цалин = бодсон − тэтгэмж − өвчний тэтгэмж", () => {
    expect(partAmounts(row("2026-09")).main).toBe(1_169_672_100.62);
  });

  it("нүүрэн дээр нягтлангийн нэр томьёо, дансны код, Комментарий байхгүй", () => {
    const text = JSON.stringify(buildPayrollView([row("2026-09")], months)) + Object.values(PAYROLL_PART_LABEL).join(" ");
    expect(text).not.toMatch(/\b(3342|3349|3450|3462)\b|Кт|Дт|Комментарий|Содержание|Recorder|УБ00/);
  });
});
