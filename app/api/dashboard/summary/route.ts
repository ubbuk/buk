// GET /api/dashboard/summary?month=2026-10
// Dashboard-д хэрэгтэй борлуулалт, P&L-ийн тоог DB-ээс нэг дор буцаана (1С рүү хандахгүй)
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { currentMonth, isMonth, monthRange } from "@/lib/onec/dates";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/summary", async (req: Request) => {
  const denied = await requireFinanceAccess("sales");
  if (denied) return denied;

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month)) {
    return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400 });
  }
  const { from, to } = monthRange(month);

  const [kpi, daily, topItems, topClients, pl, lastSync] = await Promise.all([
    prisma.$queryRaw<
      { revenue: number; cost: number; gross_profit: number; documents: number; clients: number }[]
    >`SELECT coalesce(sum(amount),0)::float8        AS revenue,
             coalesce(sum(cost),0)::float8          AS cost,
             coalesce(sum(amount - cost),0)::float8 AS gross_profit,
             count(DISTINCT doc)::int               AS documents,
             count(DISTINCT client_code)::int       AS clients
        FROM onec_sales WHERE date BETWEEN ${from}::date AND ${to}::date`,
    prisma.$queryRaw<{ date: string; revenue: number; gross_profit: number }[]>`
      SELECT date::text AS date, sum(amount)::float8 AS revenue, sum(amount - cost)::float8 AS gross_profit
        FROM onec_sales WHERE date BETWEEN ${from}::date AND ${to}::date
       GROUP BY date ORDER BY date`,
    prisma.$queryRaw<{ item_code: string; item: string; qty: number; revenue: number; gross_profit: number }[]>`
      SELECT item_code, max(item) AS item, sum(qty)::float8 AS qty,
             sum(amount)::float8 AS revenue, sum(amount - cost)::float8 AS gross_profit
        FROM onec_sales WHERE date BETWEEN ${from}::date AND ${to}::date
       GROUP BY item_code ORDER BY revenue DESC LIMIT 10`,
    prisma.$queryRaw<{ client_code: string; client: string; revenue: number }[]>`
      SELECT client_code, max(client) AS client, sum(amount)::float8 AS revenue
        FROM onec_sales WHERE date BETWEEN ${from}::date AND ${to}::date
       GROUP BY client_code ORDER BY revenue DESC LIMIT 10`,
    prisma.$queryRaw<{ account_group: string; side: string; amount: number }[]>`
      SELECT account_group, side, sum(amount)::float8 AS amount
        FROM onec_pl WHERE month = ${month}
       GROUP BY account_group, side ORDER BY side, account_group`,
    prisma.onecSyncLog.findFirst({
      where: { ok: true, kind: { in: ["sales", "pl"] } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  const income = pl.filter((r) => r.side === "income").reduce((a, r) => a + r.amount, 0);
  const expense = pl.filter((r) => r.side === "expense").reduce((a, r) => a + r.amount, 0);

  return NextResponse.json({
    month,
    kpi: kpi[0],
    daily,
    topItems,
    topClients,
    pl: { byGroup: pl, income, expense, netProfit: income - expense },
    lastSyncedAt: lastSync?.finishedAt ?? null,
  });
});
