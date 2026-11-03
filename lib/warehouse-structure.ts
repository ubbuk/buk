// Static organizational structure for the warehouse catalog browser
// (/warehouses). Each group (e.g. "БОЛД") contains several named
// warehouses, each split into material categories. No live inventory
// data is wired in yet -- categories render as empty placeholders until
// real items (with a real balance) are attached to them.
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
  warehouses: SubWarehouse[];
}

export const WAREHOUSE_GROUPS: WarehouseGroup[] = [
  {
    id: "bold",
    name: "БОЛД",
    warehouses: [
      {
        id: "meh-tseh",
        name: "Мех цех 1, 2",
        categories: [
          { id: "finished-goods", name: "Бэлэн бүтээгдэхүүн" },
          { id: "raw-material", name: "Түүхий эд" },
          { id: "goods-material", name: "Бараа материал" },
        ],
      },
      {
        id: "butluur",
        name: "Бутлуур",
        categories: [{ id: "goods-material", name: "Бараа материал" }],
      },
      {
        id: "armatur",
        name: "Арматур",
        categories: [
          { id: "wip", name: "Дуусаагүй үйлдвэрлэл" },
          { id: "goods-material", name: "Бараа материал" },
        ],
      },
      {
        id: "silos",
        name: "Силос",
        categories: [
          { id: "cement", name: "Цемент" },
          { id: "ash", name: "Үнс" },
        ],
      },
    ],
  },
  {
    id: "uuguntsetseg",
    name: "УУГАНЦЭЦЭГ",
    warehouses: [
      {
        id: "tov-aguulah",
        name: "Төв агуулах",
        categories: [{ id: "hangamj", name: "Хангамж" }],
      },
      {
        id: "zasvar",
        name: "Засвар",
        categories: [
          { id: "san", name: "Сан" },
          { id: "kran", name: "Кран" },
          { id: "zasvar", name: "Засвар" },
          { id: "tsahilgaan", name: "Цахилгаан" },
        ],
      },
    ],
  },
  {
    id: "sarangerel",
    name: "САРАНГЭРЭЛ",
    warehouses: [
      {
        id: "tomor-beton-der",
        name: "Төмөр бетон дэр",
        categories: [
          { id: "raw-material", name: "Түүхий эд" },
          { id: "goods-material", name: "Бараа материал" },
          { id: "finished-goods", name: "Бэлэн бүтээгдэхүүн" },
          { id: "tomor-beton-hooloi", name: "Төмөр бетон хоолой" },
          { id: "koltso", name: "Кольцо" },
          { id: "70x90", name: "70х90" },
        ],
      },
      {
        id: "baz-3-4",
        name: "БАЗ 3,4",
        categories: [
          { id: "raw-material", name: "Түүхий эд" },
          { id: "wip", name: "Дуусаагүй үйлдвэрлэл" },
          { id: "chemical-additive", name: "Химийн нэмэлт" },
        ],
      },
    ],
  },
  {
    id: "gadaa-talbai",
    name: "ГАДАА ТАЛБАЙ",
    warehouses: [
      {
        id: "gadaa-talbai",
        name: "Гадаа талбай",
        categories: [
          { id: "raw-material", name: "Түүхий эд" },
          { id: "finished-goods", name: "Бэлэн бүтээгдэхүүн" },
        ],
      },
    ],
  },
  {
    id: "bold-1",
    name: "БОЛД 1",
    warehouses: [
      {
        id: "tsainy-gazar",
        name: "Цайны газар",
        categories: [
          { id: "finished-goods", name: "Бэлэн бүтээгдэхүүн" },
          { id: "raw-material", name: "Түүхий эд" },
          { id: "hangamj", name: "Хангамж" },
        ],
      },
    ],
  },
];

export function findWarehouseGroup(groupId: string) {
  return WAREHOUSE_GROUPS.find((g) => g.id === groupId) ?? null;
}

export function findSubWarehouse(groupId: string, warehouseId: string) {
  const group = findWarehouseGroup(groupId);
  if (!group) return null;
  const warehouse = group.warehouses.find((w) => w.id === warehouseId) ?? null;
  if (!warehouse) return null;
  return { group, warehouse };
}

export function findWarehouseItem(
  groupId: string,
  warehouseId: string,
  categoryId: string,
  itemId: string
) {
  const found = findSubWarehouse(groupId, warehouseId);
  if (!found) return null;
  const category = found.warehouse.categories.find((c) => c.id === categoryId) ?? null;
  if (!category) return null;
  const item = category.items?.find((i) => i.id === itemId) ?? null;
  if (!item) return null;
  return { ...found, category, item };
}
