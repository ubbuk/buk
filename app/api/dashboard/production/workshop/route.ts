// GET /api/dashboard/production/workshop?name=<цех>&day=2026-11-18 — нэг цехийн хуудас: өдрийн гарц, сарын нийт, өдөр бүр, 12 сар, материал.
// BOSS зөвхөн өөрийн цех: эрхгүй цех нь 404. 1С руу хандахгүй.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { addMonths } from "@/lib/onec/dates";
import { loadProduction } from "@/lib/onec/production-load";
import { readProductionLines } from "@/lib/onec/production-store";
import { buildWorkshopView, latestOutputDay } from "@/lib/onec/production-view";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/production/workshop", async (req: Request) => {
  const denied = await requireFinanceAccess("production");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const name = sp.get("name")?.slice(0, 120);
  if (!name) return NextResponse.json({ error: "name шаардлагатай" }, { status: 400 });

  const { now, requested, rows, lastReports, scope, note } = await loadProduction(session.user, sp.get("day"));
  // Өдөр өгөөгүй бол анхдагч өдөр нь өнөөдрийн сар эсвэл өмнөх сард унана: 12 сарын түүх, материал нь тэр сарын
  const dv = (requested ?? latestOutputDay(rows.lines, scope, now) ?? now).slice(0, 7);
  const history = await readProductionLines(addMonths(dv, -11), dv);
  const view = buildWorkshopView({ name, day: requested, today: now, lines: rows.lines, history, ledger: rows.ledgerByMonth[dv] ?? [], scope, scopeNote: note, lastReports, lastSyncedAt: rows.syncedAt });
  if (!view.card) return NextResponse.json({ error: "Цех олдсонгүй эсвэл харах эрхгүй" }, { status: 404 });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
});
