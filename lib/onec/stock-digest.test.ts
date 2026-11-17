import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { stockDigest, type StockDigestRow } from "./stock-digest";

const row = (over: Partial<StockDigestRow> = {}): StockDigestRow => ({
  org: "Байгууллага",
  warehouseCode: "00-001",
  warehouse: "Төв агуулах",
  itemCode: "M1",
  item: "Бараа",
  unit: "ш",
  account: "1510",
  qty: 5,
  amount: 500,
  ...over,
});

describe("stockDigest", () => {
  it("мөрийн дараалалд үл хамаарна", () => {
    const a = row({ itemCode: "A" });
    const b = row({ itemCode: "B" });
    const c = row({ itemCode: "C", warehouseCode: "00-002" });
    expect(stockDigest([a, b, c])).toBe(stockDigest([c, a, b]));
  });

  it("DB-ийн Decimal ба 1С-ийн тоо нэг утгатай бол ижил (12.5 = 12.5000, 500 = 500.00)", () => {
    const fromOnec = row({ qty: 12.5, amount: 500 });
    const fromDb = row({ qty: new Prisma.Decimal("12.5000"), amount: new Prisma.Decimal("500.00") });
    expect(stockDigest([fromOnec])).toBe(stockDigest([fromDb]));
  });

  it("DB-ийн нарийвчлалаас цааших орон нь ялгаа үүсгэхгүй (Decimal(18,2)-ийн дугуйруулалттай нийцнэ)", () => {
    expect(stockDigest([row({ amount: 100.004 })])).toBe(stockDigest([row({ amount: new Prisma.Decimal("100.00") })]));
    expect(stockDigest([row({ amount: 100.005 })])).toBe(stockDigest([row({ amount: new Prisma.Decimal("100.01") })]));
  });

  it("талбар бүрийн өөрчлөлтийг мэдэрнэ", () => {
    const base = stockDigest([row()]);
    for (const over of [
      { org: "Өөр" },
      { warehouseCode: "00-009" },
      { warehouse: "Өөр агуулах" },
      { itemCode: "M2" },
      { item: "Өөр бараа" },
      { unit: "кг" },
      { account: "1520" },
      { qty: 6 },
      { qty: 5.0001 },
      { amount: 500.01 },
    ] as Partial<StockDigestRow>[]) {
      expect(stockDigest([row(over)]), JSON.stringify(over)).not.toBe(base);
    }
  });

  it("мөр нэмэх, давхардсан мөрийг мэдэрнэ; хоосон жагсаалт тогтвортой", () => {
    expect(stockDigest([row(), row()])).not.toBe(stockDigest([row()]));
    expect(stockDigest([row(), row({ itemCode: "M2" })])).not.toBe(stockDigest([row()]));
    expect(stockDigest([])).toBe(stockDigest([]));
    expect(stockDigest([])).not.toBe(stockDigest([row()]));
  });

  it("талбарын хил давхцаж төөрөлдөхгүй (a|bc ≠ ab|c)", () => {
    expect(stockDigest([row({ itemCode: "a", item: "bc" })])).not.toBe(stockDigest([row({ itemCode: "ab", item: "c" })]));
  });
});
