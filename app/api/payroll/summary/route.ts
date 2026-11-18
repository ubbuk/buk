// GET /api/payroll/summary?year=2026 — «Цалин» табын сарын нийт дүн (бодсон, НДШ, ХХОАТ, олгосон, өглөг) + 12 сарын график. Postgres-оос (sync-ээр бөглөгдсөн),
// 1С руу хандахгүй; хүн, хэлтсийн мэдээлэл энд огт байхгүй. Эрх: дүр БА canViewPayroll.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requirePayrollAccess } from "@/lib/onec/access";
import { yearMonths } from "@/lib/onec/payroll";
import { NO_STORE, parseYear } from "@/lib/onec/payroll-api";
import { readPayrollMonths } from "@/lib/onec/payroll-store";
import { lastSuccess } from "@/lib/onec/refresh";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/payroll/summary", async (req: Request) => {
  const auth = await requirePayrollAccess();
  if (!auth.ok) return auth.res;
  const y = parseYear(new URL(req.url).searchParams);
  if ("error" in y) return y.error;

  const [rows, lastSync] = await Promise.all([readPayrollMonths(y.year), lastSuccess(["payroll-month"])]);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  // Сар бүр (одоог хүртэл): бодолт бүртгэгдээгүй сар (цалингийн бодолт бүр НДШ, ХХОАТ-ын бичилттэй; тэдгээр 0 бол өвчний тэтгэмж л орсон) нь «Бодолт хараахан бүртгэгдээгүй»; sync хараахан хийгдээгүй сар нь null
  const months = yearMonths(y.year).map((month) => {
    const r = byMonth.get(month);
    return r ? { ...r, accrualPosted: r.employerNdsh > 0 || r.employeeNdsh > 0 || r.hhoat > 0, synced: true } : { month, synced: false, accrualPosted: false };
  });
  return NextResponse.json({ year: y.year, months, lastSyncedAt: lastSync?.toISOString() ?? null }, { headers: NO_STORE });
});
