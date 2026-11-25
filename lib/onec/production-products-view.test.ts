import { describe, expect, it } from "vitest";
import { buildDirectorView, buildWorkshopView, productCats, type ProductionLineRow } from "./production-view";

const TODAY = "2098-04-10";
const TBHETS = "Төмөр бетон хийц эдлэлийн цех";
const TEN = "Тенсиланд хэсэг";
const METAL = "Металл хийц үйлдвэрлэлийн цех";

let n = 0;
const line = (over: Partial<ProductionLineRow> & Pick<ProductionLineRow, "product" | "quantity">): ProductionLineRow => ({
  day: "2098-04-09",
  docRef: `doc-${++n}`,
  docNumber: `Д-${n}`,
  posted: true,
  stage: "finished",
  department: TBHETS,
  unit: "ш",
  ...over,
});

// ТБХЭЦ: 4 төрлийн бүтээгдэхүүн (17 + 10 + 5 + 3): нийлбэр (35) хаана ч гарахгүй
const lines = [
  line({ product: "БУЗ суваг Н-910", quantity: 17 }),
  line({ product: "БУЗ суваг Н-910 Зас", quantity: 2 }),
  line({ product: "БУЗ суваг Н-910 Брак", quantity: 1 }),
  line({ product: "БУЗ суваг Н-710", quantity: 10 }),
  line({ product: "Лотки Л-9", quantity: 5 }),
  line({ product: "L panel", quantity: 3 }),
  line({ product: "БУЗ суваг Н-910", quantity: 4, day: "2098-04-08" }),
  line({ product: "Шон 80*80", quantity: 715, department: TEN }),
];

describe("productCats", () => {
  const rows = lines.filter((l) => l.day === "2098-04-09" && l.department === TBHETS);
  it("бетон хийцийн цех: үндсэн нэрээр Бэлэн/Засвар/Брак тусдаа, их нь эхэнд", () => {
    expect(productCats(rows, true).map((p) => [p.name, p.ready, p.repair, p.defect])).toEqual([
      ["БУЗ суваг Н-910", 17, 2, 1],
      ["БУЗ суваг Н-710", 10, 0, 0],
      ["Лотки Л-9", 5, 0, 0],
      ["L panel", 3, 0, 0],
    ]);
  });
  it("бетон бус цех: засвар бэлэнд нийлнэ, брак орохгүй (карт гарцад брак ордоггүй)", () => {
    const r = [line({ product: "Хаалга", quantity: 10 }), line({ product: "Хаалга Зас", quantity: 2 })];
    expect(productCats(r, false)).toEqual([{ name: "Хаалга", unit: "ш", ready: 12, repair: 0, defect: 0 }]);
  });
  it("нэгж өөр бол тусдаа бүтээгдэхүүн (нэмэгдэхгүй)", () => {
    expect(productCats([line({ product: "Бетон", quantity: 5 }), line({ product: "Бетон", quantity: 7, unit: "м3" })], false)).toHaveLength(2);
  });
});

describe("цехийн картын бүтээгдэхүүн", () => {
  const v = buildDirectorView({ day: "2098-04-09", today: TODAY, lines });
  const tb = v.cards.find((c) => c.name === TBHETS)!;
  it("олон бүтээгдэхүүн: өдрийн жагсаалт 4, сарын жагсаалтад Н-910 нийт 21", () => {
    expect(tb.products.map((p) => p.name)).toEqual(["БУЗ суваг Н-910", "БУЗ суваг Н-710", "Лотки Л-9", "L panel"]);
    expect(tb.monthProducts.find((p) => p.name === "БУЗ суваг Н-910")).toMatchObject({ qty: 21, repair: 2, defect: 1 });
  });
  it("нэг бүтээгдэхүүнтэй цех: ганц бүтээгдэхүүн", () => {
    expect(v.cards.find((c) => c.name === TEN)!.products).toEqual([{ name: "Шон 80*80", qty: 715, unit: "ш", repair: 0, defect: 0 }]);
  });
  it("сарын өдөр бүрийн бүтээгдэхүүн: зөвхөн гарцтай өдөр, шинэ өдрүүд", () => {
    expect(tb.monthDaysProducts.map((d) => d.date)).toEqual(["2098-04-08", "2098-04-09"]);
    expect(tb.monthDaysProducts[0].items).toEqual([{ name: "БУЗ суваг Н-910", unit: "ш", ready: 4, repair: 0, defect: 0 }]);
    expect(tb.monthDaysProducts[1].items.map((p) => p.name)).toEqual(["БУЗ суваг Н-910", "БУЗ суваг Н-710", "Лотки Л-9", "L panel"]);
  });
  it("нийт мөр (total) байхгүй", () => {
    expect("total" in v).toBe(false);
  });
});

describe("цехийн хуудас: 12 сар бүтээгдэхүүнээр", () => {
  const history = [...lines, line({ product: "БУЗ суваг Н-910", quantity: 30, day: "2097-12-15" }), line({ product: "БУЗ суваг Н-910 Брак", quantity: 3, day: "2097-12-16" })];
  const w = buildWorkshopView({ name: TBHETS, day: "2098-04-09", today: TODAY, lines, history, ledger: [] });
  it("12 сар, сар бүр бүтээгдэхүүнтэй; брак хувь нэг бүтээгдэхүүнээр тооцогдоно", () => {
    expect(w.monthsProducts).toHaveLength(12);
    expect(w.monthsProducts.at(-1)!.month).toBe("2098-04");
    const dec = w.monthsProducts.find((m) => m.month === "2097-12")!;
    expect(dec.items).toEqual([{ name: "БУЗ суваг Н-910", unit: "ш", ready: 30, repair: 0, defect: 3 }]);
    const all = w.monthsProducts.flatMap((m) => m.items).filter((p) => p.name === "БУЗ суваг Н-910");
    expect(all.reduce((a, p) => a + p.defect, 0)).toBe(4); // 1 + 3
  });
  it("бетон бус цех (Металл): засвар бэлэнд нийлнэ", () => {
    const m = [line({ product: "Хаалга", quantity: 10, department: METAL }), line({ product: "Хаалга Зас", quantity: 2, department: METAL })];
    const mw = buildWorkshopView({ name: "Металл хийц", day: "2098-04-09", today: TODAY, lines: m, history: m, ledger: [] });
    expect(mw.monthsProducts.at(-1)!.items).toEqual([{ name: "Хаалга", unit: "ш", ready: 12, repair: 0, defect: 0 }]);
  });
});
