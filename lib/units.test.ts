import { describe, expect, it } from "vitest";
import { formatQuantities, formatQuantity, sumQuantities, unitName } from "./units";

describe("unitName", () => {
  it("1С-ийн товчлолыг хүнийхээр", () => {
    expect(["ш", "Шт", "Sh", "pcs"].map(unitName)).toEqual(["ширхэг", "ширхэг", "ширхэг", "ширхэг"]);
    expect([unitName("тн"), unitName("м3"), unitName("м³"), unitName("м"), unitName("л"), unitName("компл")]).toEqual(["тонн", "шоо метр", "шоо метр", "метр", "литр", "иж бүрдэл"]);
    expect(unitName("боодол")).toBe("боодол");
  });
  it("тодорхойгүй нэгж өөрийнхөөрөө, хоосон бол «нэгж»", () => {
    expect(unitName("рулон")).toBe("рулон");
    expect(unitName("  ")).toBe("нэгж");
  });
});

describe("formatQuantity", () => {
  it("ширхэг, тонн, бутархай", () => {
    expect(formatQuantity(3200, "ш").short).toBe("3,200 ширхэг");
    expect(formatQuantity(30, "тн").short).toBe("30 тонн");
    expect(formatQuantity(21.456, "тн").short).toBe("21.46 тонн");
    expect(formatQuantity(1.5, "м3").short).toBe("1.5 шоо метр");
  });
  it("кг ≥ 1000 бол тонн (бүтэн нь кг-аар), бага бол кг", () => {
    expect(formatQuantity(30250, "кг")).toEqual({ short: "30.3 тонн", full: "30,250 кг" });
    expect(formatQuantity(999, "кг").short).toBe("999 кг");
    expect(formatQuantity(-2500, "кг").short).toBe("−2.5 тонн");
  });
});

describe("sumQuantities: өөр нэгжийг нэмэхгүй", () => {
  it("кг нь тонн болж нийлнэ, ширхэг, метр тусдаа", () => {
    const sum = sumQuantities([
      { qty: 30, unit: "тн" },
      { qty: 18500, unit: "кг" },
      { qty: 3000, unit: "ш" },
      { qty: 200, unit: "Sh" },
      { qty: 12, unit: "м" },
    ]);
    expect(sum).toEqual([
      { unit: "тонн", qty: 48.5 },
      { unit: "метр", qty: 12 },
      { unit: "ширхэг", qty: 3200 },
    ]);
    expect(formatQuantities(sum).short).toBe("48.5 тонн · 12 метр · 3,200 ширхэг");
  });
  it("хоосон нийлбэр", () => {
    expect(formatQuantities([]).short).toBe("—");
  });
});
