// GET /api/dashboard/production/docs?from=&to=&id=<бүтээгдэхүүний мөрийн id>&group=<цех> — хамгийн доод drill-down: тухайн бүтээгдэхүүний баримтууд
// (дугаар, өдөр, цаг, цех, тоо, батлагдсан эсэх). Эрхийн хүрээ /api/dashboard/production-тэй ижил (BOSS зөвхөн өөрийн цех).
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { today } from "@/lib/onec/dates";
import { monthsOfRange, parseRange } from "@/lib/onec/production-range";
import { resolveProductionScope } from "@/lib/onec/production-scope";
import { readProductionMonths } from "@/lib/onec/production-store";
import { productDocs, visibleLines } from "@/lib/onec/production-view";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/production/docs", async (req: Request) => {
  const denied = await requireFinanceAccess("production");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const range = parseRange(sp.get("from"), sp.get("to"), today());
  const id = sp.get("id") ?? "";
  if (!range || !/^(finished|semi|crusher)\|/.test(id)) return NextResponse.json({ error: "Хүчингүй хүсэлт" }, { status: 400 });

  const rows = await readProductionMonths(monthsOfRange(range));
  const pairs = [...new Map(rows.lines.map((l) => [`${l.department}|${l.group}`, { department: l.department, group: l.group ?? l.department }])).values()];
  const { scope } = await resolveProductionScope(session.user.id, session.user.role, pairs);
  const lines = visibleLines(rows.lines, scope, { group: sp.get("group")?.slice(0, 120) || null, from: range.from, to: range.to });
  return NextResponse.json({ docs: productDocs(lines, id) }, { headers: { "Cache-Control": "no-store" } });
});
