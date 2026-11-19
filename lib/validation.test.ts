import { describe, expect, it } from "vitest";
import { apiCreateRequestItemSchema, apiCreateRequestSchema, describeApiIssue, materialRequestItemSchema } from "./validation";

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

describe("apiCreateRequestSchema: the reported iPhone submission and the messages for a bad one", () => {
  // Exactly what the form sends for: material "Bal", unit "Sh", quantity 5, no price, note "Heregtei".
  const reported = { departmentId: "d-concrete", items: [{ materialId: null, materialName: "Bal", unit: "Sh", requestedQuantity: 5, unitPrice: null, note: "Heregtei" }] };

  it("accepts it", () => {
    expect(apiCreateRequestSchema.safeParse(reported).success).toBe(true);
    // ...and the same without the optional fields a client may leave out
    expect(apiCreateRequestSchema.safeParse({ departmentId: "d", items: [{ materialName: "Bal", unit: "Sh", requestedQuantity: 5 }] }).success).toBe(true);
  });

  const firstMessage = (payload: unknown) => {
    const r = apiCreateRequestSchema.safeParse(payload);
    return r.success ? null : describeApiIssue(r.error.issues[0]);
  };

  it("names the field and the row that is wrong", () => {
    expect(firstMessage({ ...reported, departmentId: "" })).toContain("Цех, тасаг: Цех, тасаг сонгогдоогүй");
    expect(firstMessage({ items: reported.items })).toContain("Цех, тасаг");
    expect(firstMessage({ ...reported, items: [] })).toContain("Материалын жагсаалт");
    const bad = (over: object) => firstMessage({ ...reported, items: [reported.items[0], { ...reported.items[0], ...over }] });
    expect(bad({ requestedQuantity: 0 })).toBe("2-р мөр · Тоо хэмжээ: Тоо хэмжээ 0-с их байх ёстой");
    expect(bad({ requestedQuantity: "5" })).toBe("2-р мөр · Тоо хэмжээ: Тоо хэмжээ тоо байх ёстой");
    expect(bad({ unit: " " })).toBe("2-р мөр · Нэгж: Нэгжийг оруулна уу");
    expect(bad({ materialName: "" })).toBe("2-р мөр · Материалын нэр: Материалын нэрийг оруулна уу");
    expect(bad({ unitPrice: -1 })).toBe("2-р мөр · Нэгж үнэ: Нэгж үнэ сөрөг байж болохгүй");
  });
});
