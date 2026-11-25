// GET /api/dashboard/production?from=2026-11-24&to=2026-11-24&dept=<цех> — «Үйлдвэрлэл» таб (onec_production_*, Postgres): цех бүрийн карт, KPI, график, өртөг.
// Хугацаа өгөөгүй бол хамгийн сүүлд үйлдвэрлэлтэй өдөр. 1С руу хандахгүй: sync (lib/onec/production-store.ts) бичсэн агшин зургаас.
// BOSS зөвхөн өөрийн цехийг харна (production-scope.ts). Баримтын дугаар энд ИРЭХГҮЙ (/docs-д л).
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { addMonths, currentMonth, today } from "@/lib/onec/dates";
import { monthsOfRange, parseRange } from "@/lib/onec/production-range";
import { resolveProductionScope } from "@/lib/onec/production-scope";
import { readProductionMonths } from "@/lib/onec/production-store";
import { buildProductionView, latestOutputDay } from "@/lib/onec/production-view";

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
  let range = parseRange(sp.get("from"), sp.get("to"), now);
  if (given && !range) return NextResponse.json({ error: "from, to нь YYYY-MM-DD, from ≤ to ≤ өнөөдөр, 62 хоногоос ихгүй байх ёстой" }, { status: 400 });
  const dept = sp.get("dept")?.slice(0, 120) || null;

  // Өнөөдрийн тоо (картын гарчиг) шаардлагатай тул өнөөдрийн сар үргэлж, хугацаа өгөөгүй бол өмнөх сар ч (сарын эхэнд сүүлийн өдөр өмнөх саруудад байж болно)
  const months = [...new Set([...(range ? monthsOfRange(range) : [addMonths(cur, -1)]), cur])].sort();
  const rows = await readProductionMonths(months);
  const pairs = [...new Map(rows.lines.map((l) => [`${l.department}|${l.group}`, { department: l.department, group: l.group ?? l.department }])).values()];
  const { scope, note } = await resolveProductionScope(session.user.id, session.user.role, pairs);
  if (!range) {
    const latest = latestOutputDay(rows.lines, scope, now) ?? now;
    range = { from: latest, to: latest };
  }
  const month = range.to.slice(0, 7);
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
  });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
});
