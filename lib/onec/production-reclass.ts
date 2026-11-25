// «Дараа нь брак болсон» мөрүүдийн цехийг тодорхойлно. Комплектацийн баримтад цех байхгүй тул бүтээгдэхүүний нэрээр (үндсэн нэр, Зас/Брак-гүй)
// өөр сарууд, энэ сарын бэлэн гарцаас хамгийн их гарсан цехийг авна. Цэвэр функц (DB-гүй): тестлэхэд хялбар.
import { isReclassStage, splitProductName } from "./production-names";

export interface KnownOutput {
  product: string;
  department: string;
  quantity: number;
}

const keyOf = (product: string) => splitProductName(product).base.toLowerCase();

/** бүтээгдэхүүний үндсэн нэр -> хамгийн их гарсан хэлтэс */
export function productDepartments(rows: readonly KnownOutput[]): Map<string, string> {
  const by = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.department) continue;
    const m = by.get(keyOf(r.product)) ?? new Map<string, number>();
    m.set(r.department, (m.get(r.department) ?? 0) + r.quantity);
    by.set(keyOf(r.product), m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of by) out.set(k, [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "mn"))[0][0]);
  return out;
}

/** `reclass` мөрүүдэд цех оноож, цех нь олдоогүйг хасна (цехгүй мөр хэнд ч харагдахгүй). Бусад мөр хэвээр. */
export function assignReclassDepartments<T extends { stage: string; product: string; department: string }>(lines: readonly T[], known: readonly KnownOutput[]): T[] {
  const dept = productDepartments(known);
  return lines.flatMap((l) => {
    if (!isReclassStage(l.stage)) return [l];
    const department = dept.get(keyOf(l.product));
    return department ? [{ ...l, department }] : [];
  });
}
