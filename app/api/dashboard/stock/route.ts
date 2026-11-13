// GET /api/dashboard/stock
//   ?date=2026-11-11     (өгөхгүй бол хамгийн сүүлийн агшин зураг)
//   &warehouse=00-001    (агуулахаар шүүх, заавал биш; "none" = агуулах тодорхойгүй мөрүүд)
//   &q=элс               (барааны нэр/кодоор хайх, заавал биш)
//   &limit=500
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { isDate } from "@/lib/onec/dates";

export const dynamic = "force-dynamic";

// 1С одоогоор агуулахын код/нэрийг хоосон өгч байгаа: шүүлтэд "none" гэсэн нэг утгаар төлөөлнө
const NO_WAREHOUSE = "none";

export const GET = withTiming("GET /api/dashboard/stock", async (req: Request) => {
  const denied = await requireFinanceAccess("stock");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const warehouse = sp.get("warehouse") || null;
  const q = sp.get("q")?.trim().slice(0, 100) || null;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 500) || 500, 1), 5000);

  let date = sp.get("date");
  if (date && !isDate(date)) {
    return NextResponse.json({ error: "date нь YYYY-MM-DD хэлбэртэй байх ёстой" }, { status: 400 });
  }
  if (!date) {
    const latest = await prisma.$queryRaw<{ d: string | null }[]>`SELECT max(snapshot_date)::text AS d FROM onec_stock`;
    date = latest[0]?.d ?? null;
    if (!date) return NextResponse.json({ date: null, warehouses: [], items: [], totals: null, lastSyncedAt: null });
  }

  const [totals, warehouses, items, lastSync] = await Promise.all([
    prisma.$queryRaw<{ items: number; warehouses: number; amount: number; negative_rows: number }[]>`
      SELECT count(DISTINCT item_code)::int AS items,
             count(DISTINCT warehouse_code) FILTER (WHERE warehouse_code <> '')::int AS warehouses,
             coalesce(sum(amount),0)::float8 AS amount,
             count(*) FILTER (WHERE qty < 0)::int AS negative_rows
        FROM onec_stock WHERE snapshot_date = ${date}::date`,
    prisma.$queryRaw<{ warehouse_code: string; warehouse: string; items: number; amount: number }[]>`
      SELECT warehouse_code, max(warehouse) AS warehouse,
             count(DISTINCT item_code)::int AS items, sum(amount)::float8 AS amount
        FROM onec_stock WHERE snapshot_date = ${date}::date
       GROUP BY warehouse_code ORDER BY amount DESC`,
    prisma.$queryRaw<
      {
        id: string; warehouse_code: string; warehouse: string; item_code: string; item: string; unit: string;
        account: string; qty: number; amount: number; unit_cost: number | null;
      }[]
    >`
      SELECT id::text AS id, warehouse_code, warehouse, item_code, item, unit, account,
             qty::float8 AS qty, amount::float8 AS amount,
             CASE WHEN qty <> 0 THEN (amount / qty)::float8 END AS unit_cost
        FROM onec_stock
       WHERE snapshot_date = ${date}::date
         AND (${warehouse}::text IS NULL
              OR warehouse_code = CASE WHEN ${warehouse}::text = ${NO_WAREHOUSE} THEN '' ELSE ${warehouse}::text END)
         AND (${q}::text IS NULL OR item ILIKE '%' || ${q}::text || '%' OR item_code ILIKE '%' || ${q}::text || '%')
       ORDER BY warehouse, item
       LIMIT ${limit}`,
    prisma.onecSyncLog.findFirst({
      where: { ok: true, kind: "stock" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  return NextResponse.json({
    date,
    totals: totals[0],
    warehouses,
    items,
    lastSyncedAt: lastSync?.finishedAt ?? null,
  });
});
