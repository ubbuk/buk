// «Бүтээгдэхүүн» табын DB уншилт (1С руу хандахгүй): борлуулалтын тоо хэмжээ, агуулахын одоогийн үлдэгдэл.
import { prisma } from "@/lib/prisma";
import type { SaleQty, StockQty } from "./product-search";

/** Өдөр, бараа, нэгжээр нэгтгэсэн борлуулалтын тоо (буцаалт сөрөг тоогоор орно) */
export async function readSalesQty(from: string, to: string): Promise<SaleQty[]> {
  return prisma.$queryRaw<SaleQty[]>`
    SELECT to_char(date, 'YYYY-MM-DD') AS day, item, unit, SUM(qty)::float8 AS qty
      FROM onec_sales WHERE date >= ${from}::date AND date <= ${to}::date AND item <> ''
     GROUP BY date, item, unit`;
}

/** Хамгийн сүүлийн агшин зургийн агуулах бүрийн үлдэгдэл (бараа, нэгж, агуулахаар; нийт нь бүх агуулахынх). `asOf` = агшин зургийн огноо (байхгүй бол null) */
export async function readStockNow(): Promise<{ asOf: string | null; rows: StockQty[] }> {
  const snap = await prisma.onecStock.aggregate({ _max: { snapshotDate: true } });
  const date = snap._max.snapshotDate;
  if (!date) return { asOf: null, rows: [] };
  const asOf = date.toISOString().slice(0, 10);
  const rows = await prisma.$queryRaw<StockQty[]>`
    SELECT item, unit, warehouse, SUM(qty)::float8 AS qty FROM onec_stock WHERE snapshot_date = ${asOf}::date AND item <> '' GROUP BY item, unit, warehouse`;
  return { asOf, rows };
}
