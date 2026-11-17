import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, ubDate } from "./dates";

// 1С-ийн snapshot хүснэгтүүдийн хадгалалтын бодлого (`npm run sync:1c -- prune`, sync-1c.yml-ийн өдөр бүрийн алхам).
//
//   onec_stock    сүүлийн 90 хоног: өдөр бүрийн snapshot. Түүнээс өмнө: САР БҮРИЙН СҮҮЛИЙН snapshot. max(snapshot_date)-ийг ХЭЗЭЭ Ч устгахгүй.
//   onec_sync_log амжилттай (ok) мөр 90 хоног, алдаатай мөр 1 жил. Төрөл (kind) бүрийн хамгийн сүүлийн амжилттай мөрийг үргэлж үлдээнэ.
//
// Анхдагч нь DRY-RUN: юу ч устгахгүй, зөвхөн юу устахыг тайлагнана. Зөвхөн `apply: true` үед устгана.
// Яагаад: onec_stock өдөрт ~2,000 мөр нэмдэг (жилд ~626k мөр, ~270–300 MB); 1С-ийн snapshot зөвхөн хамгийн сүүлийнх нь UI, API-д хэрэглэгддэг.

export const STOCK_DAILY_DAYS = 90;
export const SYNC_LOG_OK_DAYS = 90;
export const SYNC_LOG_FAILED_DAYS = 365;

export interface StockPrunePlan {
  /** Хамгийн сүүлийн snapshot: хэзээ ч устгахгүй */
  latest: string | null;
  /** Сүүлийн `keepDays` хоногийн (cutoff-оос хойших) snapshot-ууд */
  keepDaily: string[];
  /** cutoff-оос өмнөх, сар бүрийн сүүлийн snapshot-ууд */
  keepMonthEnd: string[];
  remove: string[];
}

/**
 * Цэвэр функц: snapshot-уудын огноо (YYYY-MM-DD) ба УБ-ын өнөөдрөөс устгах жагсаалтыг гаргана.
 * Сарын «сүүлийн» нь тухайн сард бодитоор байгаа хамгийн сүүлийн snapshot (Ням гарагт sync ажилладаггүй тул сарын сүүлийн өдөр биш байж болно).
 */
export function planStockPrune(dates: string[], today: string, keepDays = STOCK_DAILY_DAYS): StockPrunePlan {
  const all = [...new Set(dates)].sort();
  const latest = all.at(-1) ?? null;
  const cutoff = addDays(today, -keepDays);
  const monthLast = new Map<string, string>();
  for (const d of all) monthLast.set(d.slice(0, 7), d); // эрэмбэтэй тул сүүлд орсон нь тухайн сарын хамгийн сүүлийнх

  const plan: StockPrunePlan = { latest, keepDaily: [], keepMonthEnd: [], remove: [] };
  for (const d of all) {
    if (d >= cutoff || d === latest) plan.keepDaily.push(d);
    else if (monthLast.get(d.slice(0, 7)) === d) plan.keepMonthEnd.push(d);
    else plan.remove.push(d);
  }
  return plan;
}

export interface StockPruneReport {
  apply: boolean;
  today: string;
  cutoff: string;
  latest: string | null;
  snapshots: number;
  keepDaily: number;
  keepMonthEnd: number;
  remove: { date: string; rows: number }[];
  rowsToRemove: number;
  deletedRows: number;
}

/**
 * `window` (зөвхөн тестэд): энэ хүрээнээс гадуурх snapshot-ыг ХЭЗЭЭ Ч устгахгүй, тиймээс тест нь бусад тестийн өгөгдөлд хүрэхгүй. Үйлдвэрлэлд өгөхгүй.
 */
export async function pruneStock(opts: { apply?: boolean; today?: string; keepDays?: number; window?: { from: string; to: string } } = {}): Promise<StockPruneReport> {
  const apply = opts.apply === true;
  const today = opts.today ?? ubDate();
  const keepDays = opts.keepDays ?? STOCK_DAILY_DAYS;
  const groups = await prisma.$queryRaw<{ d: string; rows: number }[]>`SELECT snapshot_date::text AS d, count(*)::int AS rows FROM onec_stock GROUP BY 1 ORDER BY 1`;
  const rowsOf = new Map(groups.map((g) => [g.d, g.rows]));
  const plan = planStockPrune(groups.map((g) => g.d), today, keepDays);
  const w = opts.window;
  const remove = plan.remove.filter((d) => d !== plan.latest && (!w || (d >= w.from && d <= w.to))).map((date) => ({ date, rows: rowsOf.get(date) ?? 0 }));

  let deletedRows = 0;
  if (apply) {
    // Өдөр бүрийг тусад нь (~2,000 мөр) жижиг transaction-оор: удаан түгжээ, том WAL үүсгэхгүй
    for (const { date } of remove) {
      deletedRows += (await prisma.onecStock.deleteMany({ where: { snapshotDate: new Date(`${date}T00:00:00Z`) } })).count;
    }
  }
  return {
    apply,
    today,
    cutoff: addDays(today, -keepDays),
    latest: plan.latest,
    snapshots: groups.length,
    keepDaily: plan.keepDaily.length,
    keepMonthEnd: plan.keepMonthEnd.length,
    remove,
    rowsToRemove: remove.reduce((a, r) => a + r.rows, 0),
    deletedRows,
  };
}

export interface SyncLogPruneReport {
  apply: boolean;
  okCutoff: string;
  failedCutoff: string;
  okRows: number;
  failedRows: number;
  deleted: number;
}

const DAY_MS = 86_400_000;

/** `kinds` (зөвхөн тестэд): зөвхөн эдгээр төрлийг хөнддөг. Үйлдвэрлэлд өгөхгүй. */
export async function pruneSyncLog(opts: { apply?: boolean; now?: Date; kinds?: string[] } = {}): Promise<SyncLogPruneReport> {
  const apply = opts.apply === true;
  const now = opts.now ?? new Date();
  const okCutoff = new Date(now.getTime() - SYNC_LOG_OK_DAYS * DAY_MS);
  const failedCutoff = new Date(now.getTime() - SYNC_LOG_FAILED_DAYS * DAY_MS);
  const kindFilter = opts.kinds ? Prisma.sql`AND l.kind = ANY(${opts.kinds}::text[])` : Prisma.empty;
  // Хуучин амжилттай мөр: тэр төрлийн ӨНДӨР нь шинэ амжилттай мөр байгаа үед л устна (хамгийн сүүлийн амжилттай мөр «сүүлд шинэчилсэн»-ийг заадаг)
  const where = Prisma.sql`(
    (l.ok AND l.finished_at < ${okCutoff} AND EXISTS (SELECT 1 FROM onec_sync_log n WHERE n.kind = l.kind AND n.ok AND n.finished_at > l.finished_at))
    OR (NOT l.ok AND l.finished_at < ${failedCutoff})
  ) ${kindFilter}`;

  const [counts] = await prisma.$queryRaw<{ ok_rows: number; failed_rows: number }[]>`
    SELECT (count(*) FILTER (WHERE l.ok))::int AS ok_rows, (count(*) FILTER (WHERE NOT l.ok))::int AS failed_rows FROM onec_sync_log l WHERE ${where}`;
  const deleted = apply ? Number(await prisma.$executeRaw`DELETE FROM onec_sync_log AS l WHERE ${where}`) : 0;
  return { apply, okCutoff: okCutoff.toISOString(), failedCutoff: failedCutoff.toISOString(), okRows: counts?.ok_rows ?? 0, failedRows: counts?.failed_rows ?? 0, deleted };
}

export interface RetentionReport {
  stock: StockPruneReport;
  syncLog: SyncLogPruneReport;
}

/** CLI, workflow-ийн нэг дуудлага. `apply` бол үр дүнг onec_sync_log-д «prune» гэж бүртгэнэ (dry-run юу ч бичихгүй). */
export async function runRetention(opts: { apply?: boolean; today?: string; now?: Date } = {}): Promise<RetentionReport> {
  const startedAt = new Date();
  const stock = await pruneStock({ apply: opts.apply, today: opts.today });
  const syncLog = await pruneSyncLog({ apply: opts.apply, now: opts.now });
  if (opts.apply) {
    const message = `onec_stock: ${stock.remove.length} snapshot (${stock.deletedRows} мөр); onec_sync_log: ${syncLog.deleted} мөр`;
    await prisma.onecSyncLog.create({ data: { kind: "prune", period: stock.today, rows: stock.deletedRows + syncLog.deleted, ok: true, message, startedAt } });
  }
  return { stock, syncLog };
}

export function describeRetention(r: RetentionReport): string {
  const s = r.stock;
  const mode = s.apply ? "APPLY: устгасан" : "DRY-RUN: юу ч устгаагүй";
  const lines = [
    `[prune] ${mode}`,
    `[prune] onec_stock: ${s.snapshots} snapshot, хамгийн сүүлийнх ${s.latest ?? "алга"} (хэзээ ч устахгүй). ${s.cutoff}-аас хойш өдөр бүр: ${s.keepDaily}, сарын эцэс: ${s.keepMonthEnd}`,
    `[prune] onec_stock: устгах ${s.remove.length} snapshot, ${s.rowsToRemove} мөр${s.apply ? ` (устгасан ${s.deletedRows})` : ""}${s.remove.length ? `: ${s.remove.slice(0, 12).map((x) => x.date).join(", ")}${s.remove.length > 12 ? ", ..." : ""}` : ""}`,
    `[prune] onec_sync_log: амжилттай ${SYNC_LOG_OK_DAYS} хоногоос хуучин ${r.syncLog.okRows} мөр, алдаатай ${SYNC_LOG_FAILED_DAYS} хоногоос хуучин ${r.syncLog.failedRows} мөр${r.syncLog.apply ? ` (устгасан ${r.syncLog.deleted})` : ""}`,
  ];
  if (!s.apply) lines.push("[prune] Үнэхээр устгахын тулд --apply");
  return lines.join("\n");
}
