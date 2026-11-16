// Shapes and helpers for the warehouse catalog browser (/warehouses). The groups and locations themselves come from
// the database (lib/warehouses.ts: top-level Warehouse rows and their children); only the placeholder material
// categories of a location are still static here, keyed by the location's slug. No live inventory is attached to a
// category yet -- they render as empty placeholders until real items (with a real balance) are wired to them.
export interface WarehouseItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

export interface WarehouseCategory {
  id: string;
  name: string;
  items?: WarehouseItem[];
}

export interface SubWarehouse {
  id: string;
  name: string;
  categories: WarehouseCategory[];
}

export interface WarehouseGroup {
  id: string;
  name: string;
  /** Name of the keeper of this top-level warehouse; null when nobody keeps it. */
  keeperName: string | null;
  warehouses: SubWarehouse[];
}

const RAW = { id: "raw-material", name: "Түүхий эд" };
const GOODS = { id: "goods-material", name: "Бараа материал" };
const FINISHED = { id: "finished-goods", name: "Бэлэн бүтээгдэхүүн" };
const WIP = { id: "wip", name: "Дуусаагүй үйлдвэрлэл" };

const CATEGORIES_BY_LOCATION: Record<string, WarehouseCategory[]> = {
  "mehanik-tseh": [FINISHED, RAW, GOODS],
  butluur: [GOODS],
  armatur: [WIP, GOODS],
  silos: [
    { id: "cement", name: "Цемент" },
    { id: "ash", name: "Үнс" },
  ],
  "tov-aguulah": [{ id: "hangamj", name: "Хангамж" }],
  zasvar: [
    { id: "san", name: "Сан" },
    { id: "kran", name: "Кран" },
    { id: "zasvar", name: "Засвар" },
    { id: "tsahilgaan", name: "Цахилгаан" },
  ],
  "tomor-beton": [RAW, GOODS, FINISHED],
  "baz-3-4": [RAW, WIP, { id: "chemical-additive", name: "Химийн нэмэлт" }],
  "gadna-talbai": [RAW, FINISHED],
  "tsainy-gazar": [FINISHED, RAW, { id: "hangamj", name: "Хангамж" }],
};

export function categoriesFor(locationSlug: string): WarehouseCategory[] {
  return CATEGORIES_BY_LOCATION[locationSlug] ?? [];
}

export function findWarehouseGroup(groups: WarehouseGroup[], groupId: string) {
  return groups.find((g) => g.id === groupId) ?? null;
}

export function findSubWarehouse(groups: WarehouseGroup[], groupId: string, warehouseId: string) {
  const group = findWarehouseGroup(groups, groupId);
  if (!group) return null;
  const warehouse = group.warehouses.find((w) => w.id === warehouseId) ?? null;
  if (!warehouse) return null;
  return { group, warehouse };
}

export function findWarehouseItem(groups: WarehouseGroup[], groupId: string, warehouseId: string, categoryId: string, itemId: string) {
  const found = findSubWarehouse(groups, groupId, warehouseId);
  if (!found) return null;
  const category = found.warehouse.categories.find((c) => c.id === categoryId) ?? null;
  if (!category) return null;
  const item = category.items?.find((i) => i.id === itemId) ?? null;
  if (!item) return null;
  return { ...found, category, item };
}
