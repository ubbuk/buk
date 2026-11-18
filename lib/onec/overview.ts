// Мониторингийн «1С · Санхүүгийн тойм»: агуулах, авлага (1201), энэ сарын борлуулалт. ЗӨВХӨН Postgres-д sync-ээр хадгалагдсан өгөгдлөөс:
// 1С руу (OData, /hs/dash) ХЭЗЭЭ Ч хандахгүй (мониторинг 30 сек тутам шинэчлэгддэг).
//   stock       <- onec_stock (сүүлийн агшин зураг, sync kind "stock")
//   receivables <- onec_receivable_balances, данс 1201 (sync kind "receivables-odata"; Авлага табтай ижил lib/onec/receivables.ts)
//   sales       <- onec_sales, энэ сар (sync kind "sales"; Борлуулалт табын «Нийт борлуулалт»-тай ижил)
//   cash        <- onec_cash_balance (өдрийн эцсийн 10xx, 11xx; sync kind "cash-balance", lib/onec/snapshots-store.ts)
//   usage       <- onec_usage_month (энэ сарын зарцуулалт; sync kind "usage-month")
// cash, usage зөвхөн ADMIN, DIRECTOR-д (canViewTreasury): бусад дүрд API-ийн хариунд ч орохгүй, Postgres-оос ч уншихгүй.
// Цалингийн мэдээлэл огт ордоггүй (зөвхөн нийт дүн).
import { prisma } from "@/lib/prisma";
import { currentMonth, monthRange, today } from "./dates";
import { fromSnapshotRows } from "./receivables";
import { readSnapshot } from "./receivables-store";
import { lastSuccess } from "./refresh";
import { canViewTreasury } from "./roles";
import { evaluateStockFreshness } from "./sync-schedule";

export const OVERVIEW_KEYS = ["stock", "receivables", "sales", "cash", "usage"] as const;
export type OverviewKey = (typeof OVERVIEW_KEYS)[number];

export interface OverviewCard {
  key: OverviewKey;
  /** төгрөг; өгөгдөл хараахан байхгүй бол null */
  value: number | null;
  /** өгөгдлийн өдөр (агшин зураг) эсвэл сар */
  asOf: string | null;
  /** энэ өгөгдлийг 1С-ээс хамгийн сүүлд амжилттай татсан цаг (ISO) */
  syncedAt: string | null;
}

export interface FinanceOverview {
  cards: OverviewCard[];
  /** картуудын хамгийн хуучин sync (ISO); ямар ч sync байхгүй бол null */
  updatedAt: string | null;
  stale: boolean;
  staleMessage: string | null;
}

export interface OverviewInputs {
  now: Date;
  stock: { value: number | null; asOf: string | null; syncedAt: Date | null };
  receivables: { value: number | null; asOf: string | null; syncedAt: Date | null };
  sales: { value: number | null; asOf: string | null; syncedAt: Date | null };
  /** зөвхөн ADMIN, DIRECTOR-д (canViewTreasury); байхгүй бол карт, хуучирсан эсэхийн тооцоонд ороогүй */
  cash?: { value: number | null; asOf: string | null; syncedAt: Date | null };
  usage?: { value: number | null; asOf: string | null; syncedAt: Date | null };
}

/**
 * Цэвэр нэгтгэл (тестлэгдэнэ). Хуучирсан эсэх: хамгийн хуучин sync-ийг sync-schedule.ts-ийн дүрмээр (STALE_AFTER_MS = 60 минут) шалгана.
 * Хуваарьт цагт (Да–Бя 09:00–20:00 УБ) 60 минутаас хуучин бол шар; хуваарийн бус цагт (орой, ням) өмнөх цонхны хаалттай харьцуулна:
 * тэгэхгүй бол орой бүр, ням гараг бүр худлаа анхааруулга гарна.
 */
export function buildOverview({ now, stock, receivables, sales, cash, usage }: OverviewInputs): FinanceOverview {
  const cards: OverviewCard[] = [
    { key: "stock", value: stock.value, asOf: stock.asOf, syncedAt: stock.syncedAt?.toISOString() ?? null },
    { key: "receivables", value: receivables.value, asOf: receivables.asOf, syncedAt: receivables.syncedAt?.toISOString() ?? null },
    { key: "sales", value: sales.value, asOf: sales.asOf, syncedAt: sales.syncedAt?.toISOString() ?? null },
  ];
  if (cash) cards.push({ key: "cash", value: cash.value, asOf: cash.asOf, syncedAt: cash.syncedAt?.toISOString() ?? null });
  if (usage) cards.push({ key: "usage", value: usage.value, asOf: usage.asOf, syncedAt: usage.syncedAt?.toISOString() ?? null });
  const times = [stock.syncedAt, receivables.syncedAt, sales.syncedAt, cash?.syncedAt, usage?.syncedAt].filter((d): d is Date => !!d);
  const oldest = times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : null;
  // Аль нэг нь ч sync болоогүй бол «хараахан шинэчлэгдээгүй» гэж анхааруулна
  const freshness = evaluateStockFreshness(times.length === cards.length ? oldest : null, now);
  return {
    cards,
    updatedAt: oldest?.toISOString() ?? null,
    stale: freshness.stale,
    staleMessage: freshness.message,
  };
}

/** Postgres-оос (1С-гүй) уншина */
export async function loadFinanceOverview(now = new Date(), role?: string | null): Promise<FinanceOverview> {
  const treasury = canViewTreasury(role);
  const month = currentMonth();
  const { from, to } = monthRange(month);
  const [stockRow, snap, salesRow, stockAt, recAt, salesAt] = await Promise.all([
    prisma.$queryRaw<{ d: string | null; amount: number | null }[]>`
      SELECT s.d::text AS d, (SELECT coalesce(sum(amount), 0)::float8 FROM onec_stock WHERE snapshot_date = s.d) AS amount
        FROM (SELECT max(snapshot_date) AS d FROM onec_stock) s`,
    readSnapshot(today(), "1970-01-01"),
    prisma.$queryRaw<{ amount: number; n: number }[]>`
      SELECT coalesce(sum(amount), 0)::float8 AS amount, count(*)::int AS n FROM onec_sales WHERE date BETWEEN ${from}::date AND ${to}::date`,
    lastSuccess(["stock"]),
    lastSuccess(["receivables-odata"]),
    lastSuccess(["sales"]),
  ]);

  const [cash, usage] = treasury ? await loadTreasury(month) : [undefined, undefined];

  return buildOverview({
    now,
    cash,
    usage,
    stock: { value: stockRow[0]?.d ? stockRow[0].amount : null, asOf: stockRow[0]?.d ?? null, syncedAt: stockAt },
    receivables: { value: snap ? fromSnapshotRows(snap.date, snap.rows).totals.receivable : null, asOf: snap?.date ?? null, syncedAt: recAt },
    sales: { value: (salesRow[0]?.n ?? 0) > 0 ? salesRow[0].amount : null, asOf: month, syncedAt: salesAt },
  });
}

async function loadTreasury(month: string): Promise<[NonNullable<OverviewInputs["cash"]>, NonNullable<OverviewInputs["usage"]>]> {
  const [cashRow, usageRow, cashAt, usageAt] = await Promise.all([
    prisma.$queryRaw<{ d: string | null; amount: number | null }[]>`
      SELECT s.d::text AS d, (SELECT coalesce(sum(balance), 0)::float8 FROM onec_cash_balance WHERE snapshot_date = s.d) AS amount
        FROM (SELECT max(snapshot_date) AS d FROM onec_cash_balance) s`,
    prisma.$queryRaw<{ amount: number }[]>`SELECT amount::float8 AS amount FROM onec_usage_month WHERE month = ${month}`,
    lastSuccess(["cash-balance"]),
    lastSuccess(["usage-month"]),
  ]);
  return [
    { value: cashRow[0]?.d ? cashRow[0].amount : null, asOf: cashRow[0]?.d ?? null, syncedAt: cashAt },
    { value: usageRow[0] ? usageRow[0].amount : null, asOf: month, syncedAt: usageAt },
  ];
}
