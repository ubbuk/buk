// GET /api/payroll/employees?year=2026[&refresh=1] — ажилтнаар олгосон, үлдэгдэл, сар бүрийн задаргаа. ХҮНИЙ ТҮВШНИЙ мэдээлэл: 1С-ээс нээх бүрд шууд уншина
// (ЗӨВХӨН УНШИХ), Postgres-д ХАДГАЛАГДАХГҮЙ. Нээлт бүр хэн, хэзээ, аль он гэж audit-д бүртгэгдэнэ; бүртгэж чадахгүй бол өгөгдөл өгөхгүй (fail-closed).
// Эрх: дүр БА canViewPayroll.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { clientIp } from "@/lib/client-ip";
import { prisma } from "@/lib/prisma";
import { requirePayrollAccess } from "@/lib/onec/access";
import { loadPayrollEmployees } from "@/lib/onec/payroll";
import { NO_STORE, odataErrorResponse, parseYear } from "@/lib/onec/payroll-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withTiming("GET /api/payroll/employees", async (req: Request) => {
  const auth = await requirePayrollAccess();
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const y = parseYear(sp);
  if ("error" in y) return y.error;

  try {
    await prisma.auditLog.create({
      data: { entityType: "PayrollEmployees", entityId: y.year, action: "ONEC_ODATA_VIEW", actorId: auth.userId, afterJson: JSON.stringify({ year: y.year, refresh: sp.get("refresh") === "1" }), ipAddress: clientIp(req.headers) },
    });
  } catch {
    return NextResponse.json({ error: "Хандалтыг бүртгэж чадсангүй. Дахин оролдоно уу" }, { status: 503, headers: NO_STORE });
  }
  try {
    const { value, meta } = await loadPayrollEmployees(y.year, sp.get("refresh") === "1");
    return NextResponse.json({ ...value, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    return odataErrorResponse(e);
  }
});
