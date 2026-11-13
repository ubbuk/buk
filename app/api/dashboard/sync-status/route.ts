// GET /api/dashboard/sync-status?month=2026-11 — ар талын татах ажил дууссан эсэх, сүүлд шинэчилсэн цаг (хуудас түр удаан асууна)
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { currentMonth, isMonth } from "@/lib/onec/dates";
import { getSyncStatus } from "@/lib/onec/refresh";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/sync-status", async (req: Request) => {
  const denied = await requireFinanceAccess("stock"); // нярав ч цагийг харна (зөвхөн цаг)
  if (denied) return denied;

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month)) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400 });
  return NextResponse.json(await getSyncStatus(month), { headers: { "Cache-Control": "no-store" } });
});
