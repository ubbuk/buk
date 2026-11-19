// GET /api/dashboard/sales?month=2026-11 — «Борлуулалт» табын харагдац: орлого, өртөг, ашиг; 12 сарын график; харилцагчаар, бүтээгдэхүүнээр
// (Postgres-ийн onec_sales, 1С руу хандахгүй). /api/dashboard/summary хуучин хэвээр.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { currentMonth, isMonth, monthRange } from "@/lib/onec/dates";
import { buildSalesView } from "@/lib/onec/sales-view";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/sales", async (req: Request) => {
  const denied = await requireFinanceAccess("sales");
  if (denied) return denied;

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month)) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400, headers: NO_STORE });
  const { from, to } = monthRange(month);
  const year = month.slice(0, 4);

  const [lines, trend, daily, lastSync] = await Promise.all([
    prisma.$queryRaw<{ client_code: string; client: string; item_code: string; item: string; unit: string; direct: boolean; qty: number; revenue: number; cost: number }[]>`
      SELECT client_code, max(client) AS client, item_code, max(item) AS item, unit, (row_type = 'cost_only') AS direct,
             sum(qty)::float8 AS qty, sum(amount)::float8 AS revenue, sum(cost)::float8 AS cost
        FROM onec_sales WHERE date BETWEEN ${from}::date AND ${to}::date
       GROUP BY client_code, item_code, unit, (row_type = 'cost_only')`,
    prisma.$queryRaw<{ month: string; revenue: number; cost: number }[]>`
      SELECT to_char(date, 'YYYY-MM') AS month, sum(amount)::float8 AS revenue, sum(cost)::float8 AS cost
        FROM onec_sales WHERE date BETWEEN ${`${year}-01-01`}::date AND ${`${year}-12-31`}::date GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ date: string; revenue: number; profit: number }[]>`
      SELECT date::text AS date, sum(amount)::float8 AS revenue, sum(amount - cost)::float8 AS profit
        FROM onec_sales WHERE date BETWEEN ${from}::date AND ${to}::date GROUP BY date ORDER BY date`,
    prisma.onecSyncLog.findFirst({ where: { ok: true, kind: { in: ["sales", "pl"] } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
  ]);

  const view = buildSalesView(lines);
  return NextResponse.json(
    {
      month,
      ...view,
      trend: trend.map((t) => ({ month: t.month, revenue: Math.round(t.revenue * 100) / 100, profit: Math.round((t.revenue - t.cost) * 100) / 100 })),
      daily,
      lastSyncedAt: lastSync?.finishedAt ?? null,
    },
    { headers: NO_STORE }
  );
});
