// GET /api/dashboard/production?month=2026-11 — «Үйлдвэрлэл» таб (onec_production_*, Postgres): өнөөдөр / сарын гарц, өдрөөр, бүтээгдэхүүнээр, цехээр, бутлуур, өртөг.
// 1С руу хандахгүй: sync (lib/onec/production-store.ts) бичсэн агшин зургаас. BOSS зөвхөн өөрийн цехийг харна (production-scope.ts). Баримтын дугаар энд ИРЭХГҮЙ (/docs-д л).
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { currentMonth, isMonth, today } from "@/lib/onec/dates";
import { resolveProductionScope } from "@/lib/onec/production-scope";
import { readProductionMonth } from "@/lib/onec/production-store";
import { buildProductionView } from "@/lib/onec/production-view";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/production", async (req: Request) => {
  const denied = await requireFinanceAccess("production");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month) || month > currentMonth()) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй, ирээдүйн сар биш байх ёстой" }, { status: 400 });

  const rows = await readProductionMonth(month);
  const onecDepartments = [...new Set([...rows.lines.map((l) => l.department), ...rows.ledger.map((r) => r.department)])];
  const { scope, note } = await resolveProductionScope(session.user.id, session.user.role, onecDepartments);
  const view = buildProductionView({ month, current: currentMonth(), today: today(), lines: rows.lines, ledger: rows.ledger, scope, scopeNote: note, lastSyncedAt: rows.syncedAt });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
});
