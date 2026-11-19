// GET /api/dashboard/cash/report?month=2026-11[&refresh=1] — «Мөнгөн хөрөнгө» табын тайлан: 4 том тоо, дотоод шилжүүлэг, «Хаанаас орж ирсэн» /
// «Хаашаа гарсан» ангилал (харилцагчаар задарсан), «Бусад»-ын хувь. Эх сурвалж нь /api/dashboard/cash-тай ижил (1С OData, 5 минутын cache).
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess, viewerCanSeePayroll } from "@/lib/onec/access";
import { loadCash } from "@/lib/onec/cash";
import { buildCashReport, withCategories } from "@/lib/onec/cash-report";
import { loadCashRules } from "@/lib/onec/cash-rules-store";
import { currentMonth, isMonth } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/cash/report", async (req: Request) => {
  const denied = await requireFinanceAccess("cash");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? currentMonth();
  if (!isMonth(month) || month > currentMonth()) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй, ирээдүйн сар биш байх ёстой" }, { status: 400, headers: NO_STORE });

  try {
    const [{ value: cash, meta }, rules, canSeePayroll] = await Promise.all([loadCash(month, sp.get("refresh") === "1"), loadCashRules(), viewerCanSeePayroll()]);
    const report = buildCashReport(cash, withCategories(cash.entries, rules, canSeePayroll));
    return NextResponse.json(
      { ...report, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } },
      { headers: NO_STORE }
    );
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
