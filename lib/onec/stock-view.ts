// «Агуулах» табын удирдлагад зориулсан харагдац (цэвэр функц, DB, 1С-гүй): барааны бүлэг → бараа → агуулах ба агуулах → бараа.
// Түвшин бүрт төгрөг БА тоо хэмжээ нэгжтэйгээ. Өөр нэгжтэй барааг нэмэхгүй: бүлгийн тоо хэмжээ нэгж бүрээр тусдаа (lib/units.ts).
// Барааны бүлэг = 1С-ийн 14xx дансны нэр (түүхий эд, бэлэн бүтээгдэхүүн, сэлбэг ...). Бараа тоо, нэгж нь 1С-ийн хэмжих нэгж.
import { sumQuantities, type Quantity } from "@/lib/units";
import { OFF_WAREHOUSE_NAME, isOffWarehouse, type StockRow } from "./stock-tree";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Дансны нэрийг барааны бүлгийн ойлгомжтой нэр болгоно (толь бичиг; тодорхойгүй нь өөрийнхөөрөө, хоосон бол «Бусад»). */
const GROUP_NAMES: Record<string, string> = {
  "түүхий эд, материал": "Түүхий эд, материал",
  бараа: "Худалдан авсан бараа",
};
export function stockGroupName(account: string | undefined): string {
  const raw = (account ?? "").trim();
  if (!raw) return "Бусад";
  return GROUP_NAMES[raw.toLowerCase()] ?? raw;
}

export interface StockWarehouseLine {
  code: string;
  name: string;
  qty: number;
  unit: string;
  amount: number;
}
export interface StockItemLine {
  /** барааны код (хоосон бол нэрээр) */
  key: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  amount: number;
  /** хасах үлдэгдэлтэй агуулах байна */
  negative: boolean;
  warehouses: StockWarehouseLine[];
}
export interface StockItemGroup {
  name: string;
  amount: number;
  items: number;
  /** нэгж бүрээр тусдаа */
  quantities: Quantity[];
  negative: number;
  list: StockItemLine[];
}
export interface StockWarehouseView {
  code: string;
  name: string;
  amount: number;
  items: number;
  quantities: Quantity[];
  negative: number;
  list: { key: string; code: string; name: string; unit: string; qty: number; amount: number; group: string }[];
}
export interface StockView {
  groups: StockItemGroup[];
  warehouses: StockWarehouseView[];
  top: StockItemLine[];
}

const byAmountDesc = <T extends { amount: number; name: string }>(a: T, b: T) => b.amount - a.amount || a.name.localeCompare(b.name, "mn");

export function buildStockView(rows: readonly StockRow[]): StockView {
  // бараа бүр (бүх агуулахаар нийлсэн)
  const items = new Map<string, StockItemLine & { group: string }>();
  for (const r of rows) {
    const key = r.item_code || r.item;
    const cur = items.get(key) ?? { key, code: r.item_code, name: r.item, unit: r.unit, qty: 0, amount: 0, negative: false, warehouses: [], group: stockGroupName(r.group ?? r.account) };
    cur.qty += r.qty;
    cur.amount += r.amount;
    if (r.qty < 0) cur.negative = true;
    cur.warehouses.push({ code: r.warehouse_code, name: isOffWarehouse(r.warehouse_code) ? r.warehouse || OFF_WAREHOUSE_NAME : r.warehouse, qty: round2(r.qty), unit: r.unit, amount: round2(r.amount) });
    items.set(key, cur);
  }
  const finish = (i: StockItemLine & { group: string }): StockItemLine => ({
    key: i.key,
    code: i.code,
    name: i.name,
    unit: i.unit,
    qty: Math.round(i.qty * 1000) / 1000,
    amount: round2(i.amount),
    negative: i.negative,
    warehouses: i.warehouses.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "mn")),
  });

  const byGroup = new Map<string, (StockItemLine & { group: string })[]>();
  for (const i of items.values()) byGroup.set(i.group, [...(byGroup.get(i.group) ?? []), i]);
  const groups: StockItemGroup[] = [...byGroup].map(([name, list]) => ({
    name,
    amount: round2(list.reduce((s, i) => s + i.amount, 0)),
    items: list.length,
    quantities: sumQuantities(list),
    negative: list.filter((i) => i.negative).length,
    list: list.map(finish).sort(byAmountDesc),
  }));
  groups.sort((a, b) => (a.name === "Бусад" ? 1 : b.name === "Бусад" ? -1 : byAmountDesc(a, b)));

  const byWh = new Map<string, { code: string; name: string; rows: StockRow[] }>();
  for (const r of rows) {
    const code = r.warehouse_code;
    const cur = byWh.get(code) ?? { code, name: isOffWarehouse(code) ? r.warehouse || OFF_WAREHOUSE_NAME : r.warehouse, rows: [] };
    cur.rows.push(r);
    byWh.set(code, cur);
  }
  const warehouses: StockWarehouseView[] = [...byWh.values()]
    .map((w) => ({
      code: w.code,
      name: w.name || w.code,
      amount: round2(w.rows.reduce((s, r) => s + r.amount, 0)),
      items: new Set(w.rows.map((r) => r.item_code || r.item)).size,
      quantities: sumQuantities(w.rows),
      negative: w.rows.filter((r) => r.qty < 0).length,
      list: w.rows
        .map((r) => ({ key: r.item_code || r.item, code: r.item_code, name: r.item, unit: r.unit, qty: r.qty, amount: round2(r.amount), group: stockGroupName(r.group ?? r.account) }))
        .sort(byAmountDesc),
    }))
    // агуулахгүй үлдэгдэл хамгийн сүүлд
    .sort((a, b) => (isOffWarehouse(a.code) ? 1 : isOffWarehouse(b.code) ? -1 : byAmountDesc(a, b)));

  const top = [...items.values()].map(finish).sort(byAmountDesc).slice(0, 10);
  return { groups, warehouses, top };
}
