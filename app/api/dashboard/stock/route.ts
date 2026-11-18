// GET /api/dashboard/stock[?refresh=1]
//   ?date=2026-11-11     (өгөхгүй бол өнөөдөр, Улаанбаатарын цагаар)
//   &warehouse=00-000008 (1С складын код; "off-warehouse" = 2-р субконтод агуулахгүй үлдэгдэл: 1418.xx г.м.)
//   &keeper=<userId>     (нярваар: тухайн нярвын бүлгийн складууд; "none" = нярав оноогоогүй складууд)
//   &q=элс               (барааны нэр/кодоор хайх)
// Хариу: нярвын бүлэг → 1С склад → бараа мод (lib/onec/stock-tree.ts). Үлдэгдлийг 1С-ийн 14xx дансны Balance-аас, 2-р субконто (Агуулах)-оор
// ШУУД авна (ЗӨВХӨН УНШИХ, 5 минутын cache; lib/onec/stock-live.ts). Склад нь 1С-ийн Code = Warehouse.onecCode-оор ERP-ийн бүлэгтэй холбогдоно.
// Шүүлтүүд мөр, нийт дүн, бүлэг бүрийн тоог хамт шүүнэ. `reconciliation`: хүснэгтийн нийт = 14xx Balance (142x-гүй) эсэх.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { isDate, today } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";
import { loadStockLive } from "@/lib/onec/stock-live";
import { OFF_WAREHOUSE_KEY, buildStockTree, isOffWarehouse, leafWarehouses, type StockRow, type WarehouseRow } from "@/lib/onec/stock-tree";

export const dynamic = "force-dynamic";
// 1С OData дуудлага бүр хамгийн ихдээ 60 сек (lib/onec/stock-live.ts)
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

const sum = (rows: StockRow[]) => rows.reduce((s, r) => s + r.amount, 0);

export const GET = withTiming("GET /api/dashboard/stock", async (req: Request) => {
  const denied = await requireFinanceAccess("stock");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const warehouse = sp.get("warehouse") || null;
  const keeper = sp.get("keeper") || null;
  const q = sp.get("q")?.trim().slice(0, 100).toLowerCase() || null;

  const date = sp.get("date") ?? today();
  if (!isDate(date) || date > today()) {
    return NextResponse.json({ error: "date нь YYYY-MM-DD хэлбэртэй, ирээдүйн өдөр биш байх ёстой" }, { status: 400, headers: NO_STORE });
  }

  let live;
  try {
    live = await loadStockLive(date, sp.get("refresh") === "1");
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
  const { value, meta } = live;

  const warehouseRows = await prisma.warehouse.findMany({
    select: { id: true, name: true, onecCode: true, parentId: true, reservable: true, keeperId: true, keeper: { select: { name: true } } },
    orderBy: [{ sortPriority: "asc" }, { name: "asc" }],
  });
  const warehouses: WarehouseRow[] = warehouseRows.map((w) => ({ id: w.id, name: w.name, onecCode: w.onecCode, parentId: w.parentId, reservable: w.reservable, keeperId: w.keeperId, keeperName: w.keeper?.name ?? null }));
  const leaves = leafWarehouses(warehouses);

  // нярваар шүүх = тухайн нярвын складуудын кодууд
  const keeperCodes = keeper ? new Set(leaves.filter((l) => (keeper === "none" ? !l.keeper : l.keeper?.id === keeper)).map((l) => l.code)) : null;

  const rows = value.rows.filter(
    (r) =>
      (!warehouse || (warehouse === OFF_WAREHOUSE_KEY ? isOffWarehouse(r.warehouse_code) : r.warehouse_code === warehouse)) &&
      (!keeperCodes || keeperCodes.has(r.warehouse_code)) &&
      (!q || r.item.toLowerCase().includes(q) || r.item_code.toLowerCase().includes(q))
  );

  const totals = {
    items: new Set(rows.map((r) => r.item_code)).size,
    warehouses: new Set(rows.filter((r) => !isOffWarehouse(r.warehouse_code)).map((r) => r.warehouse_code)).size,
    amount: sum(rows),
    negative_rows: rows.filter((r) => r.qty < 0).length,
  };
  const groups = buildStockTree(warehouses, rows, { includeEmpty: !warehouse && !keeper && !q });

  // шүүлтийн сонголтууд нь идэвхтэй шүүлтээс хамаарахгүй; ERP-д холбогдоогүй (гэхдээ 1С-д үлдэгдэлтэй) складыг ч сонгох боломжтой
  const keepers = [...new Map(leaves.flatMap((l) => (l.keeper ? [[l.keeper.id, l.keeper] as const] : []))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const known = new Set(leaves.map((l) => l.code));
  const stray = [...new Map(value.rows.filter((r) => !isOffWarehouse(r.warehouse_code) && !known.has(r.warehouse_code)).map((r) => [r.warehouse_code, { code: r.warehouse_code, name: r.warehouse || r.warehouse_code, group: "" }])).values()];
  const filters = {
    keepers,
    hasUnassigned: leaves.some((l) => !l.keeper),
    warehouses: [...leaves.map((l) => ({ code: l.code, name: l.name, group: l.group?.name ?? "" })), ...stray],
    hasOffWarehouse: value.rows.some((r) => isOffWarehouse(r.warehouse_code)),
  };

  return NextResponse.json(
    {
      date,
      totals,
      groups,
      filters,
      reconciliation: value.reconciliation,
      lastSyncedAt: new Date(meta.fetchedAt).toISOString(),
      meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null },
    },
    { headers: NO_STORE }
  );
});
