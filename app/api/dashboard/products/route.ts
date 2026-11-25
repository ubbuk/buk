// GET /api/dashboard/products?q=1000&from=2026-10-01&to=2026-10-31&p=<id> — «Бүтээгдэхүүн» таб: хайлт (БҮХ цехээс), хайлтгүй үед хамгийн их үйлдвэрлэсэн/зарсан 10.
// p = сонгосон бүтээгдэхүүн: өдөр бүр, сүүлийн 12 сар. 1С руу хандахгүй (DB-ээс). Цехийн эрхтэй (BOSS) хэрэглэгчид зөвхөн үйлдвэрлэл: зарсан, агуулахын тоо ирэхгүй.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { addDays, isDate, monthRange, today as todayUb } from "@/lib/onec/dates";
import { buildProductSearch, last12Months } from "@/lib/onec/product-search";
import { readSalesQty, readStockNow } from "@/lib/onec/product-store";
import { groupFor } from "@/lib/onec/production-groups";
import { resolveProductionScope } from "@/lib/onec/production-scope";
import { readProductionLines } from "@/lib/onec/production-store";
import { visibleLines, visibleMoves } from "@/lib/onec/production-view";

export const dynamic = "force-dynamic";

const MAX_SPAN_DAYS = 400;

export const GET = withTiming("GET /api/dashboard/products", async (req: Request) => {
  const denied = await requireFinanceAccess("products");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const now = todayUb();
  const def = monthRange(now.slice(0, 7));
  let from = isDate(sp.get("from")) ? sp.get("from")! : def.from;
  let to = isDate(sp.get("to")) ? sp.get("to")! : def.to;
  if (from > to) [from, to] = [to, from];
  if (Date.parse(to) - Date.parse(from) > MAX_SPAN_DAYS * 86_400_000) from = addDays(to, -MAX_SPAN_DAYS);

  const m12 = last12Months(now);
  const readFrom = from < `${m12[0]}-01` ? from : `${m12[0]}-01`;
  const readTo = to > monthRange(now.slice(0, 7)).to ? to : monthRange(now.slice(0, 7)).to;
  const lines = await readProductionLines(readFrom.slice(0, 7), readTo.slice(0, 7));
  const pairs = [...new Set(lines.map((l) => l.department))].map((d) => ({ department: d, group: groupFor(d).name }));
  const { scope } = await resolveProductionScope(session.user.id, session.user.role, pairs);
  const showSales = scope.departments === null;

  const [sales, stock] = showSales ? await Promise.all([readSalesQty(readFrom, readTo), readStockNow()]) : [[], { asOf: null, rows: [] }];
  const view = buildProductSearch({
    q: (sp.get("q") ?? "").slice(0, 120),
    from,
    to,
    today: now,
    selected: (sp.get("p") ?? "").slice(0, 200) || null,
    lines: visibleLines(lines, scope),
    moves: visibleMoves(lines, scope),
    sales,
    stock: stock.rows,
    showSales,
  });
  return NextResponse.json({ ...view, stockAsOf: stock.asOf, today: now }, { headers: { "Cache-Control": "no-store" } });
});
