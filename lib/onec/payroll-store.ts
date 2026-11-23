// «Цалин» табын сарын нийт дүнгийн агшин зураг (onec_payroll_month): 1С-ээс (OData, зөвхөн GET) sync-ээр татаж Postgres-д хадгална.
// ЗӨВХӨН байгууллагын нийт дүн: ажилтан, хэлтсийн мэдээлэл хадгалагдахгүй (lib/onec/payroll.ts: нээх бүрд 1С-ээс шууд уншина).
// Татах сар: ЗӨВХӨН одоогийн ба өмнөх сар (хожуу бичилт орж болно) + Postgres-д байхгүй сар (анхны удаа, ONEC_BASES-д өмнөх он нэмэгдвэл тэр он).
// Өнгөрсөн сарууд (Postgres-д байгаа) дахин татагдахгүй, ГАНЦ задаргаа (тэтгэмж, өвчний тэтгэмж, ТУЗ ...) хараахан бичигдээгүй сар (board IS NULL) дахин татагдана. Дараалал: одоогийн, өмнөх, дараа нь байхгүй сарууд (шинэ нь түрүүлж).
// 1С-ийг ачаалахгүйн тулд: нийт хугацаанд дээд хязгаар (BUDGET_MS), хүсэлт бүрийн хугацаа үлдсэн хугацаанаас хэтрэхгүй, дараалан 2 сар унавал
// зогсооно. Зогссон үед үлдсэн сар дараагийн удаа үргэлжилнэ. Бодолтгүй сар (0 бичилт) алдаа биш: ok=true, 0 мөр.
import { prisma } from "@/lib/prisma";
import { configuredYears, multiYear } from "./bases";
import { addMonths, currentMonth } from "./dates";
import { fetchPayrollMonth, REQUEST_TIMEOUT_MS, yearMonths, type PayrollMonth } from "./payroll";
import type { SnapshotStep } from "./snapshots-store";

export const PAYROLL_LOG_KIND = "payroll-month";
/** Payroll алхмын нийт хугацааны дээд хязгаар (GitHub workflow-ийн timeout-аас бага) */
export const BUDGET_MS = 180_000;
/** Дараалан хэдэн сар унавал 1С-д ачаалал өгөхөө зогсоох вэ */
export const MAX_CONSECUTIVE_FAILURES = 2;
/** Үлдсэн хугацаа үүнээс бага бол шинэ хүсэлт эхлүүлэхгүй */
const MIN_REQUEST_MS = 10_000;

/** Нийт татах боломжтой сарууд: ONEC_BASES-д жагсаасан он бүрийн 1-р сараас (одоогийн оныг одоо хүртэл); нэг баазын горимд зөвхөн энэ он */
export function payrollYears(now = currentMonth(), env: Record<string, string | undefined> = process.env): string[] {
  const thisYear = now.slice(0, 4);
  if (!multiYear(env)) return [thisYear];
  return configuredYears(env).filter((y) => y <= thisYear);
}

export function candidateMonths(now = currentMonth(), env: Record<string, string | undefined> = process.env): string[] {
  return payrollYears(now, env).flatMap((y) => yearMonths(y, now));
}

/** Татах сарууд, дарааллаар: одоогийн, өмнөх сар, дараа нь Postgres-д байхгүй сарууд (шинээс хуучин руу) */
export function monthsToSync(existing: ReadonlySet<string>, now = currentMonth(), env: Record<string, string | undefined> = process.env): string[] {
  const candidates = candidateMonths(now, env);
  const recent = [now, addMonths(now, -1)].filter((m) => candidates.includes(m));
  const missing = candidates.filter((m) => !existing.has(m) && !recent.includes(m)).reverse();
  return [...recent, ...missing];
}

export async function writePayrollMonth(p: PayrollMonth) {
  await prisma.$executeRaw`
    INSERT INTO onec_payroll_month (month, accrued, employer_ndsh, employee_ndsh, hhoat, paid_bank, paid_cash, closing_payable, lines, benefit, sick_pay, board, board_ndsh, board_hhoat, board_paid, other_deductions, synced_at)
    VALUES (${p.month}, ${p.accrued}, ${p.employerNdsh}, ${p.employeeNdsh}, ${p.hhoat}, ${p.paidBank}, ${p.paidCash}, ${p.closingPayable}, ${p.lines},
            ${p.benefit}, ${p.sickPay}, ${p.board}, ${p.boardNdsh}, ${p.boardHhoat}, ${p.boardPaid}, ${p.otherDeductions}, now())
    ON CONFLICT (month) DO UPDATE SET accrued = EXCLUDED.accrued, employer_ndsh = EXCLUDED.employer_ndsh, employee_ndsh = EXCLUDED.employee_ndsh, hhoat = EXCLUDED.hhoat,
      paid_bank = EXCLUDED.paid_bank, paid_cash = EXCLUDED.paid_cash, closing_payable = EXCLUDED.closing_payable, lines = EXCLUDED.lines,
      benefit = EXCLUDED.benefit, sick_pay = EXCLUDED.sick_pay, board = EXCLUDED.board, board_ndsh = EXCLUDED.board_ndsh, board_hhoat = EXCLUDED.board_hhoat,
      board_paid = EXCLUDED.board_paid, other_deductions = EXCLUDED.other_deductions, synced_at = EXCLUDED.synced_at`;
}

export type FetchPayrollMonth = (month: string, opts: { timeoutMs: number }) => Promise<PayrollMonth & { timings?: { linesMs: number; balanceMs: number; totalMs: number } }>;

/** Алдаа шидэхгүй: сар бүрийн үр дүнг буцаана, sync_log-д бичнэ. fetchMonth, clock, budgetMs нь тестэд дуурайлгана. */
export async function syncPayroll(fetchMonth: FetchPayrollMonth = fetchPayrollMonth, now = currentMonth(), opts: { budgetMs?: number; clock?: () => number } = {}): Promise<SnapshotStep[]> {
  const budgetMs = opts.budgetMs ?? BUDGET_MS;
  const clock = opts.clock ?? Date.now;
  const begun = clock();
  const existing = new Set((await prisma.$queryRaw<{ month: string }[]>`SELECT month FROM onec_payroll_month WHERE board IS NOT NULL`).map((r) => r.month));
  const todo = monthsToSync(existing, now);
  const out: SnapshotStep[] = [];
  let failures = 0;
  for (const [i, month] of todo.entries()) {
    const remaining = budgetMs - (clock() - begun);
    const rest = todo.length - i;
    if (remaining < MIN_REQUEST_MS) {
      out.push({ kind: PAYROLL_LOG_KIND, period: "stopped", ok: true, rows: 0, message: `Хугацааны хязгаарт (${Math.round(budgetMs / 1000)}s) хүрсэн: ${rest} сар үлдсэн, дараагийн удаа үргэлжилнэ` });
      break;
    }
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      out.push({ kind: PAYROLL_LOG_KIND, period: "stopped", ok: true, rows: 0, message: `Дараалан ${failures} сар унасан тул 1С-д ачаалал өгөхгүйн тулд зогслоо: ${rest} сар үлдсэн, дараагийн удаа үргэлжилнэ` });
      break;
    }
    const startedAt = new Date();
    try {
      const p = await fetchMonth(month, { timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remaining) });
      await writePayrollMonth(p);
      failures = 0;
      const t = p.timings;
      const message = t ? `${(t.totalMs / 1000).toFixed(1)}s (бичилт ${(t.linesMs / 1000).toFixed(1)}s, үлдэгдэл ${(t.balanceMs / 1000).toFixed(1)}s)` : `${((clock() - startedAt.getTime()) / 1000).toFixed(1)}s`;
      await prisma.onecSyncLog.create({ data: { kind: PAYROLL_LOG_KIND, period: month, rows: p.lines, ok: true, message, startedAt } }).catch(() => {});
      out.push({ kind: PAYROLL_LOG_KIND, period: month, ok: true, rows: p.lines, message });
    } catch (e) {
      failures++;
      const message = e instanceof Error ? e.message : String(e);
      await prisma.onecSyncLog.create({ data: { kind: PAYROLL_LOG_KIND, period: month, rows: 0, ok: false, message, startedAt } }).catch(() => {});
      out.push({ kind: PAYROLL_LOG_KIND, period: month, ok: false, rows: 0, message });
    }
  }
  return out;
}

export interface PayrollMonthRow extends PayrollMonth {
  syncedAt: string;
  /** false = задаргаа (тэтгэмж, өвчний тэтгэмж, ТУЗ) хараахан татагдаагүй хуучин мөр: дараагийн sync-ээр бөглөгдөнө */
  breakdown: boolean;
}

type Raw = { month: string; accrued: number; employer_ndsh: number; employee_ndsh: number; hhoat: number; paid_bank: number; paid_cash: number; closing_payable: number; lines: number; benefit: number | null; sick_pay: number | null; board: number | null; board_ndsh: number | null; board_hhoat: number | null; board_paid: number | null; other_deductions: number | null; synced_at: Date };

const toRow = (r: Raw): PayrollMonthRow => ({
  month: r.month, accrued: r.accrued, employerNdsh: r.employer_ndsh, employeeNdsh: r.employee_ndsh, hhoat: r.hhoat, paidBank: r.paid_bank, paidCash: r.paid_cash, closingPayable: r.closing_payable, lines: r.lines,
  benefit: r.benefit ?? 0, sickPay: r.sick_pay ?? 0, board: r.board ?? 0, boardNdsh: r.board_ndsh ?? 0, boardHhoat: r.board_hhoat ?? 0, boardPaid: r.board_paid ?? 0, otherDeductions: r.other_deductions ?? 0,
  syncedAt: r.synced_at.toISOString(), breakdown: r.board !== null,
});

/** `from`..`to` (YYYY-MM, хоёулаа орно) сарууд */
export async function readPayrollMonthsBetween(from: string, to: string): Promise<PayrollMonthRow[]> {
  const rows = await prisma.$queryRaw<Raw[]>`
    SELECT month, accrued::float8 AS accrued, employer_ndsh::float8 AS employer_ndsh, employee_ndsh::float8 AS employee_ndsh, hhoat::float8 AS hhoat,
           paid_bank::float8 AS paid_bank, paid_cash::float8 AS paid_cash, closing_payable::float8 AS closing_payable, lines,
           benefit::float8 AS benefit, sick_pay::float8 AS sick_pay, board::float8 AS board, board_ndsh::float8 AS board_ndsh, board_hhoat::float8 AS board_hhoat,
           board_paid::float8 AS board_paid, other_deductions::float8 AS other_deductions, synced_at
      FROM onec_payroll_month WHERE month >= ${from} AND month <= ${to} ORDER BY month`;
  return rows.map(toRow);
}

export const readPayrollMonths = (year: string) => readPayrollMonthsBetween(`${year}-01`, `${year}-12`);
