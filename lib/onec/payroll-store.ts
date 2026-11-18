// «Цалин» табын сарын нийт дүнгийн агшин зураг (onec_payroll_month): 1С-ээс (OData, зөвхөн GET) sync-ээр татаж Postgres-д хадгална.
// ЗӨВХӨН байгууллагын нийт дүн: ажилтан, хэлтсийн мэдээлэл хадгалагдахгүй (lib/onec/payroll.ts: нээх бүрд 1С-ээс шууд уншина).
// Татах сар: Postgres-д байхгүй бүх сар (анхны удаа 1-р сараас одоог хүртэл, ONEC_BASES-д өмнөх он нэмэгдвэл тэр оныг ч автоматаар)
// ба сүүлийн 2 сар (хожуу бичилт орж болно). Нэг сар унасан ч бусад сар үргэлжилнэ; алдаа onec_sync_log-д (ok=false).
import { prisma } from "@/lib/prisma";
import { configuredYears, multiYear } from "./bases";
import { addMonths, currentMonth } from "./dates";
import { fetchPayrollMonth, yearMonths, type PayrollMonth } from "./payroll";
import type { SnapshotStep } from "./snapshots-store";

export const PAYROLL_LOG_KIND = "payroll-month";

/** Нийт татах боломжтой сарууд: ONEC_BASES-д жагсаасан он бүрийн 1-р сараас (одоогийн оныг одоо хүртэл); нэг баазын горимд зөвхөн энэ он */
export function payrollYears(now = currentMonth(), env: Record<string, string | undefined> = process.env): string[] {
  const thisYear = now.slice(0, 4);
  if (!multiYear(env)) return [thisYear];
  return configuredYears(env).filter((y) => y <= thisYear);
}

export function candidateMonths(now = currentMonth(), env: Record<string, string | undefined> = process.env): string[] {
  return payrollYears(now, env).flatMap((y) => yearMonths(y, now));
}

/** Татах сарууд: Postgres-д байхгүй бүх сар + сүүлийн 2 сар */
export function monthsToSync(existing: ReadonlySet<string>, now = currentMonth(), env: Record<string, string | undefined> = process.env): string[] {
  const recent = new Set([now, addMonths(now, -1)]);
  return candidateMonths(now, env).filter((m) => !existing.has(m) || recent.has(m));
}

export async function writePayrollMonth(p: PayrollMonth) {
  await prisma.$executeRaw`
    INSERT INTO onec_payroll_month (month, accrued, employer_ndsh, employee_ndsh, hhoat, paid_bank, paid_cash, closing_payable, lines, synced_at)
    VALUES (${p.month}, ${p.accrued}, ${p.employerNdsh}, ${p.employeeNdsh}, ${p.hhoat}, ${p.paidBank}, ${p.paidCash}, ${p.closingPayable}, ${p.lines}, now())
    ON CONFLICT (month) DO UPDATE SET accrued = EXCLUDED.accrued, employer_ndsh = EXCLUDED.employer_ndsh, employee_ndsh = EXCLUDED.employee_ndsh, hhoat = EXCLUDED.hhoat,
      paid_bank = EXCLUDED.paid_bank, paid_cash = EXCLUDED.paid_cash, closing_payable = EXCLUDED.closing_payable, lines = EXCLUDED.lines, synced_at = EXCLUDED.synced_at`;
}

/** Алдаа шидэхгүй: сар бүрийн үр дүнг буцаана, sync_log-д бичнэ. fetchMonth нь тестэд дуурайлгана. */
export async function syncPayroll(fetchMonth: (month: string) => Promise<PayrollMonth> = fetchPayrollMonth, now = currentMonth()): Promise<SnapshotStep[]> {
  const existing = new Set((await prisma.$queryRaw<{ month: string }[]>`SELECT month FROM onec_payroll_month`).map((r) => r.month));
  const out: SnapshotStep[] = [];
  for (const month of monthsToSync(existing, now)) {
    const startedAt = new Date();
    try {
      const p = await fetchMonth(month);
      await writePayrollMonth(p);
      const message = `${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)}s`;
      await prisma.onecSyncLog.create({ data: { kind: PAYROLL_LOG_KIND, period: month, rows: p.lines, ok: true, message, startedAt } }).catch(() => {});
      out.push({ kind: PAYROLL_LOG_KIND, period: month, ok: true, rows: p.lines, message });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.onecSyncLog.create({ data: { kind: PAYROLL_LOG_KIND, period: month, rows: 0, ok: false, message, startedAt } }).catch(() => {});
      out.push({ kind: PAYROLL_LOG_KIND, period: month, ok: false, rows: 0, message });
    }
  }
  return out;
}

export interface PayrollMonthRow extends PayrollMonth {
  syncedAt: string;
}

export async function readPayrollMonths(year: string): Promise<PayrollMonthRow[]> {
  const rows = await prisma.$queryRaw<{ month: string; accrued: number; employer_ndsh: number; employee_ndsh: number; hhoat: number; paid_bank: number; paid_cash: number; closing_payable: number; lines: number; synced_at: Date }[]>`
    SELECT month, accrued::float8 AS accrued, employer_ndsh::float8 AS employer_ndsh, employee_ndsh::float8 AS employee_ndsh, hhoat::float8 AS hhoat,
           paid_bank::float8 AS paid_bank, paid_cash::float8 AS paid_cash, closing_payable::float8 AS closing_payable, lines, synced_at
      FROM onec_payroll_month WHERE month LIKE ${`${year}-%`} ORDER BY month`;
  return rows.map((r) => ({ month: r.month, accrued: r.accrued, employerNdsh: r.employer_ndsh, employeeNdsh: r.employee_ndsh, hhoat: r.hhoat, paidBank: r.paid_bank, paidCash: r.paid_cash, closingPayable: r.closing_payable, lines: r.lines, syncedAt: r.synced_at.toISOString() }));
}
