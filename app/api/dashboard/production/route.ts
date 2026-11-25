// GET /api/dashboard/production?month=2026-11&dept=<цех> — «Үйлдвэрлэл» таб (onec_production_*, Postgres): «Цех × Өдөр» хүснэгт, цехийн дэлгэрэнгүй, 12 сарын график, өртөг.
// Сар өгөөгүй эсвэл буруу бол ЗАВААЛ энэ сар. Цехийн бүтэц нь 1С-ийн Parent биш, өөрсдийн тохиргооноос (lib/onec/production-groups.ts).
// 1С руу хандахгүй: sync (lib/onec/production-store.ts) бичсэн агшин зургаас. BOSS зөвхөн өөрийн цехийг харна (production-scope.ts). Баримтын дугаар энд ИРЭХГҮЙ (/day-д л).
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { addDays, addMonths, currentMonth, monthRange, today } from "@/lib/onec/dates";
import { groupFor } from "@/lib/onec/production-groups";
import { resolveMonth } from "@/lib/onec/production-month";
import { resolveProductionScope } from "@/lib/onec/production-scope";
import { readLastReports, readProductionLines, readProductionMonths } from "@/lib/onec/production-store";
import { buildProductionView, LAG_WINDOW_DAYS } from "@/lib/onec/production-view";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/production", async (req: Request) => {
  const denied = await requireFinanceAccess("production");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const now = today();
  const cur = currentMonth();
  const month = resolveMonth(sp.get("month"), cur);
  const dept = sp.get("dept")?.slice(0, 120) || null;
  const range = monthRange(month);

  // Сар, «Энэ сар», «Сүүлийн 7 хоног» (өнөөдрөөс 6 хоногийн өмнөөс: өмнөх сард орж болно)
  const months = [...new Set([month, cur, addDays(now, -6).slice(0, 7)])].sort();
  const [rows, history, lastReports] = await Promise.all([readProductionMonths(months), readProductionLines(addMonths(month, -11), month), readLastReports(addDays(now, -(LAG_WINDOW_DAYS - 1)))]);
  const pairs = [...new Set([...rows.lines.map((l) => l.department), ...lastReports.map((r) => r.department)])].map((d) => ({ department: d, group: groupFor(d).name }));
  const { scope, note } = await resolveProductionScope(session.user.id, session.user.role, pairs);
  const view = buildProductionView({
    month,
    current: cur,
    today: now,
    lines: rows.lines,
    ledger: rows.ledgerByMonth[month] ?? [],
    scope,
    scopeNote: note,
    lastSyncedAt: rows.syncedAt,
    from: range.from,
    to: range.to,
    group: dept,
    lastReports,
    history,
  });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
});
