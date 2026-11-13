// GET /api/dashboard/year?tab=sales|expenses&year=2026 — «Бүтэн жил»: 12 сарын дүн, өмнөх онтой харьцуулалт (Postgres, 1С руу хандахгүй).
// Өмнөх оны сар өгөгдөлгүй бол prevAmount = null (0 гэж харуулахгүй).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { currentMonth } from "@/lib/onec/dates";
import { changePct } from "@/lib/onec/expense-groups";

export const dynamic = "force-dynamic";

const round2 = (v: number) => Math.round(v * 100) / 100;

export const GET = withTiming("GET /api/dashboard/year", async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const tab = sp.get("tab");
  // Эрхийг эхэлж шалгана (буруу tab-тай ч нэвтрээгүй хүнд 401): таб тодорхойгүй бол Борлуулалтын эрхээр
  const denied = await requireFinanceAccess(tab === "expenses" ? "expenses" : "sales");
  if (denied) return denied;
  if (tab !== "sales" && tab !== "expenses") return NextResponse.json({ error: "tab нь sales эсвэл expenses байх ёстой" }, { status: 400 });

  const year = Number(sp.get("year"));
  if (!/^\d{4}$/.test(sp.get("year") ?? "") || year > Number(currentMonth().slice(0, 4))) {
    return NextResponse.json({ error: "year нь YYYY хэлбэртэй, ирээдүйн он биш байх ёстой" }, { status: 400 });
  }
  const from = `${year - 1}-01`;
  const to = `${year}-12`;

  const rows =
    tab === "sales"
      ? await prisma.$queryRaw<{ month: string; amount: number }[]>`
          SELECT to_char(date, 'YYYY-MM') AS month, sum(amount)::float8 AS amount
            FROM onec_sales WHERE date BETWEEN ${`${from}-01`}::date AND ${`${to}-31`}::date GROUP BY 1`
      : await prisma.$queryRaw<{ month: string; amount: number }[]>`
          SELECT month, sum(amount)::float8 AS amount
            FROM onec_pl WHERE side = 'expense' AND month BETWEEN ${from} AND ${to} GROUP BY month`;
  const byMonth = new Map(rows.map((r) => [r.month, r.amount]));

  const months = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    const cur = byMonth.get(`${year}-${mm}`);
    const prev = byMonth.get(`${year - 1}-${mm}`);
    return { month: `${year}-${mm}`, amount: round2(cur ?? 0), hasData: cur !== undefined, prevAmount: prev === undefined ? null : round2(prev) };
  });
  const total = round2(months.reduce((s, m) => s + m.amount, 0));
  const hasPrev = months.some((m) => m.prevAmount !== null);
  // Өмнөх онтой зөвхөн хоёр талд өгөгдөлтэй саруудыг харьцуулна (дутуу жилийг буруу харьцуулахгүй)
  const both = months.filter((m) => m.hasData && m.prevAmount !== null);
  const cmp = round2(both.reduce((s, m) => s + m.amount, 0));
  const cmpPrev = round2(both.reduce((s, m) => s + (m.prevAmount ?? 0), 0));

  return NextResponse.json(
    { tab, year, months, total, hasData: months.some((m) => m.hasData), hasPrev, comparedMonths: both.length, changePct: both.length ? changePct(cmp, cmpPrev) : null },
    { headers: { "Cache-Control": "no-store" } }
  );
});
