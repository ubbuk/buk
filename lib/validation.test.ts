import { describe, expect, it } from "vitest";
import { apiCreateRequestItemSchema, materialRequestItemSchema } from "./validation";

// Schema-level checks for the "unitPrice is optional" change -- fast, no
// DB -- covering the validation layer from the spec's test list directly:
// empty price accepted, a real price still accepted, negative/non-numeric
// price rejected.

const baseItem = {
  id: "row-1",
  materialId: null,
  materialName: "Тест материал",
  warehouseBalance: null,
  unit: "ш",
  requestedQuantity: 5,
};

describe("materialRequestItemSchema (client form)", () => {
  it("accepts a row with no price (unitPrice omitted)", () => {
    expect(materialRequestItemSchema.safeParse(baseItem).success).toBe(true);
  });

  it("accepts a row with unitPrice explicitly null", () => {
    expect(materialRequestItemSchema.safeParse({ ...baseItem, unitPrice: null }).success).toBe(true);
  });

  it("accepts a row with a real price", () => {
    const result = materialRequestItemSchema.safeParse({ ...baseItem, unitPrice: 1500 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitPrice).toBe(1500);
  });

  it("accepts a price of exactly 0 (distinct from no price)", () => {
    const result = materialRequestItemSchema.safeParse({ ...baseItem, unitPrice: 0 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitPrice).toBe(0);
  });

  it("rejects a negative price", () => {
    const result = materialRequestItemSchema.safeParse({ ...baseItem, unitPrice: -100 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric price", () => {
    const result = materialRequestItemSchema.safeParse({ ...baseItem, unitPrice: "abc" });
    expect(result.success).toBe(false);
  });
});

describe("apiCreateRequestItemSchema (POST /api/requests payload)", () => {
  const apiItem = { materialName: "Тест материал", unit: "ш", requestedQuantity: 5 };

  it("accepts an item with unitPrice omitted", () => {
    expect(apiCreateRequestItemSchema.safeParse(apiItem).success).toBe(true);
  });

  it("accepts an item with unitPrice: null", () => {
    expect(apiCreateRequestItemSchema.safeParse({ ...apiItem, unitPrice: null }).success).toBe(true);
  });

  it("accepts an item with a real price", () => {
    expect(apiCreateRequestItemSchema.safeParse({ ...apiItem, unitPrice: 250.5 }).success).toBe(true);
  });

  it("rejects a negative price", () => {
    expect(apiCreateRequestItemSchema.safeParse({ ...apiItem, unitPrice: -1 }).success).toBe(false);
  });

  it("rejects an invalid-format price", () => {
    expect(apiCreateRequestItemSchema.safeParse({ ...apiItem, unitPrice: "100₮" }).success).toBe(false);
  });
});
