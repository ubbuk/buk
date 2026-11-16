// GET /api/dashboard/stock
//   ?date=2026-11-11     (өгөхгүй бол хамгийн сүүлийн агшин зураг)
//   &warehouse=00-000005 (1С складын код; "none" = складын код хоосон мөрүүд)
//   &keeper=<userId>     (нярваар: тухайн нярвын бүлгийн складууд; "none" = нярав оноогоогүй складууд)
//   &q=элс               (барааны нэр/кодоор хайх)
// Хариу: нярвын бүлэг → 1С склад → бараа мод (lib/onec/stock-tree.ts). Склад нь onec_stock.warehouse_code = Warehouse.onecCode-оор холбогдоно.
// Шүүлтүүд мөр, нийт дүн, бүлэг бүрийн тоог хамт шүүнэ.
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { isDate } from "@/lib/onec/dates";
import { UNKNOWN_WAREHOUSE_KEY, buildStockTree, leafWarehouses, type StockRow, type WarehouseRow } from "@/lib/onec/stock-tree";

export const dynamic = "force-dynamic";

// Мөрийн дээд хязгаар (бодит агшин зураг ~2000 мөр): давбал `truncated`
const ROW_LIMIT = 20000;

export const GET = withTiming("GET /api/dashboard/stock", async (req: Request) => {
  const denied = await requireFinanceAccess("stock");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const warehouse = sp.get("warehouse") || null;
  const keeper = sp.get("keeper") || null;
  const q = sp.get("q")?.trim().slice(0, 100) || null;

  let date = sp.get("date");
  if (date && !isDate(date)) {
    return NextResponse.json({ error: "date нь YYYY-MM-DD хэлбэртэй байх ёстой" }, { status: 400 });
  }
  if (!date) {
    const latest = await prisma.$queryRaw<{ d: string | null }[]>`SELECT max(snapshot_date)::text AS d FROM onec_stock`;
    date = latest[0]?.d ?? null;
    if (!date) return NextResponse.json({ date: null, totals: null, groups: [], filters: { keepers: [], warehouses: [], hasUnknown: false }, truncated: false, lastSyncedAt: null });
  }

  const warehouseRows = await prisma.warehouse.findMany({
    select: { id: true, name: true, onecCode: true, parentId: true, reservable: true, keeperId: true, keeper: { select: { name: true } } },
    orderBy: [{ sortPriority: "asc" }, { name: "asc" }],
  });
  const warehouses: WarehouseRow[] = warehouseRows.map((w) => ({ id: w.id, name: w.name, onecCode: w.onecCode, parentId: w.parentId, reservable: w.reservable, keeperId: w.keeperId, keeperName: w.keeper?.name ?? null }));
  const leaves = leafWarehouses(warehouses);

  // нярваар шүүх = тухайн нярвын складуудын кодууд
  const keeperCodes = keeper ? leaves.filter((l) => (keeper === "none" ? !l.keeper : l.keeper?.id === keeper)).map((l) => l.code) : null;

  const conditions: Prisma.Sql[] = [Prisma.sql`snapshot_date = ${date}::date`];
  if (warehouse) conditions.push(warehouse === UNKNOWN_WAREHOUSE_KEY ? Prisma.sql`warehouse_code = ''` : Prisma.sql`warehouse_code = ${warehouse}`);
  if (keeperCodes) conditions.push(Prisma.sql`warehouse_code = ANY(${keeperCodes}::text[])`);
  if (q) conditions.push(Prisma.sql`(item ILIKE ${"%" + q + "%"} OR item_code ILIKE ${"%" + q + "%"})`);
  const where = Prisma.join(conditions, " AND ");

  const [totals, rows, unknownRow, lastSync] = await Promise.all([
    prisma.$queryRaw<{ items: number; warehouses: number; amount: number; negative_rows: number }[]>`
      SELECT count(DISTINCT item_code)::int AS items,
             count(DISTINCT warehouse_code) FILTER (WHERE warehouse_code <> '')::int AS warehouses,
             coalesce(sum(amount),0)::float8 AS amount,
             count(*) FILTER (WHERE qty < 0)::int AS negative_rows
        FROM onec_stock WHERE ${where}`,
    prisma.$queryRaw<StockRow[]>`
      SELECT id::text AS id, warehouse_code, warehouse, item_code, item, unit, account,
             qty::float8 AS qty, amount::float8 AS amount,
             CASE WHEN qty <> 0 THEN (amount / qty)::float8 END AS unit_cost
        FROM onec_stock
       WHERE ${where}
       ORDER BY amount DESC, item
       LIMIT ${ROW_LIMIT + 1}`,
    prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM onec_stock WHERE snapshot_date = ${date}::date AND warehouse_code = '' LIMIT 1`,
    prisma.onecSyncLog.findFirst({
      where: { ok: true, kind: "stock" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  const truncated = rows.length > ROW_LIMIT;
  const groups = buildStockTree(warehouses, truncated ? rows.slice(0, ROW_LIMIT) : rows, { includeEmpty: !warehouse && !keeper && !q });

  // шүүлтийн сонголтууд нь идэвхтэй шүүлтээс хамаарахгүй; нярвын жагсаалт = нярав оноогдсон хэрэглэгчид
  const keepers = [...new Map(leaves.flatMap((l) => (l.keeper ? [[l.keeper.id, l.keeper] as const] : []))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const filters = {
    keepers,
    hasUnassigned: leaves.some((l) => !l.keeper),
    warehouses: leaves.map((l) => ({ code: l.code, name: l.name, group: l.group?.name ?? "" })),
    hasUnknown: unknownRow.length > 0,
  };

  return NextResponse.json({
    date,
    totals: totals[0],
    groups,
    filters,
    truncated,
    lastSyncedAt: lastSync?.finishedAt ?? null,
  });
});
