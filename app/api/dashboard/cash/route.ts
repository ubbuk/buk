// GET /api/dashboard/cash?month=2026-10[&refresh=1] — сарын мөнгөн хөрөнгө: орлого, зарлага, дотоод шилжүүлэг, эхний/эцсийн үлдэгдэл.
// 1С-ийн OData-аас шууд (ЗӨВХӨН УНШИХ; AccountingRegister_Хозрасчетный, 11xx данс), 5 минутын cache; 1С холбогдохгүй бол сүүлд хадгалсан
// (meta.stale). refresh=1 нь cache-ийг тойрно, гэхдээ хамгийн багадаа 60 сек тутамд. Хуучин onec_cash, /hs/dash/cash ашиглагдахгүй.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { loadCash } from "@/lib/onec/cash";
import { currentMonth, isMonth } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
// 1С OData дуудлага бүр хамгийн ихдээ 60 сек (lib/onec/cash.ts)
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/cash", async (req: Request) => {
  const denied = await requireFinanceAccess("cash");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? currentMonth();
  if (!isMonth(month) || month > currentMonth()) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй, ирээдүйн сар биш байх ёстой" }, { status: 400, headers: NO_STORE });

  try {
    const { value, meta } = await loadCash(month, sp.get("refresh") === "1");
    return NextResponse.json({ ...value, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
