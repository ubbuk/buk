// GET /api/dashboard/receivables?month=2026-10 — сарын эцсийн (одоогийн сар бол өнөөдрийн) авлагын үлдэгдэл харилцагчаар.
// Postgres-ийн агшин зургаас ШУУД (1С руу хандахгүй): 1С-ийн Balance 10-110 сек тул шинэчлэлт ар талд (POST /api/dashboard/refresh
// { kind: "receivables" }, lib/onec/receivables-store.ts). Агшин зураг байхгүй бол { missing: true }; `refreshing` нь ар талын ажил явж байгааг заана.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { asOfDate, currentMonth, isMonth } from "@/lib/onec/dates";
import { fromSnapshotRows } from "@/lib/onec/receivables";
import { monthFloor, readSnapshot, receivablesState } from "@/lib/onec/receivables-store";
import { nameKey, type Invoice } from "@/lib/onec/receivable-aging";
import { buildReceivablesView, historyStartFrom, previousMonthEnd } from "@/lib/onec/receivables-view";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/receivables", async (req: Request) => {
  const denied = await requireFinanceAccess("receivables");
  if (denied) return denied;

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month) || month > currentMonth()) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй, ирээдүйн сар биш байх ёстой" }, { status: 400, headers: NO_STORE });

  const asOf = asOfDate(month);
  const [snap, state] = await Promise.all([readSnapshot(asOf, monthFloor(asOf, currentMonth())), receivablesState(asOf)]);
  if (!snap) return NextResponse.json({ missing: true, asOf, ...state, lastSyncedAt: null }, { headers: NO_STORE });
  const current = fromSnapshotRows(snap.date, snap.rows);

  // Өмнөх сарын эцсийн агшин зураг (харьцуулалт), борлуулалтын баримт (нас), 12 сарын график: бүгд Postgres-оос
  const prevEnd = previousMonthEnd(snap.date);
  const year = snap.date.slice(0, 4);
  const [prevSnap, salesMonths, trendRows] = await Promise.all([
    readSnapshot(prevEnd, prevEnd),
    prisma.$queryRaw<{ m: string }[]>`SELECT DISTINCT to_char(date, 'YYYY-MM') AS m FROM onec_sales WHERE date <= ${snap.date}::date`,
    prisma.$queryRaw<{ d: string; total: number }[]>`
      SELECT snapshot_date::text AS d, sum(balance)::float8 AS total FROM onec_receivable_balances
       WHERE account_code = '1201' AND snapshot_date BETWEEN ${`${year}-01-01`}::date AND ${`${year}-12-31`}::date GROUP BY snapshot_date ORDER BY snapshot_date`,
  ]);
  const historyStart = historyStartFrom(salesMonths.map((r) => r.m), snap.date);
  const invoices = new Map<string, Invoice[]>();
  if (historyStart) {
    const rows = await prisma.$queryRaw<{ client: string; date: string; total: number }[]>`
      SELECT client, date::text AS date, sum(amount + vat)::float8 AS total FROM onec_sales
       WHERE date BETWEEN ${historyStart}::date AND ${snap.date}::date AND row_type <> 'cost_only' AND client <> ''
       GROUP BY client, date, doc`;
    for (const r of rows) {
      const k = nameKey(r.client);
      invoices.set(k, [...(invoices.get(k) ?? []), { date: r.date, total: r.total }]);
    }
  }
  const view = buildReceivablesView(current, prevSnap ? fromSnapshotRows(prevSnap.date, prevSnap.rows) : null, invoices, historyStart);
  // сар бүрийн эцсийн (сарын хамгийн сүүлийн) агшин зураг
  const lastOfMonth = new Map<string, { asOf: string; receivable: number }>();
  for (const t of trendRows) lastOfMonth.set(t.d.slice(0, 7), { asOf: t.d, receivable: Math.round(t.total * 100) / 100 });
  const trend = [...lastOfMonth].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
  return NextResponse.json({ missing: false, ...current, customers: view.customers, aging: view.aging, previous: view.previous, trend, ...state, lastSyncedAt: snap.syncedAt.toISOString() }, { headers: NO_STORE });
});
