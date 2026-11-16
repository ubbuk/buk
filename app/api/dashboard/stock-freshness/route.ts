// GET /api/dashboard/stock-freshness — сүүлийн амжилттай stock sync-ийн цаг ба «хуучирсан» эсэх (самбарын шар анхааруулга)
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { lastSuccess } from "@/lib/onec/refresh";
import { evaluateStockFreshness, formatUbDateTime } from "@/lib/onec/sync-schedule";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/stock-freshness", async () => {
  const denied = await requireFinanceAccess("stock"); // нярав ч харна (зөвхөн цаг)
  if (denied) return denied;

  const last = await lastSuccess(["stock"]);
  const f = evaluateStockFreshness(last, new Date());
  return NextResponse.json(
    { stale: f.stale, never: f.never, message: f.message, lastSyncedAt: last?.toISOString() ?? null, lastSyncedLabel: last ? formatUbDateTime(last) : null },
    { headers: { "Cache-Control": "no-store" } }
  );
});
