// «Бүтээгдэхүүн» таб: нэг бүтээгдэхүүнийг ҮЙЛДВЭРЛЭСЭН (onec_production_line), ЗАРСАН (onec_sales), АГУУЛАХАД ОДОО (onec_stock)-оор харуулна.
// Цэвэр функц (DB, 1С-д хандахгүй): тестлэхэд хялбар. Захирлын харагдац тул данс, баримтын дугаар, нягтлангийн нэр томьёо энд ИРЭХГҮЙ.
//  * Хайлт: том/жижиг үсэг, зай, «Ф/ф», «-», «*», «/» тэмдэг, «зас»/«брак» дагаврыг үл тооно. «Зас», «Брак» нэр үндсэн бүтээгдэхүүндээ нэгдэнэ.
//  * Үйлдвэрлэсэн, зарсан, агуулахад = ҮНДСЭН (Бэлэн) бүтээгдэхүүн: 1С-д «Зас», «Брак» нь тусдаа бараа тул тоог нь 1С-ийн картаар тулгана. Засвар, Брак нь жижиг мөрөнд тусад нь.
import { addMonths, monthRange } from "./dates";
import { groupFor, shortGroupName, slugOf } from "./production-groups";
import { isReclassStage, splitProductName } from "./production-names";
import { unitName } from "@/lib/units";

/** Хайлтад зориулсан жигдрүүлэлт: жижиг үсэг, үсэг/тооноос бусад тэмдэг, зай хасна; тооны өмнөх «ф» (Ф-1000) хасна */
export function compactText(raw: string): string {
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/ф(?=\d)/gu, "");
}

const IGNORED_TOKENS = new Set(["зас", "брак", "ф"]); // «ф 1000» (зайтай) -> зөвхөн 1000

/** Хайлтын үгс: зайгаар салгаж, бүгдийг жигдрүүлнэ; «зас», «брак», хоосон үгийг хаяна */
export function searchTokens(q: string): string[] {
  return q
    .slice(0, 120)
    .split(/\s+/u)
    .map(compactText)
    .filter((t) => t && !IGNORED_TOKENS.has(t));
}

/** Бүх үг (AND) бүтээгдэхүүний үндсэн нэрэнд агуулагдаж байвал таарна */
export const matchesTokens = (name: string, tokens: readonly string[]): boolean => {
  if (tokens.length === 0) return false;
  const text = compactText(splitProductName(name).base);
  return tokens.every((t) => text.includes(t));
};

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round2 = (v: number) => Math.round(v * 100) / 100;
const KEY_SEP = "|";
/** Бүтээгдэхүүний тулгуур: үндсэн нэр (Зас/Брак-гүй, жигдэрсэн) + нэгж */
const keyOf = (name: string, unit: string): string => `${compactText(splitProductName(name).base)}${KEY_SEP}${unitName(unit)}`;

export interface SaleQty {
  day: string;
  item: string;
  unit: string;
  qty: number;
  /** борлуулалтын дүн, ₮, НӨАТ-гүй (onec_sales.amount: Борлуулалт табын «Орлого»-той ижил; буцаалт сөрөг). Байхгүй бол 0 */
  amount?: number;
}
export interface StockQty {
  item: string;
  unit: string;
  qty: number;
  /** агуулахын нэр (байхгүй бол задаргаа гарахгүй) */
  warehouse?: string;
}
export interface ProdLine {
  day: string;
  department: string;
  stage: string;
  product: string;
  unit: string;
  quantity: number;
  /** баримт батлагдсан эсэх (байхгүй бол батлагдсан). Үлдэгдлийн тооцоонд зөвхөн батлагдсан */
  posted?: boolean;
}

export interface ProductWorkshop {
  name: string;
  short: string;
  slug: string;
  qty: number;
}
export interface ProductCard {
  id: string;
  name: string;
  unit: string;
  produced: number;
  repair: number;
  defect: number;
  /** null = энэ хэрэглэгчид харагдахгүй (цехийн эрхтэй хэрэглэгч) */
  sold: number | null;
  /** сонгосон хугацаанд зарсан дүн, ₮, НӨАТ-гүй (нэгж харгалзахгүй) */
  soldAmount: number | null;
  stock: number | null;
  /** агуулах бүрийн үлдэгдэл (0-ээс ялгаатай, их нь эхэнд); нэг агуулах бол хоосон */
  warehouses: { name: string; qty: number }[];
  workshops: ProductWorkshop[];
}
export interface ProductDay {
  date: string;
  produced: number;
  sold: number | null;
  workshops: { short: string; qty: number }[];
}
export interface ProductMonth {
  month: string;
  produced: number;
  sold: number | null;
  /** сарын эцсийн үлдэгдэл: одоогийн үлдэгдлээс сар бүрийн үйлдвэрлэл, борлуулалтыг буцааж тооцсон (ойролцоо) */
  closing: number | null;
}
export interface ProductDetail {
  id: string;
  name: string;
  unit: string;
  days: ProductDay[];
  months: ProductMonth[];
}
export interface ProductSearchView {
  q: string;
  from: string;
  to: string;
  products: ProductCard[];
  truncated: boolean;
  /** хайлтгүй үед: хамгийн их үйлдвэрлэсэн, зарсан */
  /** хайлтгүй үед: хамгийн их үйлдвэрлэсэн 10 (ширхгээр), хамгийн их зарсан 10 — дүнгээр (бүх бүтээгдэхүүн, нэгж харгалзахгүй) ба тоогоор (ширхэг) */
  top: { produced: ProductCard[]; soldByAmount: ProductCard[]; soldByQty: ProductCard[] } | null;
  detail: ProductDetail | null;
  showSales: boolean;
}

interface Ent {
  id: string;
  name: string;
  nameIsMain: boolean;
  unit: string;
  ready: number;
  repair: number;
  defect: number;
  sold: number;
  soldAmount: number;
  stock: number;
  hasStock: boolean;
  byWarehouse: Map<string, number>;
  byShop: Map<string, number>;
  byDay: Map<string, { produced: number; sold: number; shops: Map<string, number> }>;
  byMonth: Map<string, { produced: number; confirmed: number; sold: number; other: number }>;
}

/** «Вольтамискын агуулах» -> «Вольтамискын»: богино нэр */
const shortWarehouse = (name: string): string => name.replace(/s*агуулахs*$/iu, "").trim() || name;

/** Агуулах бүрийн үлдэгдэл: 0-ийг хасна, нэг л агуулах (эсвэл задаргаа үгүй) бол хоосон */
function warehouseSplit(by: ReadonlyMap<string, number>): { name: string; qty: number }[] {
  const rows = [...by].map(([name, qty]) => ({ name: shortWarehouse(name), qty: round3(qty) })).filter((w) => w.qty !== 0);
  return rows.length > 1 ? rows.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "mn")) : [];
}

const MAX_RESULTS = 60;
const TOP_N = 10;
const outputStage = (stage: string) => !isReclassStage(stage);

export interface SearchInput {
  q: string;
  from: string;
  to: string;
  today: string;
  /** сонгосон бүтээгдэхүүн (ProductCard.id) */
  selected?: string | null;
  /** 12 сарын хүснэгтийн эцсийн сар (анхдагч: today-ийн сар) */
  lines: readonly ProdLine[];
  /** комплектацийн шилжүүлэг (гарц биш): бракаас/засвараас бэлэн болгосон, өөр бүтээгдэхүүнээс шилжүүлсэн (+); бэлнээс брак болгосон, өөрт шилжүүлсэн (-). Зөвхөн эцсийн үлдэгдлийн тооцоонд */
  moves?: readonly ProdLine[];
  sales: readonly SaleQty[];
  stock: readonly StockQty[];
  /** борлуулалт, агуулахын тоог харуулах уу (цехийн эрхтэй хэрэглэгчид үгүй) */
  showSales: boolean;
}

const emptyEnt = (id: string, name: string, unit: string): Ent => ({
  id,
  name,
  nameIsMain: false,
  unit,
  ready: 0,
  repair: 0,
  defect: 0,
  sold: 0,
  soldAmount: 0,
  stock: 0,
  hasStock: false,
  byWarehouse: new Map(),
  byShop: new Map(),
  byDay: new Map(),
  byMonth: new Map(),
});

/** Сүүлийн 12 сар (today-ийн сараар төгсөнө) */
export const last12Months = (today: string): string[] => Array.from({ length: 12 }, (_, i) => addMonths(today.slice(0, 7), i - 11));

export function buildProductSearch(input: SearchInput): ProductSearchView {
  const { from, to, showSales } = input;
  const tokens = searchTokens(input.q);
  const searching = tokens.length > 0;
  const months12 = last12Months(input.today);
  const ents = new Map<string, Ent>();
  const get = (name: string, unit: string): Ent => {
    const id = keyOf(name, unit);
    let e = ents.get(id);
    if (!e) ents.set(id, (e = emptyEnt(id, splitProductName(name).base, unitName(unit))));
    return e;
  };
  const rename = (e: Ent, name: string) => {
    const s = splitProductName(name);
    if (s.variant === "main" && !e.nameIsMain) {
      e.name = s.base;
      e.nameIsMain = true;
    }
  };
  const wanted = (name: string) => (searching ? matchesTokens(name, tokens) : true);
  const day = (e: Ent, date: string) => {
    let d = e.byDay.get(date);
    if (!d) e.byDay.set(date, (d = { produced: 0, sold: 0, shops: new Map() }));
    return d;
  };
  const month = (e: Ent, m: string) => {
    let d = e.byMonth.get(m);
    if (!d) e.byMonth.set(m, (d = { produced: 0, confirmed: 0, sold: 0, other: 0 }));
    return d;
  };
  const m12first = months12[0];

  for (const l of input.lines) {
    if (!outputStage(l.stage) || (l.day.slice(0, 7) < m12first && (l.day < from || l.day > to))) continue;
    if (!wanted(l.product)) continue;
    const { variant } = splitProductName(l.product);
    const e = get(l.product, l.unit);
    rename(e, l.product);
    const inRange = l.day >= from && l.day <= to;
    const inM12 = l.day.slice(0, 7) >= m12first;
    if (variant !== "main") {
      if (inRange) e[variant === "defect" ? "defect" : "repair"] += l.quantity;
      continue;
    }
    const short = shortGroupName(groupFor(l.department).name);
    if (inRange) {
      e.ready += l.quantity;
      const g = groupFor(l.department).name;
      e.byShop.set(g, (e.byShop.get(g) ?? 0) + l.quantity);
      const d = day(e, l.day);
      d.produced += l.quantity;
      d.shops.set(short, (d.shops.get(short) ?? 0) + l.quantity);
    }
    if (inM12) {
      const mm = month(e, l.day.slice(0, 7));
      mm.produced += l.quantity;
      if (l.posted !== false) mm.confirmed += l.quantity;
    }
  }

  for (const l of input.moves ?? []) {
    if (l.day.slice(0, 7) < m12first || !wanted(l.product)) continue;
    month(get(l.product, l.unit), l.day.slice(0, 7)).other += l.stage === "reclass" || l.stage === "swap_out" ? -l.quantity : l.quantity;
  }

  if (showSales) {
    for (const s of input.sales) {
      if (splitProductName(s.item).variant !== "main" || !wanted(s.item)) continue;
      const e = get(s.item, s.unit);
      if (s.day >= from && s.day <= to) {
        e.sold += s.qty;
        e.soldAmount += s.amount ?? 0;
        day(e, s.day).sold += s.qty;
      }
      if (s.day.slice(0, 7) >= m12first) month(e, s.day.slice(0, 7)).sold += s.qty;
    }
    for (const s of input.stock) {
      if (splitProductName(s.item).variant !== "main" || !wanted(s.item)) continue;
      const e = get(s.item, s.unit);
      e.stock += s.qty;
      e.hasStock = true;
      if (s.warehouse) e.byWarehouse.set(s.warehouse, (e.byWarehouse.get(s.warehouse) ?? 0) + s.qty);
    }
  }

  const card = (e: Ent): ProductCard => ({
    id: e.id,
    name: e.name,
    unit: e.unit,
    produced: round3(e.ready),
    repair: round3(e.repair),
    defect: round3(e.defect),
    sold: showSales ? round3(e.sold) : null,
    soldAmount: showSales ? round2(e.soldAmount) : null,
    stock: showSales ? round3(e.stock) : null,
    warehouses: showSales ? warehouseSplit(e.byWarehouse) : [],
    workshops: [...e.byShop]
      .map(([name, qty]) => ({ name, short: shortGroupName(name), slug: slugOf(name), qty: round3(qty) }))
      .filter((w) => w.qty !== 0)
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "mn")),
  });
  const active = (e: Ent) => e.ready + e.repair + e.defect !== 0 || e.sold !== 0 || (searching && e.hasStock && e.stock !== 0);

  let products: ProductCard[] = [];
  let truncated = false;
  let top: ProductSearchView["top"] = null;
  const list = [...ents.values()].filter(active);
  if (searching) {
    const sorted = list.map(card).sort((a, b) => b.produced + (b.sold ?? 0) - (a.produced + (a.sold ?? 0)) || a.name.localeCompare(b.name, "mn"));
    truncated = sorted.length > MAX_RESULTS;
    products = sorted.slice(0, MAX_RESULTS);
  } else {
    // Нэгж ялгаатай тул зөвхөн «ширхэг»-ээр эрэмбэлнэ (шоо метр, тонныг ширхэгтэй харьцуулахгүй); ширхэг огт байхгүй бол бүгдийг
    const primary = list.filter((e) => e.unit === "ширхэг");
    const pool = primary.length > 0 ? primary : list;
    top = {
      produced: pool.filter((e) => e.ready > 0).sort((a, b) => b.ready - a.ready).slice(0, TOP_N).map(card),
      // Зарсан: дүнгээр бол нэгж харгалзахгүй (м³, тонн ч орно); тоогоор бол зөвхөн ширхэг
      soldByAmount: showSales ? list.filter((e) => e.soldAmount > 0).sort((a, b) => b.soldAmount - a.soldAmount || a.name.localeCompare(b.name, "mn")).slice(0, TOP_N).map(card) : [],
      soldByQty: showSales ? pool.filter((e) => e.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, TOP_N).map(card) : [],
    };
  }

  let detail: ProductDetail | null = null;
  const sel = input.selected ? ents.get(input.selected) : undefined;
  if (sel) {
    const days: ProductDay[] = [...sel.byDay]
      .filter(([, d]) => d.produced !== 0 || d.sold !== 0)
      .map(([date, d]) => ({
        date,
        produced: round3(d.produced),
        sold: showSales ? round3(d.sold) : null,
        workshops: [...d.shops].map(([short, qty]) => ({ short, qty: round3(qty) })).sort((a, b) => b.qty - a.qty),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    // Сарын эцсийн үлдэгдэл: одоогийн үлдэгдэл - (сарын дараах үйлдвэрлэл) + (сарын дараах борлуулалт) - (шилжүүлгээр нэмэгдсэн)
    let closing: number | null = showSales && sel.hasStock ? sel.stock : null;
    const rows: ProductMonth[] = [];
    for (const m of [...months12].reverse()) {
      const v = sel.byMonth.get(m) ?? { produced: 0, confirmed: 0, sold: 0, other: 0 };
      rows.push({ month: m, produced: round3(v.produced), sold: showSales ? round3(v.sold) : null, closing: closing === null ? null : round3(closing) });
      if (closing !== null) closing = closing - v.confirmed + v.sold - v.other;
    }
    detail = { id: sel.id, name: sel.name, unit: sel.unit, days, months: rows.reverse() };
  }

  return { q: input.q, from, to, products, truncated, top, detail, showSales };
}

/** Хугацааны бэлэн сонголтууд: энэ сар, өнгөрсөн сар, энэ жил, сонгосон сар */
export type PeriodPreset = "this" | "last" | "year" | "month";
export function periodRange(preset: PeriodPreset, today: string, ym?: string): { from: string; to: string } {
  const cur = today.slice(0, 7);
  if (preset === "last") return monthRange(addMonths(cur, -1));
  if (preset === "year") return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  if (preset === "month" && ym) return monthRange(ym);
  return monthRange(cur);
}
