// Хэмжих нэгжийн толь бичиг (нэг газар): 1С-ийн товчлолыг хүнийхээр («ш» → «ширхэг», «тн» → «тонн», «м3» → «шоо метр»).
// Өөр нэгжтэй барааг хооронд нь НЭМЭХГҮЙ: нийлбэрийг нэгж бүрээр тусад нь («48.5 тонн · 3,200 ширхэг»). Зөвхөн нэг хэмжигдэхүүний
// нэгж (кг → тонн) нийлнэ. Бүтэн тоо (хураангуйлаагүй) нь `full`-д: дарахад харуулна.

/** Нэгж бүрийн хүнийхээр нэр ба хэмжигдэхүүний бүлэг (нэг бүлгийн нэгж нийлнэ). */
const UNITS: Record<string, { name: string; base: string }> = {
  ш: { name: "ширхэг", base: "ширхэг" },
  шт: { name: "ширхэг", base: "ширхэг" },
  sh: { name: "ширхэг", base: "ширхэг" },
  ширхэг: { name: "ширхэг", base: "ширхэг" },
  pcs: { name: "ширхэг", base: "ширхэг" },
  тн: { name: "тонн", base: "тонн" },
  тонн: { name: "тонн", base: "тонн" },
  кг: { name: "кг", base: "тонн" },
  kg: { name: "кг", base: "тонн" },
  м3: { name: "шоо метр", base: "шоо метр" },
  "м³": { name: "шоо метр", base: "шоо метр" },
  куб: { name: "шоо метр", base: "шоо метр" },
  м: { name: "метр", base: "метр" },
  л: { name: "литр", base: "литр" },
  боодол: { name: "боодол", base: "боодол" },
  хос: { name: "хос", base: "хос" },
  компл: { name: "иж бүрдэл", base: "иж бүрдэл" },
  комплект: { name: "иж бүрдэл", base: "иж бүрдэл" },
};

const key = (raw: string) => raw.trim().toLowerCase().replace(/\.$/, "");

/** Хүнийхээр нэгж («ш» → «ширхэг»). Тодорхойгүй нэгж өөрийнхөөрөө, хоосон бол «нэгж». */
export const unitName = (raw: string): string => UNITS[key(raw)]?.name ?? (raw.trim() || "нэгж");

/** Нийлбэрлэх нэгж (кг → тонн; бусад нь өөрөө) ба хөрвүүлэлтийн коэффициент. */
function toBase(qty: number, raw: string): { qty: number; unit: string } {
  const u = UNITS[key(raw)];
  if (!u) return { qty, unit: raw.trim() || "нэгж" };
  return { qty: u.name === "кг" ? qty / 1000 : qty, unit: u.base };
}

const ORDER = ["тонн", "шоо метр", "метр", "литр", "ширхэг", "боодол", "хос", "иж бүрдэл"];
const rank = (unit: string) => (ORDER.includes(unit) ? ORDER.indexOf(unit) : ORDER.length);

export interface Quantity {
  unit: string;
  qty: number;
}

/** Нэгж бүрээр тусад нь нийлбэр: [{тонн, 48.5}, {ширхэг, 3200}] (кг нь тонн болж нийлнэ). Нэг ч нэгж нөгөөтэй нийлэхгүй. */
export function sumQuantities(items: readonly { qty: number; unit: string }[]): Quantity[] {
  const by = new Map<string, number>();
  for (const i of items) {
    const b = toBase(i.qty, i.unit);
    by.set(b.unit, (by.get(b.unit) ?? 0) + b.qty);
  }
  return [...by].map(([unit, qty]) => ({ unit, qty: Math.round(qty * 1000) / 1000 })).sort((a, b) => rank(a.unit) - rank(b.unit) || a.unit.localeCompare(b.unit, "mn"));
}

const number = (v: number, max: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: max }).format(v);

/** «30 тонн», «3,200 ширхэг»; кг ≥ 1000 бол тонн болгож (full нь «30,250 кг»). */
export function formatQuantity(qty: number, rawUnit: string): { short: string; full: string } {
  const name = unitName(rawUnit);
  const abs = Math.abs(qty);
  const sign = qty < 0 ? "−" : "";
  const full = `${sign}${number(abs, 3)} ${name}`;
  if (name === "кг" && abs >= 1000) return { short: `${sign}${number(abs / 1000, abs >= 100_000 ? 0 : 1)} тонн`, full };
  return { short: `${sign}${number(abs, abs >= 100 ? 0 : 2)} ${name}`, full };
}

/** Бүлгийн нийлбэр мөр: «48.5 тонн · 3,200 ширхэг». Нийлбэр нь аль хэдийн нэгжээр тусгаарлагдсан. */
export function formatQuantities(qs: readonly Quantity[]): { short: string; full: string } {
  const parts = qs.filter((q) => q.qty !== 0).map((q) => formatQuantity(q.qty, q.unit));
  return { short: parts.map((p) => p.short).join(" · ") || "—", full: parts.map((p) => p.full).join(" · ") || "—" };
}
