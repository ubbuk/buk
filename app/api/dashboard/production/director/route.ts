// GET /api/dashboard/production/director?day=2026-11-18 — захирлын харагдац: тэр өдөр цех бүр юу хийсэн, сарын явц.
// day байхгүй бол гарцтай хамгийн сүүлийн өдөр. 1С руу хандахгүй. BOSS зөвхөн өөрийн цех. Баримтын дугаар, цаг, нягтлангийн төлөв энд ИРЭХГҮЙ.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { loadProduction } from "@/lib/onec/production-load";
import { buildDirectorView } from "@/lib/onec/production-view";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/production/director", async (req: Request) => {
  const denied = await requireFinanceAccess("production");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const { now, requested, rows, lastReports, scope, note } = await loadProduction(session.user, new URL(req.url).searchParams.get("day"));
  const view = buildDirectorView({ day: requested, today: now, lines: rows.lines, scope, scopeNote: note, lastReports, lastSyncedAt: rows.syncedAt });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
});
