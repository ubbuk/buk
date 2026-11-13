// GET /api/dashboard/cash?month=2026-10
// Мөнгөн хөрөнгийн орлого/зарлага: нийт, данс тус бүрээр, өдрөөр, зүйлээр
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { currentMonth, isMonth, monthRange } from "@/lib/onec/dates";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/cash", async (req: Request) => {
  const denied = await requireFinanceAccess("cash");
  if (denied) return denied;

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month)) {
    return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400 });
  }
  const { from, to } = monthRange(month);

  const [totals, daily, byAccount, byItem, recent, lastSync] = await Promise.all([
    prisma.$queryRaw<{ inflow: number; outflow: number; transactions: number; accounts: number }[]>`
      SELECT coalesce(sum(inflow),0)::float8 AS inflow, coalesce(sum(outflow),0)::float8 AS outflow,
             count(*)::int AS transactions, count(DISTINCT account)::int AS accounts
        FROM onec_cash WHERE date BETWEEN ${from}::date AND ${to}::date`,
    prisma.$queryRaw<{ date: string; inflow: number; outflow: number }[]>`
      SELECT date::text AS date, sum(inflow)::float8 AS inflow, sum(outflow)::float8 AS outflow
        FROM onec_cash WHERE date BETWEEN ${from}::date AND ${to}::date
       GROUP BY date ORDER BY date`,
    prisma.$queryRaw<{ account: string; inflow: number; outflow: number }[]>`
      SELECT account, sum(inflow)::float8 AS inflow, sum(outflow)::float8 AS outflow
        FROM onec_cash WHERE date BETWEEN ${from}::date AND ${to}::date
       GROUP BY account ORDER BY sum(inflow) + sum(outflow) DESC`,
    prisma.$queryRaw<{ item: string; inflow: number; outflow: number }[]>`
      SELECT item, sum(inflow)::float8 AS inflow, sum(outflow)::float8 AS outflow
        FROM onec_cash WHERE date BETWEEN ${from}::date AND ${to}::date
       GROUP BY item ORDER BY sum(inflow) + sum(outflow) DESC LIMIT 10`,
    prisma.$queryRaw<
      { id: string; date: string; account: string; client: string; item: string; inflow: number; outflow: number; memo: string; doc: string }[]
    >`
      SELECT id::text AS id, date::text AS date, account, client, item, inflow::float8 AS inflow, outflow::float8 AS outflow, memo, doc
        FROM onec_cash WHERE date BETWEEN ${from}::date AND ${to}::date
       ORDER BY date DESC, id DESC LIMIT 100`,
    prisma.onecSyncLog.findFirst({
      where: { ok: true, kind: "cash" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  return NextResponse.json({
    month,
    totals: totals[0],
    daily,
    byAccount,
    byItem,
    recent,
    lastSyncedAt: lastSync?.finishedAt ?? null,
  });
});
