// GET /api/payroll/departments?year=2026[&refresh=1] — хэлтсээр бодсон цалин (ПодразделениеDr). 1С-ээс шууд (ЗӨВХӨН УНШИХ), 5 минутын санах ойн cache;
// Postgres-д ХАДГАЛАГДАХГҮЙ. Эрх: дүр БА canViewPayroll.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requirePayrollAccess } from "@/lib/onec/access";
import { loadPayrollDepartments } from "@/lib/onec/payroll";
import { NO_STORE, odataErrorResponse, parseYear } from "@/lib/onec/payroll-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withTiming("GET /api/payroll/departments", async (req: Request) => {
  const auth = await requirePayrollAccess();
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const y = parseYear(sp);
  if ("error" in y) return y.error;
  try {
    const { value, meta } = await loadPayrollDepartments(y.year, sp.get("refresh") === "1");
    return NextResponse.json({ ...value, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    return odataErrorResponse(e);
  }
});
