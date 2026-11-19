// GET /api/dashboard/cash/entries?month=2026-11&q=84 сая&flow=outflow&category=suppliers&party=…&page=1&size=50 — сарын БҮХ гүйлгээний хайлт,
// шүүлт, хуудаслалт (өмнөх «сүүлийн 200» хязгааргүй). Хайлт: харилцагч, утга, дүн («84 сая», 84073015), огноо (2026-11-17, 11-17).
// Хуудас бүрийн баримтын дугаарыг (нягтлангийн лавлагаа) зөвхөн тухайн хуудасны мөрүүдэд 1С-ээс уншина. «Комментарий» хэзээ ч гарахгүй.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess, viewerCanSeePayroll } from "@/lib/onec/access";
import { loadCash } from "@/lib/onec/cash";
import { CATEGORY_LABEL, isCategoryId } from "@/lib/onec/cash-categories";
import { filterEntries, paginate, withCategories, type ReportEntry } from "@/lib/onec/cash-report";
import { loadCashRules } from "@/lib/onec/cash-rules-store";
import { currentMonth, isMonth } from "@/lib/onec/dates";
import { lookupRows, OdataError } from "@/lib/onec/odata-read";
import { withOneCYear, yearOf } from "@/lib/onec/year-context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

/** Хуудасны мөрүүдийн баримтын дугаар: баримтын төрөл бүрт нэг л хүсэлт (≤25 түлхүүр). Алдаа гарвал дугаарыг л орхино. */
async function documentNumbers(month: string, items: readonly ReportEntry[]): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const e of items) if (e.docType && e.ref) (byType.get(e.docType) ?? byType.set(e.docType, new Set()).get(e.docType)!).add(e.ref);
  const out = new Map<string, string>();
  try {
    await withOneCYear(yearOf(month), async () => {
      for (const [type, refs] of byType) {
        const rows = await lookupRows(`Document_${type}`, [...refs], "Number");
        for (const [ref, row] of rows) if (row?.Number) out.set(ref, String(row.Number).trim());
      }
    });
  } catch {
    // дугаар нь нэмэлт мэдээлэл: 1С удаан бол мөрүүд дугаарагүй харагдана
  }
  return out;
}

export const GET = withTiming("GET /api/dashboard/cash/entries", async (req: Request) => {
  const denied = await requireFinanceAccess("cash");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? currentMonth();
  if (!isMonth(month) || month > currentMonth()) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй, ирээдүйн сар биш байх ёстой" }, { status: 400, headers: NO_STORE });
  const flowRaw = sp.get("flow");
  const flow = flowRaw === "inflow" || flowRaw === "outflow" ? flowRaw : undefined;
  const categoryRaw = sp.get("category");
  const category = isCategoryId(categoryRaw) ? categoryRaw : undefined;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const size = Math.min(100, Math.max(10, Number(sp.get("size")) || 50));

  try {
    const [{ value: cash }, rules, canSeePayroll] = await Promise.all([loadCash(month), loadCashRules(), viewerCanSeePayroll()]);
    const all = withCategories(cash.entries, rules, canSeePayroll);
    const filtered = filterEntries(all, { q: sp.get("q") ?? undefined, flow, category, party: sp.get("party") ?? undefined, account: sp.get("account") ?? undefined });
    const pageOf = paginate(filtered, page, size);
    const numbers = await documentNumbers(month, pageOf.items);
    const net = filtered.reduce((s, e) => s + (e.type === "inflow" ? e.amount : -e.amount), 0);
    return NextResponse.json(
      {
        ...pageOf,
        netTotal: Math.round(net * 100) / 100,
        items: pageOf.items.map((e) => ({
          id: e.id,
          date: e.date,
          type: e.type,
          account: e.account,
          counterpart: e.counterpart,
          memo: e.memo,
          article: e.article,
          amount: e.amount,
          category: e.category,
          categoryLabel: CATEGORY_LABEL[e.category],
          payroll: e.payroll === true,
          // хамгийн доод drill-down: нягтлангийн лавлагаа (цалингийн нэгтгэсэн мөрөнд байхгүй)
          accounting: e.payroll && !canSeePayroll ? null : { document: e.document, documentNumber: numbers.get(e.ref) ?? null, account: e.counterAccount ?? "", accountName: e.counterAccountName ?? "" },
        })),
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
