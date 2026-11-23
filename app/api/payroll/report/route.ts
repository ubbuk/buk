// GET /api/payroll/report?month=2026-09 — «Цалин» табын удирдлагын тайлан: цалингийн нийт зардал, задаргаа, «хаашаа очсон», өмнөх сартай харьцуулалт, 12 сар.
// Postgres-оос (sync-ээр бөглөгдсөн), 1С руу хандахгүй; хүн, хэлтсийн мэдээлэл энд огт байхгүй. Эрх: дүр БА canViewPayroll.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requirePayrollAccess } from "@/lib/onec/access";
import { addMonths, currentMonth, isMonth } from "@/lib/onec/dates";
import { NO_STORE } from "@/lib/onec/payroll-api";
import { readPayrollMonthsBetween } from "@/lib/onec/payroll-store";
import { buildPayrollView } from "@/lib/onec/payroll-view";
import { lastSuccess } from "@/lib/onec/refresh";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/payroll/report", async (req: Request) => {
  const auth = await requirePayrollAccess();
  if (!auth.ok) return auth.res;
  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isMonth(month)) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400, headers: NO_STORE });
  const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)); // сонгосон сар + өмнөх 11

  const [rows, lastSync] = await Promise.all([readPayrollMonthsBetween(months[0], month), lastSuccess(["payroll-month"])]);
  return NextResponse.json({ ...buildPayrollView(rows, months), lastSyncedAt: lastSync?.toISOString() ?? null }, { headers: NO_STORE });
});
