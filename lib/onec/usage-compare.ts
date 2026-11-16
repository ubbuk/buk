// «Зарцуулалт»-ын нэмэлт тооцоо (цэвэр функцүүд, 1С, DB-гүй): өмнөх сартай харьцуулалт ба агуулахаар (1С склад → Warehouse.onecCode → нярвын бүлэг).
import { changePct } from "./expense-groups";
import { effectiveKeeper, leafWarehouses, type KeeperRef, type WarehouseRow } from "./stock-tree";
import type { UsageDocument, UsageResult } from "./usage";

export interface UsageComparison {
  prevMonth: string;
  /** Одоогийн сар бол өнөөдрийн өдөр (өмнөх сарын 1…N-тэй харьцуулна); өнгөрсөн сар бол null (өмнөх сарыг бүтнээр нь) */
  throughDay: number | null;
  amount: number;
  documents: number;
  changePct: number | null;
  documentsChangePct: number | null;
}

const dayOfMonth = (d: UsageDocument) => Number(d.date.slice(8, 10));
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Өмнөх сарын МЭН ҮЕТЭЙ харьцуулалт: одоогийн сар бол өмнөх сарын 1…өнөөдрийн өдөр, өнгөрсөн сар бол өмнөх сар бүтнээрээ.
 * Хувь нь expenses-ийнхтэй ижил `changePct` (өмнөх нь 0 бол null). `daily[i].previous` нь өмнөх сарын i-р өдөр (байхгүй бол 0).
 * `prev` null (өмнөх сарыг татаж чадаагүй) бол харьцуулалт, previous байхгүй.
 */
export function compareUsage(cur: UsageResult, prev: UsageResult | null, today: string | null): { comparison: UsageComparison | null; daily: { date: string; amount: number; previous?: number }[] } {
  if (!prev) return { comparison: null, daily: cur.daily };
  const throughDay = today ? Number(today.slice(8, 10)) : null;
  const within = (d: UsageDocument) => throughDay === null || dayOfMonth(d) <= throughDay;
  const curDocs = cur.documents.filter(within);
  const prevDocs = prev.documents.filter(within);
  const sum = (docs: UsageDocument[]) => round2(docs.reduce((s, d) => s + d.amount, 0));
  const amount = sum(prevDocs);
  return {
    comparison: {
      prevMonth: prev.month,
      throughDay,
      amount,
      documents: prevDocs.length,
      changePct: changePct(sum(curDocs), amount),
      documentsChangePct: changePct(curDocs.length, prevDocs.length),
    },
    daily: cur.daily.map((d, i) => ({ ...d, previous: prev.daily[i]?.amount ?? 0 })),
  };
}

export interface UsageWarehouse {
  /** 1С складын код (ERP-д холбогдсон бол), үгүй бол «name:<нэр>» */
  key: string;
  name: string;
  /** нярвын бүлэг (дээд түвшний Warehouse); ERP-д холбогдоогүй бол null */
  group: string | null;
  keeper: KeeperRef | null;
  mapped: boolean;
  amount: number;
  documents: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Шаардах хуудсыг складаар нэгтгэнэ. Склад нь баримтын 1С кодоор Warehouse.onecCode-той холбогдоно (код олдохгүй бол яг ижил нэрээр);
 * холбогдсон бол нярвын бүлэг ба нярав (бүлгийнх) гарна. Холбогдоогүй нь нууцлагдахгүй, `mapped: false`. Дүнгээр буурахаар.
 */
export function usageByWarehouse(documents: UsageDocument[], warehouses: WarehouseRow[]): UsageWarehouse[] {
  const byId = new Map(warehouses.map((w) => [w.id, w]));
  const leaves = leafWarehouses(warehouses);
  const byCode = new Map(leaves.map((l) => [l.code, l]));
  const byName = new Map(leaves.map((l) => [norm(l.name), l]));

  const out = new Map<string, UsageWarehouse>();
  for (const d of documents) {
    const leaf = (d.warehouseCode && byCode.get(d.warehouseCode)) || byName.get(norm(d.warehouse));
    const key = leaf ? leaf.code : `name:${d.warehouse}`;
    const cur =
      out.get(key) ??
      (leaf
        ? { key, name: leaf.name, group: leaf.group?.name ?? null, keeper: effectiveKeeper(leaf, byId), mapped: true, amount: 0, documents: 0 }
        : { key, name: d.warehouse, group: null, keeper: null, mapped: false, amount: 0, documents: 0 });
    cur.amount += d.amount;
    cur.documents += 1;
    out.set(key, cur);
  }
  return [...out.values()].map((w) => ({ ...w, amount: round2(w.amount) })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "mn"));
}
