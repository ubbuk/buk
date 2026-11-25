// GET /api/dashboard/cash/accounts — «Мөнгөн хөрөнгө» табын «Данснууд»: данс бүрийн карт (нэр, одоогийн үлдэгдэл, өнөөдрийн орсон/гарсан) ба бүх дансны нийт.
// Эх сурвалж нь /api/dashboard/cash-тай ижил (1С-ээс уншсан сарын мэдээ, 5 минутын cache): өөр хүсэлт нэмэхгүй. Дансны бүтэн дугаар зөвхөн ADMIN-д.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { loadCash } from "@/lib/onec/cash";
import { buildAccountCards } from "@/lib/onec/cash-accounts";
import { loadAccountSettings } from "@/lib/onec/cash-accounts-store";
import { asOfDate, currentMonth, today } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/cash/accounts", async (req: Request) => {
  const denied = await requireFinanceAccess("cash");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  const isAdmin = session?.user.role === "ADMIN";

  try {
    const month = currentMonth();
    const [{ value: cash, meta }, settings] = await Promise.all([loadCash(month, new URL(req.url).searchParams.get("refresh") === "1"), loadAccountSettings()]);
    const cards = buildAccountCards(cash, settings, { today: today(), isAdmin });
    return NextResponse.json(
      { ...cards, today: today(), asOf: asOfDate(month), canManage: isAdmin, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } },
      { headers: NO_STORE }
    );
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
