// GET /api/dashboard/production?from=2026-11-01&to=2026-11-25&dept=<карт> — «Үйлдвэрлэл» таб (onec_production_*, Postgres): цех бүрийн карт, KPI, график, өртөг.
// Хугацаа өгөөгүй бол «Энэ сар» (сарын 1-ээс өнөөдөр). Картын бүтэц нь 1С-ийн Parent биш, өөрсдийн тохиргооноос (lib/onec/production-groups.ts).
// 1С руу хандахгүй: sync (lib/onec/production-store.ts) бичсэн агшин зургаас. BOSS зөвхөн өөрийн цехийг харна (production-scope.ts). Баримтын дугаар энд ИРЭХГҮЙ (/docs-д л).
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { addDays, addMonths, currentMonth, today } from "@/lib/onec/dates";
import { groupFor } from "@/lib/onec/production-groups";
import { monthsOfRange, parseRange, presetRange } from "@/lib/onec/production-range";
import { resolveProductionScope } from "@/lib/onec/production-scope";
import { readLastReports, readProductionLines, readProductionMonths } from "@/lib/onec/production-store";
import { buildProductionView } from "@/lib/onec/production-view";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/production", async (req: Request) => {
  const denied = await requireFinanceAccess("production");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const now = today();
  const cur = currentMonth();
  const given = sp.has("from") || sp.has("to");
  const range = parseRange(sp.get("from"), sp.get("to"), now) ?? (given ? null : presetRange("month", now));
  if (!range) return NextResponse.json({ error: "from, to нь YYYY-MM-DD, from ≤ to ≤ өнөөдөр, 62 хоногоос ихгүй байх ёстой" }, { status: 400 });
  const dept = sp.get("dept")?.slice(0, 120) || null;
  const month = range.to.slice(0, 7);

  // Хугацаа, «Энэ сар», «Сүүлийн 7 хоног» (өнөөдрөөс 6 хоногийн өмнөөс: өмнөх сард орж болно)
  const months = [...new Set([...monthsOfRange(range), cur, addDays(now, -6).slice(0, 7)])].sort();
  const [rows, history, lastReports] = await Promise.all([readProductionMonths(months), readProductionLines(addMonths(month, -11), month), readLastReports(addMonths(cur, -1))]);
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
