// GET /api/dashboard/expenses?month=2026-10 — зардал (onec_pl, Postgres): бүлгээр, өмнөх сартай харьцуулсан %, сүүлийн 6 сар, данс бүрээр.
// 1С руу хандахгүй; сүүлд татсан цаг нь Борлуулалт, Мөнгөн хөрөнгийн адил (sales, pl sync).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { addMonths, currentMonth, isMonth } from "@/lib/onec/dates";
import { changePct, expenseGroupLabel } from "@/lib/onec/expense-groups";
import { lastSuccess } from "@/lib/onec/refresh";

export const dynamic = "force-dynamic";

const round2 = (v: number) => Math.round(v * 100) / 100;

export const GET = withTiming("GET /api/dashboard/expenses", async (req: Request) => {
  const denied = await requireFinanceAccess("expenses");
  if (denied) return denied;

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month)) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400 });
  const prevMonth = addMonths(month, -1);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5)); // сонгосон сар + өмнөх 5

  const [byMonthGroup, accounts, lastSync] = await Promise.all([
    prisma.$queryRaw<{ month: string; g: string; amount: number }[]>`
      SELECT month, account_group AS g, sum(amount)::float8 AS amount
        FROM onec_pl WHERE side = 'expense' AND month IN (${months[0]}, ${months[1]}, ${months[2]}, ${months[3]}, ${months[4]}, ${months[5]})
       GROUP BY month, account_group`,
    prisma.$queryRaw<{ account: string; item: string; g: string; amount: number }[]>`
      SELECT account, max(item) AS item, account_group AS g, sum(amount)::float8 AS amount
        FROM onec_pl WHERE side = 'expense' AND month = ${month}
       GROUP BY account, account_group ORDER BY sum(amount) DESC LIMIT 300`,
    lastSuccess(["sales", "pl"]),
  ]);

  // Нэг бүлэг (дэлгэцийн нэрээр) руу нэгтгэнэ: техникийн код хэзээ ч гарахгүй
  const perMonth = new Map<string, Map<string, number>>(months.map((m) => [m, new Map()]));
  for (const r of byMonthGroup) {
    const label = expenseGroupLabel(r.g);
    const m = perMonth.get(r.month);
    if (m) m.set(label, (m.get(label) ?? 0) + r.amount);
  }
  const total = (m: string) => [...(perMonth.get(m)?.values() ?? [])].reduce((s, v) => s + v, 0);
  const current = perMonth.get(month)!;
  const previous = perMonth.get(prevMonth)!;
  const labels = [...new Set([...current.keys(), ...previous.keys()])];
  const cur = total(month);

  const groups = labels
    .map((group) => {
      const amount = current.get(group) ?? 0;
      const prevAmount = previous.get(group) ?? 0;
      return { group, amount: round2(amount), prevAmount: round2(prevAmount), changePct: changePct(amount, prevAmount), share: cur ? Math.round((amount / cur) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.amount - a.amount);

  const seriesGroups = [...new Set(months.flatMap((m) => [...(perMonth.get(m)?.keys() ?? [])]))].sort((a, b) => a.localeCompare(b, "mn"));

  return NextResponse.json(
    {
      month,
      prevMonth,
      total: round2(cur),
      prevTotal: round2(total(prevMonth)),
      changePct: changePct(cur, total(prevMonth)),
      groups,
      seriesGroups,
      months: months.map((m) => ({ month: m, total: round2(total(m)), groups: Object.fromEntries(seriesGroups.map((gr) => [gr, round2(perMonth.get(m)?.get(gr) ?? 0)])) })),
      accounts: accounts.map((a) => ({ account: a.account, name: a.item, group: expenseGroupLabel(a.g), amount: round2(a.amount), share: cur ? Math.round((a.amount / cur) * 1000) / 10 : 0 })),
      lastSyncedAt: lastSync?.toISOString() ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
});
