import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { readSalesQty, readStockNow } from "./product-store";

// Бусад тестийн өгөгдөлтэй мөргөлдөхгүй: өвөрмөц нэр, алс ирээдүйн огноо; дуустал цэвэрлэнэ
const ITEM = "Тест бүтээгдэхүүн PS-1";
const DAY = new Date("2098-05-10T00:00:00Z");

afterAll(async () => {
  await prisma.onecSales.deleteMany({ where: { item: ITEM } });
  await prisma.onecStock.deleteMany({ where: { item: ITEM } });
});

describe("product-store", () => {
  it("readSalesQty: өдөр, бараа, нэгжээр нэгтгэнэ (буцаалт сөрөг тоогоор хасагдана); хугацааны гаднах мөр орохгүй", async () => {
    await prisma.onecSales.createMany({
      data: [
        { date: DAY, item: ITEM, unit: "ш", qty: 10 },
        { date: DAY, item: ITEM, unit: "ш", qty: 5 },
        { date: DAY, item: ITEM, unit: "ш", qty: -2 },
        { date: new Date("2098-06-01T00:00:00Z"), item: ITEM, unit: "ш", qty: 99 },
      ],
    });
    const rows = (await readSalesQty("2098-05-01", "2098-05-31")).filter((r) => r.item === ITEM);
    expect(rows).toEqual([{ day: "2098-05-10", item: ITEM, unit: "ш", qty: 13 }]);
  });
  it("readStockNow: хамгийн сүүлийн агшин зургийн агуулах бүрээр (өмнөх агшин орохгүй)", async () => {
    await prisma.onecStock.createMany({
      data: [
        { snapshotDate: DAY, warehouseCode: "A", warehouse: "А", item: ITEM, unit: "ш", account: "x", qty: 40 },
        { snapshotDate: DAY, warehouseCode: "B", warehouse: "Б", item: ITEM, unit: "ш", account: "x", qty: 2 },
        { snapshotDate: new Date("2098-05-01T00:00:00Z"), warehouseCode: "A", warehouse: "А", item: ITEM, unit: "ш", account: "x", qty: 777 },
      ],
    });
    const now = await readStockNow();
    expect(now.asOf).toBe("2098-05-10");
    expect(now.rows.filter((r) => r.item === ITEM).sort((a, b) => b.qty - a.qty)).toEqual([
      { item: ITEM, unit: "ш", warehouse: "А", qty: 40 },
      { item: ITEM, unit: "ш", warehouse: "Б", qty: 2 },
    ]);
  });
});
