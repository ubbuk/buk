// GET /api/dashboard/overview — мониторингийн «1С · Санхүүгийн тойм»: агуулах, авлага (1201), энэ сарын борлуулалтын нийт дүн.
// ЗӨВХӨН Postgres-ийн sync-ийн өгөгдлөөс (lib/onec/overview.ts): 1С руу хандахгүй. Эрх: ADMIN, DIRECTOR, CHIEF_ACCOUNTANT, BOSS
// (lib/onec/roles.ts OVERVIEW_ROLES), сервер дээр хүсэлт бүрд шалгана; бусдад өгөгдөл огт буцахгүй.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { withTiming } from "@/lib/api-timing";
import { loadFinanceOverview } from "@/lib/onec/overview";
import { canViewOverview } from "@/lib/onec/roles";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/overview", async () => {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401, headers: NO_STORE });
  if (!canViewOverview(session.user.role)) return NextResponse.json({ error: "Энэ мэдээллийг үзэх эрхгүй" }, { status: 403, headers: NO_STORE });
  return NextResponse.json(await loadFinanceOverview(new Date(), session.user.role), { headers: NO_STORE });
});
