import { describe, expect, it } from "vitest";
import type { MaterialRequestItemView } from "./types";
import { isUnlinkedLine, warehouseOutcome } from "./warehouse-outcome";

const item = (over: Partial<MaterialRequestItemView>): MaterialRequestItemView => ({
  id: "i", lineNo: 1, materialId: "m1", materialName: "Dewter", warehouseBalance: null, unit: "ш", requestedQuantity: 15, unitPrice: null, totalPrice: null, ...over,
});

describe("warehouseOutcome (read from what the server answered)", () => {
  it("everything issued: done", () => {
    const o = warehouseOutcome({ items: [item({ allocatedQuantity: 15, missingQuantity: 0 })] });
    expect(o).toMatchObject({ kind: "success", title: "Бүгд олгогдлоо, дууслаа" });
  });

  it("a hand-typed line goes to purchasing and says why, even if the keeper typed 15 (the №2026-1372 case)", () => {
    const o = warehouseOutcome({ items: [item({ materialId: null, allocatedQuantity: 0, missingQuantity: 15 })] });
    expect(o.kind).toBe("warning");
    expect(o.title).toBe("1 мөр дутуу — худалдан авалт руу явлаа");
    expect(o.description).toBe("1 мөр каталогт холбогдоогүй тул агуулахаас олгох боломжгүй");
    expect(isUnlinkedLine(item({ materialId: null }))).toBe(true);
  });

  it("mixed: counts issued lines, unlinked lines and lines the stock did not cover", () => {
    const o = warehouseOutcome({
      items: [
        item({ id: "a", allocatedQuantity: 15, missingQuantity: 0 }),
        item({ id: "b", materialId: null, allocatedQuantity: 0, missingQuantity: 4 }),
        item({ id: "c", allocatedQuantity: 3, missingQuantity: 7 }),
      ],
    });
    expect(o.title).toBe("2 мөр дутуу — худалдан авалт руу явлаа");
    expect(o.description).toBe("2 мөр агуулахаас олгогдлоо · 1 мөр каталогт холбогдоогүй тул агуулахаас олгох боломжгүй · 1 мөрийн үлдэгдэл хүрэлцсэнгүй");
  });
});
