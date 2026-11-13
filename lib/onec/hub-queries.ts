// /api/v1/onec/* -ийн өгөгдөл: талбарын нэр, төрөл нь 1С-ийн /hs/dash/* мөртэй ижил
// (өдөр = "YYYY-MM-DD" string, дүн/тоо = number). lib/onec/client.ts дахь Row төрлүүдтэй тулгана.
import { prisma } from "@/lib/prisma";
import type { CashRow, PlRow, ReceivableRow, SalesRow, StockRow } from "./client";

const d = (v: string) => new Date(`${v}T00:00:00.000Z`);
const iso = (v: Date | null | undefined) => v?.toISOString().slice(0, 10) ?? null;

export function salesRows(from: string, to: string) {
  return prisma.$queryRaw<SalesRow[]>`
    SELECT date::text AS date, org, item_code, item, unit, qty::float8 AS qty, amount::float8 AS amount,
           vat::float8 AS vat, cost::float8 AS cost, client_code, client, client_reg, dept, doc, row_type
      FROM onec_sales WHERE date BETWEEN ${from}::date AND ${to}::date
     ORDER BY date, id`;
}

export function cashRows(from: string, to: string) {
  return prisma.$queryRaw<CashRow[]>`
    SELECT date::text AS date, account, client_code, client, item_code, item,
           inflow::float8 AS inflow, outflow::float8 AS outflow, memo, doc
      FROM onec_cash WHERE date BETWEEN ${from}::date AND ${to}::date
     ORDER BY date, id`;
}

/**
 * P&L нь ERP-д САРААР хадгалагддаг (1С from..to-г сараар нь ангилж өгдөг). Тиймээс from..to-той огтлолцох бүх
 * сарыг бүтнээр нь буцаана: хагас сарын хугацаа асуувал тэр сарын бүтэн P&L ирнэ.
 */
export function plRows(from: string, to: string) {
  const m1 = from.slice(0, 7);
  const m2 = to.slice(0, 7);
  return prisma.$queryRaw<PlRow[]>`
    SELECT month::text AS month, item_code, item, account, account_group AS "group", side, amount::float8 AS amount
      FROM onec_pl WHERE month BETWEEN ${m1} AND ${m2}
     ORDER BY month, id`;
}

/** asof-ийн агшин зураг байвал тэр, үгүй бол хамгийн сүүлийнх; огт байхгүй бол null */
export async function stockSnapshot(asof: string | null): Promise<string | null> {
  if (asof && (await prisma.onecStock.findFirst({ where: { snapshotDate: d(asof) }, select: { id: true } }))) return asof;
  return iso((await prisma.onecStock.aggregate({ _max: { snapshotDate: true } }))._max.snapshotDate);
}

export function stockRows(snapshot: string) {
  return prisma.$queryRaw<StockRow[]>`
    SELECT org, warehouse_code, warehouse, item_code, item, unit, account, qty::float8 AS qty, amount::float8 AS amount
      FROM onec_stock WHERE snapshot_date = ${snapshot}::date
     ORDER BY id`;
}

export async function receivablesSnapshot(asof: string | null): Promise<string | null> {
  if (asof && (await prisma.onecReceivable.findFirst({ where: { snapshotDate: d(asof) }, select: { id: true } }))) return asof;
  return iso((await prisma.onecReceivable.aggregate({ _max: { snapshotDate: true } }))._max.snapshotDate);
}

export function receivablesRows(snapshot: string) {
  return prisma.$queryRaw<ReceivableRow[]>`
    SELECT type, client_code, client, doc, doc_date, due, amount::float8 AS amount, balance::float8 AS balance, overdue_days
      FROM onec_receivables WHERE snapshot_date = ${snapshot}::date
     ORDER BY id`;
}
