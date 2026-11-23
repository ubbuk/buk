// «Зардал» табын удирдлагад зориулсан харагдац (цэвэр функц, Postgres-ийн onec_pl-аас): үйл ажиллагааны зардал → ангилал → зардлын нэр,
// өмнөх сартай харьцуулалт, 12 сар. Борлуулсан бүтээгдэхүүний өртөг тусдаа мөр (ангилалд ордоггүй).
import { categorizeExpense, cleanExpenseName, EXPENSE_CATEGORY_LABEL, isCogsAccount, type ExpenseCategoryId, type ExpenseRule } from "./expense-categories";
import { changePct } from "./expense-groups";

export interface PlRow {
  month: string;
  account: string;
  item: string;
  amount: number;
}

export interface ExpenseItemView {
  name: string;
  /** нягтланд зөвхөн хамгийн доод drill-down-д: дансны код (7000.00) */
  account: string;
  amount: number;
  prevAmount: number;
  changePct: number | null;
}
export interface ExpenseCategoryView {
  id: ExpenseCategoryId;
  label: string;
  amount: number;
  prevAmount: number;
  changePct: number | null;
  /** үйл ажиллагааны зардалд эзлэх хувь (0..100) */
  share: number;
  /** 12 сарын дүн (`months`-тэй ижил дараалал) */
  series: number[];
  items: ExpenseItemView[];
}
export interface ExpenseView {
  month: string;
  prevMonth: string;
  /** өмнөх сарын мэдээлэл татагдсан эсэх: false бол «татагдаагүй» (0 гэж харуулахгүй) */
  prevLoaded: boolean;
  /** үйл ажиллагааны зардал (борлуулсан бүтээгдэхүүний өртөгөөс бусад) */
  total: number;
  prevTotal: number;
  changePct: number | null;
  /** борлуулсан бүтээгдэхүүний өртөг: тусдаа мөр */
  cogs: { amount: number; prevAmount: number };
  categories: ExpenseCategoryView[];
  top: { id: ExpenseCategoryId; label: string; amount: number; share: number }[];
  months: { month: string; loaded: boolean; total: number }[];
  /** «Бусад»-ын хувь (0..100): 10-аас дээш бол ангиллын дүрэм дутуу */
  otherShare: number;
  otherWarn: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
export const OTHER_WARN_PCT = 10;

/**
 * `rows`: 12 сарын зардлын мөрүүд (side=expense); `months`: 12 сар (хуучнаас шинэ рүү, сүүлийнх нь сонгосон сар);
 * `loaded`: onec_pl-д ямар нэг мөр татагдсан сарууд (сар татагдсан эсэхийг дүнгээр биш мөрөөр тодорхойлно).
 */
export function buildExpenseView(rows: readonly PlRow[], months: readonly string[], rules: readonly ExpenseRule[], loaded: ReadonlySet<string> = new Set(rows.map((r) => r.month))): ExpenseView {
  const last = months.length - 1;
  const month = months[last];
  const prevMonth = months[last - 1] ?? "";
  const monthIndex = new Map(months.map((m, i) => [m, i]));

  const cats = new Map<ExpenseCategoryId, { series: number[]; items: Map<string, ExpenseItemView> }>();
  const operating = months.map(() => 0);
  const cogs = months.map(() => 0);

  for (const r of rows) {
    const idx = monthIndex.get(r.month);
    if (idx === undefined) continue;
    if (isCogsAccount(r.account)) {
      cogs[idx] += r.amount;
      continue;
    }
    const id = categorizeExpense({ account: r.account, item: r.item }, rules);
    const c = cats.get(id) ?? { series: months.map(() => 0), items: new Map<string, ExpenseItemView>() };
    c.series[idx] += r.amount;
    operating[idx] += r.amount;
    if (idx === last || idx === last - 1) {
      const name = cleanExpenseName(r.item);
      const key = `${name}|${r.account}`;
      const it = c.items.get(key) ?? { name, account: r.account, amount: 0, prevAmount: 0, changePct: null };
      if (idx === last) it.amount += r.amount;
      else it.prevAmount += r.amount;
      c.items.set(key, it);
    }
    cats.set(id, c);
  }

  const total = operating[last];
  const prevLoaded = loaded.has(prevMonth);
  const prevTotal = prevLoaded ? operating[last - 1] : 0;

  const categories: ExpenseCategoryView[] = [...cats]
    .map(([id, c]) => {
      const amount = c.series[last];
      const prevAmount = prevLoaded ? c.series[last - 1] : 0;
      return {
        id,
        label: EXPENSE_CATEGORY_LABEL[id],
        amount: round2(amount),
        prevAmount: round2(prevAmount),
        changePct: prevLoaded ? changePct(amount, prevAmount) : null,
        share: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
        series: c.series.map(round2),
        items: [...c.items.values()]
          .map((i) => ({ ...i, amount: round2(i.amount), prevAmount: round2(prevLoaded ? i.prevAmount : 0), changePct: prevLoaded ? changePct(i.amount, i.prevAmount) : null }))
          .filter((i) => i.amount !== 0 || i.prevAmount !== 0)
          .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "mn")),
      };
    })
    .filter((c) => c.amount !== 0 || c.prevAmount !== 0)
    .sort((a, b) => (a.id === "other" ? 1 : b.id === "other" ? -1 : b.amount - a.amount));

  const otherShare = total > 0 ? Math.round(((categories.find((c) => c.id === "other")?.amount ?? 0) / total) * 1000) / 10 : 0;
  return {
    month,
    prevMonth,
    prevLoaded,
    total: round2(total),
    prevTotal: round2(prevTotal),
    changePct: prevLoaded ? changePct(total, prevTotal) : null,
    cogs: { amount: round2(cogs[last]), prevAmount: prevLoaded ? round2(cogs[last - 1]) : 0 },
    categories,
    top: categories.filter((c) => c.id !== "other" && c.amount > 0).slice(0, 3).map((c) => ({ id: c.id, label: c.label, amount: c.amount, share: c.share })),
    months: months.map((m, i) => ({ month: m, loaded: loaded.has(m), total: round2(operating[i]) })),
    otherShare,
    otherWarn: otherShare > OTHER_WARN_PCT,
  };
}
