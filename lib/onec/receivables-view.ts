// «Авлага» табын удирдлагад зориулсан харагдац (цэвэр функц): харилцагч бүрийн өр, нас (0–30/31–60/61–90/90+ хоног), өмнөх сартай харьцуулалт.
// Агшин зургийн үлдэгдэл (onec_receivable_balances) ба борлуулалтын баримт (onec_sales) хоёроос; 1С руу хандахгүй.
import { addMonths, monthRange } from "./dates";
import { AGING_LABEL, ageCustomer, nameKey, totalAging, type AgingTotals, type CustomerAging, type Invoice } from "./receivable-aging";
import type { ReceivableCustomer, ReceivablesResult } from "./receivables";

export interface CustomerView extends ReceivableCustomer {
  aging: CustomerAging;
  /** өмнөх сарын эцсийн үлдэгдэл (өмнөх сарын агшин зураг байхгүй бол null) */
  previousBalance: number | null;
  /** одоогийн − өмнөх (₮); өмнөх сар байхгүй бол null */
  change: number | null;
}

export interface PreviousComparison {
  asOf: string;
  receivable: number;
  change: number;
  changePct: number | null;
}

export interface ReceivablesView {
  customers: CustomerView[];
  aging: AgingTotals & { method: "fifo"; historyStart: string | null };
  previous: PreviousComparison | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

/** Өмнөх сарын эцэс (YYYY-MM-DD) */
export const previousMonthEnd = (asOf: string): string => monthRange(addMonths(asOf.slice(0, 7), -1)).to;

/**
 * Борлуулалтын түүх найдвартай хамрах эхлэл: asOf-ийн сараас хойш ДАРААЛСАН татагдсан саруудын хамгийн эхнийх (завсар сар байвал түүнээс хойш л).
 * Завсартай түүхээр насыг тооцвол буруу болно, тиймээс энэ эхлэлээс өмнөх үлдэгдэл «Нас тодорхойгүй» эсвэл «90+» болно.
 */
export function historyStartFrom(monthsWithSales: readonly string[], asOf: string): string | null {
  const have = new Set(monthsWithSales);
  let m = asOf.slice(0, 7);
  if (!have.has(m)) return null;
  while (have.has(addMonths(m, -1))) m = addMonths(m, -1);
  return `${m}-01`;
}

export function buildReceivablesView(
  current: ReceivablesResult,
  previous: ReceivablesResult | null,
  invoicesByName: ReadonlyMap<string, Invoice[]>,
  historyStart: string | null
): ReceivablesView {
  const prevBy = previous ? new Map(previous.customers.map((c) => [c.key, c.balance])) : null;
  const customers: CustomerView[] = current.customers.map((c) => {
    const prev = prevBy ? (prevBy.get(c.key) ?? 0) : null;
    return {
      ...c,
      aging: ageCustomer(c.balance, invoicesByName.get(nameKey(c.name)) ?? [], current.asOf, historyStart),
      previousBalance: prev === null ? null : round2(prev),
      change: prev === null ? null : round2(c.balance - prev),
    };
  });
  const aging = totalAging(customers.filter((c) => c.balance > 0).map((c) => c.aging));
  const prevTotal = previous?.totals.receivable ?? null;
  return {
    customers,
    aging: { ...aging, method: "fifo", historyStart },
    previous: previous && prevTotal !== null ? { asOf: previous.asOf, receivable: prevTotal, change: round2(current.totals.receivable - prevTotal), changePct: pct(current.totals.receivable, prevTotal) } : null,
  };
}

export { AGING_LABEL };
