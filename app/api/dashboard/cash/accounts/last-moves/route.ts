// GET /api/dashboard/cash/accounts/last-moves — энэ сард хөдөлгөөнгүй дансуудын СҮҮЛИЙН гүйлгээ ({ [дансны ID]: { date, amount } | null }): «Хөдөлгөөнгүй · сүүлд 08-14».
// Картууд (/accounts) хурдан гарахын тулд тусдаа, хоёр дахь удаа ачаалагдана. Сараар ухарч хөнгөн Turnovers хүсэлтээр хайна (ЗӨВХӨН GET), 5 минутын cache.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { loadCash } from "@/lib/onec/cash";
import { publicId } from "@/lib/onec/cash-accounts";
import { activeKeys, findLastMoves, type LastMove } from "@/lib/onec/cash-activity";
import { defaultLastMoveDeps } from "@/lib/onec/cash-last-store";
import { currentMonth, today } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/cash/accounts/last-moves", async () => {
  const denied = await requireFinanceAccess("cash");
  if (denied) return denied;
  try {
    const now = today();
    const { value: cash } = await loadCash(currentMonth());
    const active = activeKeys(cash, now);
    const inactive = cash.accounts.filter((a) => !active.has(a.key));
    // Сар бүрийн хөнгөн хүсэлт, сарын мэдээ cache-тай тул дахин дуудахад үргэлжилнэ. complete=false бол хайж дуусаагүй дансууд үлдсэн (хугацааны төсөв).
    const found = await findLastMoves(inactive.map((a) => a.key), now, defaultLastMoveDeps);
    const moves: Record<string, LastMove | null> = {};
    for (const a of inactive) if (found.has(a.key)) moves[publicId(a.key)] = found.get(a.key) ?? null;
    return NextResponse.json({ moves, complete: inactive.every((a) => found.has(a.key)) }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
