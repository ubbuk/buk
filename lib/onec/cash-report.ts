// «Мөнгөн хөрөнгө» табын тайлан: гүйлгээг ангилалд хувааж, «Хаанаас орж ирсэн» / «Хаашаа гарсан» хоёр бүлгээр, харилцагчаар задлан
// харуулна. Мөн гүйлгээний хайлт (харилцагч, утга, дүн: «84 сая», 84073015, огноо). Цэвэр функцүүд: 1С, DB-д хандахгүй.
// Цалингийн нууцлал: canViewPayroll-гүй хүнд цалингийн дансны бичилтийн харилцагч, утга нэг «Цалин олголт (нэгтгэсэн)» болно (нийт
// дүн, ангилал өөрчлөгдөхгүй), нэгтгэсэн мөрөнд баримт, данс байхгүй.
import type { CashEntry, CashResult } from "./cash";
import { categorize, categoryLabel, type CashRule, type CategoryId } from "./cash-categories";
import { PAYROLL_LABEL } from "./payroll-guard";
import { parseQuery } from "@/lib/query-parse";

export { parseQuery };

export interface ReportEntry extends CashEntry {
  category: CategoryId;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const PARTIES_SHOWN = 8;

/** Гүйлгээ бүрд ангилал өгнө; нууцлал хамаарах бол харилцагч, утга, данс, баримтыг нууж, өдөр/данс/ангилалаар нэгтгэнэ. */
export function withCategories(entries: readonly CashEntry[], rules: readonly CashRule[], canSeePayroll: boolean): ReportEntry[] {
  const out: ReportEntry[] = [];
  const merged = new Map<string, ReportEntry>();
  for (const e of entries) {
    const category = categorize(
      { type: e.type, counterAccount: e.counterAccount ?? "", counterAccountName: e.counterAccountName ?? "", counterpart: e.counterpart, memo: e.memo, article: e.article },
      rules
    );
    if (e.payroll && !canSeePayroll) {
      const key = `${e.date}|${e.type}|${e.account}|${category}`;
      const cur = merged.get(key);
      if (cur) cur.amount = round2(cur.amount + e.amount);
      else
        merged.set(key, {
          id: `payroll:${key}`,
          date: e.date,
          type: e.type,
          account: e.account,
          counterpart: PAYROLL_LABEL,
          article: "",
          memo: "",
          document: PAYROLL_LABEL,
          docType: "",
          ref: "",
          amount: e.amount,
          payroll: true,
          category,
        });
      continue;
    }
    out.push({ ...e, category });
  }
  return [...out, ...merged.values()].sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
}

export interface PartyRow {
  name: string;
  total: number;
  count: number;
}
export interface CategoryRow {
  id: CategoryId;
  label: string;
  total: number;
  /** тухайн чиглэлийн нийт дүнгийн хувь (0..1) */
  share: number;
  count: number;
  parties: PartyRow[];
  /** `parties`-д орохгүй үлдсэн харилцагчид */
  moreParties: { count: number; total: number };
}
export interface FlowReport {
  total: number;
  categories: CategoryRow[];
}
export interface CashReport {
  month: string;
  asOf: string;
  totals: CashResult["totals"];
  inflow: FlowReport;
  outflow: FlowReport;
  /** «Бусад»-ын хувь (0..1): өндөр бол ангиллын дүрэм дутуу */
  otherShare: { inflow: number; outflow: number };
  internal: { total: number; count: number; items: { date: string; from: string; to: string; amount: number }[] };
}

function flowReport(entries: readonly ReportEntry[], type: "inflow" | "outflow"): FlowReport {
  const byCat = new Map<CategoryId, { total: number; count: number; parties: Map<string, PartyRow> }>();
  let total = 0;
  for (const e of entries) {
    if (e.type !== type) continue;
    total += e.amount;
    const c = byCat.get(e.category) ?? { total: 0, count: 0, parties: new Map() };
    c.total += e.amount;
    c.count += 1;
    const p = c.parties.get(e.counterpart) ?? { name: e.counterpart, total: 0, count: 0 };
    p.total += e.amount;
    p.count += 1;
    c.parties.set(e.counterpart, p);
    byCat.set(e.category, c);
  }
  const categories = [...byCat]
    .map(([id, c]): CategoryRow => {
      const sorted = [...c.parties.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "mn"));
      const rest = sorted.slice(PARTIES_SHOWN);
      return {
        id,
        label: categoryLabel(id, type),
        total: round2(c.total),
        share: total > 0 ? c.total / total : 0,
        count: c.count,
        parties: sorted.slice(0, PARTIES_SHOWN).map((p) => ({ ...p, total: round2(p.total) })),
        moreParties: { count: rest.length, total: round2(rest.reduce((s, p) => s + p.total, 0)) },
      };
    })
    // «Бусад» үргэлж хамгийн сүүлд, бусад нь дүнгээр
    .sort((a, b) => (a.id === "other" ? 1 : b.id === "other" ? -1 : b.total - a.total));
  return { total: round2(total), categories };
}

export function buildCashReport(cash: CashResult, entries: readonly ReportEntry[]): CashReport {
  const inflow = flowReport(entries, "inflow");
  const outflow = flowReport(entries, "outflow");
  const other = (f: FlowReport) => f.categories.find((c) => c.id === "other")?.share ?? 0;
  return {
    month: cash.month,
    asOf: cash.asOf,
    totals: cash.totals,
    inflow,
    outflow,
    otherShare: { inflow: other(inflow), outflow: other(outflow) },
    internal: {
      total: cash.totals.internal,
      count: cash.transfers.length,
      items: cash.transfers.slice(0, 10).map((t) => ({ date: t.date, from: t.account, to: t.counterpart, amount: t.amount })),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- хайлт

export interface EntryFilter {
  q?: string;
  flow?: "inflow" | "outflow";
  category?: CategoryId;
  party?: string;
  account?: string;
}

const hay = (e: ReportEntry) => `${e.counterpart} ${e.memo} ${e.article} ${e.document} ${e.account} ${categoryLabel(e.category, e.type)}`.normalize("NFKC").toLowerCase();

export function filterEntries(entries: readonly ReportEntry[], f: EntryFilter): ReportEntry[] {
  const q = f.q?.trim() ? parseQuery(f.q) : null;
  return entries.filter((e) => {
    if (f.flow && e.type !== f.flow) return false;
    if (f.category && e.category !== f.category) return false;
    if (f.party && e.counterpart !== f.party) return false;
    if (f.account && e.account !== f.account) return false;
    if (!q) return true;
    if (q.ranges.length && !q.ranges.some((r) => e.amount >= r.min - 0.005 && e.amount < r.max)) return false;
    if (q.exact.length && !q.exact.some((n) => (Number.isInteger(n) ? Math.floor(e.amount) === n || Math.round(e.amount) === n : Math.abs(e.amount - n) < 0.006))) return false;
    if (q.dates.length && !q.dates.some((d) => (d.full ? e.date === d.full : e.date.slice(5) === d.monthDay))) return false;
    if (q.words.length) {
      const h = hay(e);
      if (!q.words.every((w) => h.includes(w))) return false;
    }
    return true;
  });
}

export function paginate<T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages, total: items.length };
}
