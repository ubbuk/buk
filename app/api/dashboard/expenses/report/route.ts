// GET /api/dashboard/expenses/report?month=2026-10 — «Зардал» табын тайлан (onec_pl, Postgres): ердийн ангилал (дансны кодгүй) → зардлын нэр,
// өмнөх сартай харьцуулалт, сүүлийн 12 сар, «Бусад»-ын хувь. 1С руу хандахгүй. Ангиллын дүрмийг админ /admin/expense-rules дээр засна.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { addMonths, currentMonth, isMonth } from "@/lib/onec/dates";
import { buildExpenseView, type PlRow } from "@/lib/onec/expense-view";
import { loadExpenseRules } from "@/lib/onec/expense-rules-store";
import { lastSuccess } from "@/lib/onec/refresh";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/expenses/report", async (req: Request) => {
  const denied = await requireFinanceAccess("expenses");
  if (denied) return denied;

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month)) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400, headers: NO_STORE });
  const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)); // сонгосон сар + өмнөх 11

  const [rows, loadedRows, rules, lastSync] = await Promise.all([
    prisma.$queryRaw<PlRow[]>`
      SELECT month, account, item, sum(amount)::float8 AS amount
        FROM onec_pl WHERE side = 'expense' AND month >= ${months[0]} AND month <= ${month}
       GROUP BY month, account, item`,
    // сар татагдсан эсэх: ямар ч мөр (орлого, зардал) байвал татагдсан; «0 зардал» ба «татагдаагүй»-г ялгана
    prisma.$queryRaw<{ month: string }[]>`SELECT DISTINCT month FROM onec_pl WHERE month >= ${months[0]} AND month <= ${month}`,
    loadExpenseRules(),
    lastSuccess(["sales", "pl"]),
  ]);

  const view = buildExpenseView(rows, months, rules, new Set(loadedRows.map((r) => r.month)));
  return NextResponse.json({ ...view, empty: !view.months[view.months.length - 1].loaded, lastSyncedAt: lastSync?.toISOString() ?? null }, { headers: NO_STORE });
});
