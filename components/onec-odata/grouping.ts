// Зүүн талын объектын жагсаалтын бүлэглэлт, эрэмбэ, хайлт (цэвэр функц: тестлэгдэнэ). Зөвхөн харагдах байдал:
// энд ямар ч эрхийн шийдвэр гарахгүй (жагсаалтыг сервер эрхээр нь аль хэдийн шүүсэн).
import { isTechnicalObject, matchesSearch, objectLabel } from "@/lib/onec-odata/labels-mn";
import { KIND_ORDER } from "./format";

export interface ObjectItem {
  name: string;
  kind: string;
}

export const groupKeyOf = (o: ObjectItem): (typeof KIND_ORDER)[number] => (isTechnicalObject(o.name) ? "technical" : (o.kind as (typeof KIND_ORDER)[number]));

/** Орчуулгатай нь эхэнд (монгол нэрийн үсгийн дарааллаар), орчуулгагүй нь дараа нь (1С-ийн нэрээр) */
export function orderObjects(items: ObjectItem[]): ObjectItem[] {
  const withLabel = items.map((o) => ({ o, label: objectLabel(o.name) }));
  const sort = (list: typeof withLabel, key: (x: (typeof withLabel)[number]) => string) => [...list].sort((a, b) => key(a).localeCompare(key(b), "mn"));
  return [...sort(withLabel.filter((x) => x.label), (x) => x.label as string), ...sort(withLabel.filter((x) => !x.label), (x) => x.o.name)].map((x) => x.o);
}

/** Хайлт монгол болон 1С-ийн жинхэнэ нэр хоёуланд ажиллана; «Техникийн» бүлэг хамгийн сүүлд */
export function groupObjects(objects: ObjectItem[], search: string): { kind: (typeof KIND_ORDER)[number]; items: ObjectItem[] }[] {
  const filtered = objects.filter((o) => matchesSearch(o.name, search));
  return KIND_ORDER.map((kind) => ({ kind, items: orderObjects(filtered.filter((o) => groupKeyOf(o) === kind)) })).filter((g) => g.items.length > 0);
}
