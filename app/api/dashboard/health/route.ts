// GET /api/dashboard/health?ym=2026-11 — 1С самбарын дээд талын анхааруулга:
//  * selected: сонгосон оны 1С бааз (ONEC_BASES) тохируулагдсан эсэх -> «Энэ оны 1С бааз холбогдоогүй»
//  * current: одоогийн оны баазад сүүлийн 7 хоногт шинэ баримт орсон эсэх (lib/onec/health.ts). Хоцорсон бол ADMIN-д мэдэгдэл (24 цагт нэг удаа).
// 1С-ээс ЗӨВХӨН УНШИНА, 5 минутын cache. Бүх 1С самбарыг харах эрхтэй дүр (нярав орно) авна.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { isBaseConfigured } from "@/lib/onec/bases";
import { currentMonth, isMonth } from "@/lib/onec/dates";
import { BASE_MISSING_MESSAGE } from "@/lib/onec/bases";
import { checkCurrentBase, STALE_MESSAGE } from "@/lib/onec/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/health", async (req: Request) => {
  const denied = await requireFinanceAccess("stock");
  if (denied) return denied;

  const ym = new URL(req.url).searchParams.get("ym") ?? currentMonth();
  if (!isMonth(ym)) return NextResponse.json({ error: "ym нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400, headers: NO_STORE });
  const selectedYear = ym.slice(0, 4);

  const { health, notified } = await checkCurrentBase();
  return NextResponse.json(
    {
      selected: { year: selectedYear, configured: isBaseConfigured(selectedYear) },
      current: { year: health.year, configured: health.configured, unreachable: health.unreachable, lastDocument: health.lastDocument, daysSince: health.daysSince, stale: health.stale },
      messages: { baseMissing: BASE_MISSING_MESSAGE, stale: STALE_MESSAGE },
      notified,
    },
    { headers: NO_STORE }
  );
});
