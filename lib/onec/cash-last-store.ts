// «Мөнгөн хөрөнгө» табын «Хөдөлгөөнгүй данс»: данс бүрийн сар бүрийн СҮҮЛИЙН бодит гүйлгээг (огноо, дансны талаас тэмдэгтэй дүн) Postgres-д хадгална.
//  * Хуудас, API зөвхөн ЭНДЭЭС уншина (readLatestMoves, readMoveBefore): хэрэглэгчийн хүсэлтээр сүүлийн гүйлгээ хайж 1С руу хандахгүй.
//  * sync (ЗӨВХӨН GET): `cash-last-moves` (regular дотор) одоогийн + өмнөх сарыг; `cash-last-moves-backfill` өмнөх саруудыг (анх нэг удаа ≤ 24 сар) бичнэ.
//    Сар бүр өөрийн мөрүүдийг бүхэлд нь солино (устгаад дахин бичнэ, нэг transaction). Бодит гүйлгээ = lib/onec/cash-activity.ts isRealMove (ханшийн тохируулга биш).
import { prisma } from "@/lib/prisma";
import { fetchCash, type CashResult } from "./cash";
import { lastMoveIn, type LastMove } from "./cash-activity";
import { addMonths, currentMonth, isMonth, monthRange, monthsBetween } from "./dates";

export const CASH_LAST_KIND = "cash-last-moves";
export const CASH_LAST_BACKFILL_KIND = "cash-last-moves-backfill";
const MAX_BACKFILL_MONTHS = 24;

export interface LastMoveRow {
  key: string;
  month: string;
  lastDate: string;
  amount: number;
}

/** Цэвэр: сарын мэдээнээс данс бүрийн тэр сарын сүүлийн бодит гүйлгээ (гүйлгээгүй данс мөргүй) */
export function lastMoveRowsOf(cash: CashResult): LastMoveRow[] {
  const end = monthRange(cash.month).to;
  const rows: LastMoveRow[] = [];
  for (const a of cash.accounts) {
    const m = lastMoveIn(cash, a.key, end);
    if (m) rows.push({ key: a.key, month: cash.month, lastDate: m.date, amount: m.amount });
  }
  return rows.sort((x, y) => x.key.localeCompare(y.key));
}

export type FetchCashMonth = (month: string) => Promise<CashResult>;

async function log(kind: string, period: string, rows: number, ok: boolean, message: string, startedAt: Date) {
  await prisma.onecSyncLog.create({ data: { kind, period, rows, ok, message, startedAt } }).catch(() => {});
}

/** Нэг сарыг 1С-ээс уншиж (GET) тэр сарын мөрүүдийг солино. Алдаа гарвал хуучин мөр хэвээр, onec_sync_log-д ok=false. */
export async function syncCashLastMonth(month: string, fetchMonth: FetchCashMonth = fetchCash): Promise<{ month: string; ok: boolean; rows: number; message: string }> {
  const startedAt = new Date();
  try {
    const cash = await fetchMonth(month);
    const rows = lastMoveRowsOf(cash);
    await prisma.$transaction(async (tx) => {
      await tx.onecCashLastMove.deleteMany({ where: { month } });
      if (rows.length) await tx.onecCashLastMove.createMany({ data: rows.map((r) => ({ key: r.key, month: r.month, lastDate: r.lastDate, amount: r.amount })) });
    });
    const message = `${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)}s (${rows.length} данс)`;
    await log(CASH_LAST_KIND, month, rows.length, true, message, startedAt);
    return { month, ok: true, rows: rows.length, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log(CASH_LAST_KIND, month, 0, false, message, startedAt);
    return { month, ok: false, rows: 0, message };
  }
}

/** regular: одоогийн + өмнөх сар (өмнөх сарын хоцорсон баримтыг барина). Сар бүр бие даасан: нэг нь унасан ч нөгөө нь үргэлжилнэ. */
export async function syncCashLastMoves(now: string = currentMonth(), fetchMonth: FetchCashMonth = fetchCash) {
  const out = [];
  for (const month of [addMonths(now, -1), now]) out.push(await syncCashLastMonth(month, fetchMonth));
  return out;
}

/** Нэг удаагийн нөхөлт (анх 24 сар): өмнө нь амжилттай бичигдсэн сарыг алгасна (`force` бол дахин). Сар бүр 1С-д 3 хүсэлт тул завсарлагатай. */
export async function backfillCashLastMoves(
  opts: { from: string; to: string; pauseSeconds?: number; force?: boolean },
  fetchMonth: FetchCashMonth = fetchCash,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
) {
  if (!isMonth(opts.from) || !isMonth(opts.to) || opts.from > opts.to) throw new Error("Жишээ: cash-last-moves-backfill 2025-01 2026-10");
  const months = monthsBetween(opts.from, opts.to);
  if (months.length > MAX_BACKFILL_MONTHS) throw new Error(`Нэг удаад ${MAX_BACKFILL_MONTHS}-өөс илүүгүй сар`);
  const have = new Set<string>();
  if (!opts.force) {
    const logs = await prisma.onecSyncLog.findMany({ where: { kind: CASH_LAST_KIND, ok: true, period: { in: months } }, select: { period: true } });
    for (const l of logs) have.add(l.period);
  }
  const result = { done: [] as string[], skipped: [] as string[], failed: [] as string[] };
  let first = true;
  for (const month of months) {
    if (have.has(month)) {
      result.skipped.push(month);
      continue;
    }
    if (!first && (opts.pauseSeconds ?? 15) > 0) await sleep((opts.pauseSeconds ?? 15) * 1000);
    first = false;
    const step = await syncCashLastMonth(month, fetchMonth);
    (step.ok ? result.done : result.failed).push(month);
  }
  // Нөхөлт бүрэн дууссан (алдаагүй) бол «хайсан, олдсонгүй» гэж хэлж болно (хуудас: «Өмнөх гүйлгээ олдсонгүй»)
  if (result.failed.length === 0) await log(CASH_LAST_BACKFILL_KIND, `${opts.from}..${opts.to}`, result.done.length, true, `${months.length} сар`, new Date());
  return result;
}

// ------------------------------------------------------------------------------------------------------------- хуудасны уншилт (DB-ээс л)

/** Данс бүрийн хамгийн сүүлийн гүйлгээ (түлхүүрээр): мөр бүр нь тэр сарын сүүлийнх тул сүүлийн сарынх нь */
export async function readLatestMoves(): Promise<Map<string, LastMove>> {
  const rows = await prisma.$queryRaw<{ key: string; last_date: string; amount: number }[]>`
    SELECT DISTINCT ON (key) key, last_date, amount::float8 AS amount FROM onec_cash_last_move ORDER BY key, month DESC`;
  return new Map(rows.map((r) => [r.key, { date: r.last_date, amount: r.amount }]));
}

/** `month`-аас ӨМНӨХ саруудын хамгийн сүүлийн гүйлгээ (тухайн сарын дотрох хайлтыг дуудагч сарын мэдээнээс хийнэ) */
export async function readMoveBefore(key: string, month: string): Promise<LastMove | null> {
  const rows = await prisma.$queryRaw<{ last_date: string; amount: number }[]>`
    SELECT last_date, amount::float8 AS amount FROM onec_cash_last_move WHERE key = ${key} AND month < ${month} ORDER BY month DESC LIMIT 1`;
  return rows[0] ? { date: rows[0].last_date, amount: rows[0].amount } : null;
}

/** Нөхөлт (backfill) бүрэн хийгдсэн үү: тийм бол «мөр байхгүй» = сүүлийн ~24 сард гүйлгээгүй; үгүй бол «хараахан тооцоогүй» */
export async function isLastMoveBackfilled(): Promise<boolean> {
  return (await prisma.onecSyncLog.count({ where: { kind: CASH_LAST_BACKFILL_KIND, ok: true } })) > 0;
}
