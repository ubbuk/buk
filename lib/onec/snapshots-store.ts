// Мониторингийн «1С · Санхүүгийн тойм»-ын мөнгөн хөрөнгө, зарцуулалтын агшин зураг: 1С-ээс (OData, зөвхөн GET) sync-ээр татаж Postgres-д хадгална,
// мониторинг зөвхөн Postgres-оос уншина (lib/onec/overview.ts). Vercel-ийн route биш GitHub Actions (scripts/sync-1c.ts snapshots) дээр ажиллана.
//   onec_cash_balance: өдрийн эцсийн 10xx, 11xx үлдэгдэл данс бүрээр (өдөр бүр тухайн өдрийн мөрүүдийг бүхэлд нь солино)
//   onec_usage_month: сарын нийт зарцуулалт (сар бүрт нэг мөр, upsert)
// Алдаа гарвал хуучин мөр хэвээр, onec_sync_log-д ok=false гэж тэмдэглэнэ; нэг нь унасан ч нөгөөг үргэлжлүүлнэ.
import { prisma } from "@/lib/prisma";
import { fetchCashBalances, type CashBalanceRow } from "./cash";
import { currentMonth, today } from "./dates";
import { fetchUsage } from "./usage";

export const CASH_LOG_KIND = "cash-balance";
export const USAGE_LOG_KIND = "usage-month";

export interface SnapshotStep {
  kind: string;
  period: string;
  ok: boolean;
  rows: number;
  message: string;
}

async function logStep(kind: string, period: string, rows: number, ok: boolean, message: string, startedAt: Date) {
  await prisma.onecSyncLog.create({ data: { kind, period, rows, ok, message, startedAt } }).catch(() => {});
}

/** Өдрийн эцсийн мөнгөний үлдэгдлийн мөрүүд: бүх данс 0 бол «хоосон» тэмдэглэгээ мөр (snapshot хийгдсэн гэдгийг мэдэхийн тулд) */
export function cashSnapshotRows(rows: CashBalanceRow[]): CashBalanceRow[] {
  return rows.length ? rows : [{ code: "", name: "", balance: 0 }];
}

export async function writeCashBalance(asOf: string, rows: CashBalanceRow[]) {
  const data = cashSnapshotRows(rows);
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM onec_cash_balance WHERE snapshot_date = ${asOf}::date`,
    prisma.$executeRaw`
      INSERT INTO onec_cash_balance (snapshot_date, account_code, account_name, balance)
      SELECT ${asOf}::date, t.c, t.n, t.b
        FROM unnest(${data.map((r) => r.code)}::text[], ${data.map((r) => r.name)}::text[], ${data.map((r) => r.balance)}::numeric[]) AS t(c, n, b)`,
  ]);
}

export async function writeUsageMonth(month: string, amount: number, documents: number) {
  await prisma.$executeRaw`
    INSERT INTO onec_usage_month (month, amount, documents, synced_at) VALUES (${month}, ${amount}, ${documents}, now())
    ON CONFLICT (month) DO UPDATE SET amount = EXCLUDED.amount, documents = EXCLUDED.documents, synced_at = EXCLUDED.synced_at`;
}

/** Өнөөдрийн мөнгөний үлдэгдлийг татаж бичнэ. Алдаа шидэхгүй: үр дүнг буцааж, sync_log-д бичнэ. */
export async function syncCashBalance(asOf = today()): Promise<SnapshotStep> {
  const startedAt = new Date();
  try {
    const rows = await fetchCashBalances(asOf);
    await writeCashBalance(asOf, rows);
    const secs = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
    await logStep(CASH_LOG_KIND, asOf, rows.length, true, `${secs}s`, startedAt);
    return { kind: CASH_LOG_KIND, period: asOf, ok: true, rows: rows.length, message: `${secs}s` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logStep(CASH_LOG_KIND, asOf, 0, false, message, startedAt);
    return { kind: CASH_LOG_KIND, period: asOf, ok: false, rows: 0, message };
  }
}

/** Одоогийн сарын зарцуулалтын нийт (Зарцуулалт табын totals-тай ижил) татаж бичнэ. Алдаа шидэхгүй. */
export async function syncUsageMonth(month = currentMonth()): Promise<SnapshotStep> {
  const startedAt = new Date();
  try {
    const usage = await fetchUsage(month);
    await writeUsageMonth(month, usage.totals.amount, usage.totals.documents);
    const secs = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
    await logStep(USAGE_LOG_KIND, month, usage.totals.documents, true, `${secs}s`, startedAt);
    return { kind: USAGE_LOG_KIND, period: month, ok: true, rows: usage.totals.documents, message: `${secs}s` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logStep(USAGE_LOG_KIND, month, 0, false, message, startedAt);
    return { kind: USAGE_LOG_KIND, period: month, ok: false, rows: 0, message };
  }
}

/** Хоёр алхмыг дарааллаар (1С-д зэрэг ачаалал өгөхгүй) ажиллуулна; нэг нь унасан ч нөгөө нь үргэлжилнэ. */
export async function syncSnapshots(): Promise<SnapshotStep[]> {
  const out: SnapshotStep[] = [];
  out.push(await syncCashBalance());
  out.push(await syncUsageMonth());
  return out;
}
