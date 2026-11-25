// GET /api/dashboard/production/docs?month=2026-11&id=<бүтээгдэхүүний мөрийн id> — хамгийн доод drill-down: тухайн бүтээгдэхүүний баримтууд (дугаар, өдөр, цех, тоо, батлагдсан эсэх).
// Эрхийн хүрээ /api/dashboard/production-тэй ижил (BOSS зөвхөн өөрийн цех).
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { currentMonth, isMonth } from "@/lib/onec/dates";
import { normalizeDepartment } from "@/lib/onec/production-names";
import { resolveProductionScope } from "@/lib/onec/production-scope";
import { readProductionMonth } from "@/lib/onec/production-store";
import { productDocs } from "@/lib/onec/production-view";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/production/docs", async (req: Request) => {
  const denied = await requireFinanceAccess("production");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? currentMonth();
  const id = sp.get("id") ?? "";
  if (!isMonth(month) || month > currentMonth() || !/^(finished|semi|crusher)\|/.test(id)) return NextResponse.json({ error: "Хүчингүй хүсэлт" }, { status: 400 });

  const rows = await readProductionMonth(month);
  const { scope } = await resolveProductionScope(session.user.id, session.user.role, [...new Set(rows.lines.map((l) => l.department))]);
  const visible = rows.lines.filter((l) => scope.departments === null || scope.departments.includes(normalizeDepartment(l.department)));
  return NextResponse.json({ docs: productDocs(visible, id) }, { headers: { "Cache-Control": "no-store" } });
});
