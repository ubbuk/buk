// Агуулахын үлдэгдлийн 3 түвшний мод: нярвын бүлэг → 1С склад → бараа. Складын код (1С-ийн Catalog_Склады.Code) нь Warehouse.onecCode-той таарна.
// Цэвэр функц (DB, React-гүй): app/api/dashboard/stock/route.ts мод барьж, хуудас зөвхөн харуулна.
// Нярвын нэр Warehouse.keeperId → User-ээс ирнэ (кодонд нэр бичихгүй). Нярав дээд түвшний бүлэгт оноогдоно (lib/warehouse-keeper-admin.ts),
// тиймээс склад нь өөрийн keeperId-гүй бол бүлгийнхийг авна (lib/warehouse-keeper.ts-ийн topLevelOf-тэй ижил).

/**
 * 14xx дансны 2-р субконтод агуулах БАЙХГҮЙ мөрүүд: 1418.xx (ашиглалтанд буй багаж, ажлын хувцас, БҮТЭЗ: ажилтан, цехэд олгосон) ба
 * агуулахын талбарыг 1С-д бөглөөгүй мөр. Хуурамч «агуулах» болгохгүй: дансныхаа НЭРээр, нэг тусдаа бүлэгт. Нийт дүнд орно.
 * Эдгээр мөрийн складын код нь `acct:<дансны код>` (stock-live.ts); хуучин хоосон код ч мөн энд.
 */
export const OFF_WAREHOUSE_KEY = "off-warehouse";
export const OFF_WAREHOUSE_NAME = "Агуулахад хадгалагдаагүй үлдэгдэл";
export const OFF_WAREHOUSE_PREFIX = "acct:";
export const isOffWarehouse = (code: string): boolean => code === "" || code.startsWith(OFF_WAREHOUSE_PREFIX);

export interface WarehouseRow {
  id: string;
  name: string;
  onecCode: string | null;
  parentId: string | null;
  reservable: boolean;
  keeperId: string | null;
  keeperName: string | null;
}

export interface KeeperRef {
  id: string;
  name: string;
}

export interface StockRow {
  id: string;
  warehouse_code: string;
  warehouse: string;
  item_code: string;
  item: string;
  unit: string;
  account: string;
  /** барааны бүлэг (хүнийхээр): мөрийн хамгийн их дүнтэй дансны нэр. Хуучин мөрд байхгүй байж болно. */
  group?: string;
  qty: number;
  amount: number;
  unit_cost: number | null;
}

export interface StockWarehouseNode {
  /** onecCode (ERP-д холбогдоогүй бол 1С-ийн код; код хоосон бол "none") */
  key: string;
  name: string;
  keeper: KeeperRef | null;
  /** false: бэлэн бүтээгдэхүүн гэх мэт, материалын хүсэлтэд нөөцлөгддөггүй */
  reservable: boolean;
  items: number;
  amount: number;
  rows: StockRow[];
}

export interface StockGroupNode {
  key: string;
  name: string;
  /** group: ERP-ийн нярвын бүлэг · unmapped: код нь Warehouse.onecCode-д байхгүй склад · off_warehouse: 2-р субконтод агуулахгүй (1418.xx ашиглалтанд буй хэрэгсэл г.м.) */
  kind: "group" | "unmapped" | "off_warehouse";
  keeper: KeeperRef | null;
  items: number;
  amount: number;
  /** off_warehouse: эдгээр мөрийн дансны НЭРүүд */
  accounts: string[];
  warehouses: StockWarehouseNode[];
}

const keeperOf = (w: Pick<WarehouseRow, "keeperId" | "keeperName">): KeeperRef | null => (w.keeperId ? { id: w.keeperId, name: w.keeperName ?? "—" } : null);

/** Склад бүрийн нярав: өөрийнх, үгүй бол бүлгийнх; оноогоогүй бол null */
export function effectiveKeeper(leaf: WarehouseRow, byId: Map<string, WarehouseRow>): KeeperRef | null {
  return keeperOf(leaf) ?? (leaf.parentId && byId.get(leaf.parentId) ? keeperOf(byId.get(leaf.parentId)!) : null);
}

/** 1С-ийн складын (onecCode-той) жагсаалт, бүлгийн нярвын хамт: шүүлтийн сонголт болон нярваар шүүхэд */
export function leafWarehouses(warehouses: WarehouseRow[]) {
  const byId = new Map(warehouses.map((w) => [w.id, w]));
  return warehouses
    .filter((w) => w.onecCode)
    .map((w) => ({ ...w, code: w.onecCode as string, group: w.parentId ? byId.get(w.parentId) ?? null : null, keeper: effectiveKeeper(w, byId) }));
}

const distinctItems = (rows: StockRow[]) => new Set(rows.map((r) => r.item_code)).size;
const sum = (rows: StockRow[]) => rows.reduce((s, r) => s + r.amount, 0);
const byAmountDesc = <T extends { amount: number; name: string }>(a: T, b: T) => b.amount - a.amount || a.name.localeCompare(b.name);

function warehouseNode(key: string, name: string, keeper: KeeperRef | null, reservable: boolean, rows: StockRow[]): StockWarehouseNode {
  return { key, name, keeper, reservable, items: distinctItems(rows), amount: sum(rows), rows: [...rows].sort((a, b) => b.amount - a.amount || a.item.localeCompare(b.item)) };
}

function groupNode(key: string, name: string, kind: StockGroupNode["kind"], keeper: KeeperRef | null, warehouses: StockWarehouseNode[], rows: StockRow[]): StockGroupNode {
  const accounts = kind === "off_warehouse" ? [...new Set(rows.map((r) => r.account).filter(Boolean))].sort() : [];
  return { key, name, kind, keeper, items: distinctItems(rows), amount: sum(rows), accounts, warehouses: warehouses.sort(byAmountDesc) };
}

/**
 * `rows` нь (шүүлт хийсний дараах) агуулахын үлдэгдлийн мөрүүд. Бүлгүүд дүнгээр буурахаар; ERP-д холбогдоогүй складууд, хамгийн доор «Агуулахад хадгалагдаагүй үлдэгдэл».
 * `includeEmpty`: шүүлтгүй үед бараагүй складыг ч (0 бараа) харуулна; шүүлттэй үед зөвхөн таарсныг.
 */
export function buildStockTree(warehouses: WarehouseRow[], rows: StockRow[], opts: { includeEmpty: boolean }): StockGroupNode[] {
  const byId = new Map(warehouses.map((w) => [w.id, w]));
  const leaves = leafWarehouses(warehouses);
  const leafByCode = new Map(leaves.map((l) => [l.code, l]));

  const rowsByCode = new Map<string, StockRow[]>();
  for (const r of rows) rowsByCode.set(r.warehouse_code, [...(rowsByCode.get(r.warehouse_code) ?? []), r]);

  const groups: StockGroupNode[] = [];

  // ERP-ийн нярвын бүлгүүд (дээд түвшин)
  for (const top of warehouses.filter((w) => !w.parentId)) {
    const mine = leaves.filter((l) => l.parentId === top.id);
    const nodes = mine
      .map((l) => warehouseNode(l.code, l.name, effectiveKeeper(l, byId), l.reservable, rowsByCode.get(l.code) ?? []))
      .filter((n) => opts.includeEmpty || n.rows.length > 0);
    if (nodes.length === 0) continue;
    groups.push(groupNode(top.id, top.name, "group", keeperOf(top), nodes, nodes.flatMap((n) => n.rows)));
  }

  // onecCode нь Warehouse-д байхгүй (эсвэл бүлэггүй) складууд: нууж болохгүй, тусад нь
  const covered = new Set(groups.flatMap((g) => g.warehouses.map((w) => w.key)));
  const strayCodes = [...rowsByCode.keys()].filter((c) => !isOffWarehouse(c) && !covered.has(c));
  if (strayCodes.length) {
    const nodes = strayCodes.map((c) => {
      const rs = rowsByCode.get(c)!;
      const known = leafByCode.get(c);
      return warehouseNode(c, known?.name ?? rs[0].warehouse ?? c, known ? effectiveKeeper(known, byId) : null, known?.reservable ?? true, rs);
    });
    groups.push(groupNode("unmapped", "ERP-д холбогдоогүй склад", "unmapped", null, nodes, nodes.flatMap((n) => n.rows)));
  }

  groups.sort((a, b) => byAmountDesc(a, b));

  // Агуулахгүй мөрүүд: хамгийн доор, нэг бүлэг, дансны нэр бүрээр тусдаа хэсэг
  const blank = rows.filter((r) => isOffWarehouse(r.warehouse_code));
  if (blank.length) {
    const byAccount = new Map<string, StockRow[]>();
    for (const r of blank) byAccount.set(r.warehouse_code, [...(byAccount.get(r.warehouse_code) ?? []), r]);
    const nodes = [...byAccount].map(([code, rs]) => warehouseNode(code || OFF_WAREHOUSE_KEY, rs[0].warehouse || OFF_WAREHOUSE_NAME, null, true, rs));
    groups.push(groupNode(OFF_WAREHOUSE_KEY, OFF_WAREHOUSE_NAME, "off_warehouse", null, nodes, blank));
  }

  // «unmapped» нь бусад бүлгийн дараа, «off_warehouse» нь бүгдийн дараа (дүнгээр эрэмбэлэхэд хүчинтэй хэвээр)
  const order = (g: StockGroupNode) => (g.kind === "group" ? 0 : g.kind === "unmapped" ? 1 : 2);
  return groups.sort((a, b) => order(a) - order(b));
}
