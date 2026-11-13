// GET /api/dashboard/usage?month=2026-10[&refresh=1] — Шаардах хуудасны зарцуулалт (1С-ээс шууд, ЗӨВХӨН УНШИХ).
// 5 минутын cache; refresh=1 нь cache-ийг тойрно, гэхдээ хамгийн багадаа 60 сек тутамд (lib/onec/odata-cache.ts).
// Эрх: удирдлага болон нярав (Зарцуулалт таб).
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { currentMonth, isMonth } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";
import { loadUsage } from "@/lib/onec/usage";

export const dynamic = "force-dynamic";
// 1С OData дуудлага бүр 30 сек хүртэл (lib/onec-odata/config.ts), Vercel-ийн анхдагч хязгаараас хамаарахгүй
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/usage", async (req: Request) => {
  const denied = await requireFinanceAccess("usage");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? currentMonth();
  if (!isMonth(month)) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400 });

  try {
    const { value, meta } = await loadUsage(month, sp.get("refresh") === "1");
    return NextResponse.json({ ...value, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
