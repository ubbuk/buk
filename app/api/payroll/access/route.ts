// GET /api/payroll/access — «Цалин» табыг харуулах эсэх (цэс). Зөвхөн {allowed}: өгөгдөл биш. Дүр БА canViewPayroll хоёуланг DB-ээс шалгана.
// Нэвтрээгүй бол 401; нэвтэрсэн боловч эрхгүй бол 200 {allowed:false} (цэс нууцлагдана).
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requirePayrollAccess } from "@/lib/onec/access";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/payroll/access", async () => {
  const auth = await requirePayrollAccess();
  if (!auth.ok && auth.res.status === 401) return auth.res;
  return NextResponse.json({ allowed: auth.ok }, { headers: { "Cache-Control": "no-store" } });
});
