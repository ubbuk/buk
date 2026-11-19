// GET /api/dashboard/cash/trend?year=2026[&refresh=1] — 12 сарын орлого, зарлага (дотоод шилжүүлэг тусад нь). Сар бүр хөнгөн хүсэлт, сар тус бүрийн cache.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { loadCashTrend } from "@/lib/onec/cash-trend";
import { currentMonth } from "@/lib/onec/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/cash/trend", async (req: Request) => {
  const denied = await requireFinanceAccess("cash");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const year = sp.get("year") ?? currentMonth().slice(0, 4);
  if (!/^\d{4}$/.test(year) || year > currentMonth().slice(0, 4)) return NextResponse.json({ error: "year нь YYYY хэлбэртэй, ирээдүйн он биш байх ёстой" }, { status: 400, headers: NO_STORE });

  const { months, failed, fetchedAt } = await loadCashTrend(year, sp.get("refresh") === "1");
  return NextResponse.json({ year, months, failed, fetchedAt: new Date(fetchedAt).toISOString() }, { headers: NO_STORE });
});
