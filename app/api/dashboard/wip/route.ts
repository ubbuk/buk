// GET /api/dashboard/wip?month=2026-10[&refresh=1] — «Дуусаагүй үйлдвэрлэл» (142x) сарын эцсийн үлдэгдэл (1С OData Balance, ЗӨВХӨН УНШИХ).
// Агуулах табын тусдаа KPI: хуудас агуулахын мэдээллийг (Postgres) хүлээлгүй харуулж, энэ картыг тусад нь ачаална. 5 минутын cache.
// Нягтлан бодох бүртгэлийн дүн тул удирдлагад (Борлуулалт табын эрх), нярав харахгүй.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { currentMonth, isMonth } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";
import { loadWip } from "@/lib/onec/wip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/wip", async (req: Request) => {
  const denied = await requireFinanceAccess("sales");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? currentMonth();
  if (!isMonth(month) || month > currentMonth()) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй, ирээдүйн сар биш байх ёстой" }, { status: 400, headers: NO_STORE });

  try {
    const { value, meta } = await loadWip(month, sp.get("refresh") === "1");
    return NextResponse.json({ ...value, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
