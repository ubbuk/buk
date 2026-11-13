// GET /api/dashboard/receivables?month=2026-10 — сарын эцсийн (одоогийн сар бол өнөөдрийн) авлагын үлдэгдэл харилцагчаар.
// Postgres-ийн агшин зургаас ШУУД (1С руу хандахгүй): 1С-ийн Balance 10-110 сек тул шинэчлэлт ар талд (POST /api/dashboard/refresh
// { kind: "receivables" }, lib/onec/receivables-store.ts). Агшин зураг байхгүй бол { missing: true }; `refreshing` нь ар талын ажил явж байгааг заана.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { asOfDate, currentMonth, isMonth } from "@/lib/onec/dates";
import { fromSnapshotRows } from "@/lib/onec/receivables";
import { monthFloor, readSnapshot, receivablesState } from "@/lib/onec/receivables-store";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/receivables", async (req: Request) => {
  const denied = await requireFinanceAccess("receivables");
  if (denied) return denied;

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month) || month > currentMonth()) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй, ирээдүйн сар биш байх ёстой" }, { status: 400, headers: NO_STORE });

  const asOf = asOfDate(month);
  const [snap, state] = await Promise.all([readSnapshot(asOf, monthFloor(asOf, currentMonth())), receivablesState(asOf)]);
  if (!snap) return NextResponse.json({ missing: true, asOf, ...state, lastSyncedAt: null }, { headers: NO_STORE });
  return NextResponse.json({ missing: false, ...fromSnapshotRows(snap.date, snap.rows), ...state, lastSyncedAt: snap.syncedAt.toISOString() }, { headers: NO_STORE });
});
