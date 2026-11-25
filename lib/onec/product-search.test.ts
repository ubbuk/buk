import { describe, expect, it } from "vitest";
import { buildProductSearch, compactText, last12Months, matchesTokens, periodRange, searchTokens, type ProdLine, type SaleQty, type SearchInput } from "./product-search";

const TBHETS = "Төмөр бетон хийц эдлэлийн цех";
const VOLTA = "Вольтамиксийн хэсэг";
const RING = "Төмөр бетон цагираг Ф-1000 Хүчитгэсэн";
const line = (day: string, department: string, product: string, quantity: number, stage = "finished"): ProdLine => ({ day, department, stage, product, unit: "ш", quantity });

describe("хайлтын жигдрүүлэлт", () => {
  it("том/жижиг үсэг, зай, Ф/ф, -, *, / тэмдгийг үл тооно", () => {
    expect(compactText("Ф-1000")).toBe("1000");
    expect(compactText("ф 1000")).toBe("1000"); // зайтай «ф 1000»: тооны өмнөх «ф» хасагдана
    expect(compactText("Шон 80*80")).toBe("шон8080");
    expect(compactText("  ХООЛОЙ ")).toBe("хоолой");
  });
  it.each(["1000", "ф1000", "Ф-1000", "ф 1000", "ф-1000", "ЦАГИРАГ", "цагираг ф1000", "1000 цагираг", "хүчитгэсэн 1000"])("«%s» нь Ф-1000 цагирагт таарна", (q) => {
    expect(matchesTokens(RING, searchTokens(q))).toBe(true);
  });
  it("«зас», «брак» үгийг үл тооно, нэр дээрх дагавар хайлтад саад болохгүй, үл таарвал худал", () => {
    expect(searchTokens("1000 брак")).toEqual(["1000"]);
    expect(matchesTokens(`${RING} Зас`, searchTokens("ф1000 зас"))).toBe(true);
    expect(matchesTokens(`${RING} Брак`, searchTokens("брак"))).toBe(false); // зөвхөн «брак» = хоосон хайлт
    expect(matchesTokens(RING, searchTokens("2000"))).toBe(false);
    expect(matchesTokens(RING, searchTokens("   "))).toBe(false);
  });
});

const base: Omit<SearchInput, "lines"> = { q: "1000", from: "2026-10-01", to: "2026-10-31", today: "2026-11-25", sales: [], stock: [], showSales: true };

describe("бүтээгдэхүүн хайх: 1С-тэй тулгасан жишээ (2026-10, Ф-1000 Хүчитгэсэн)", () => {
  const lines = [
    line("2026-10-06", VOLTA, RING, 40),
    line("2026-10-07", VOLTA, RING, 37),
    line("2026-10-08", VOLTA, RING, 37),
    line("2026-10-09", TBHETS, RING, 40),
    line("2026-10-07", VOLTA, `${RING} Зас`, 3),
    line("2026-10-08", VOLTA, `${RING} Зас`, 2),
    line("2026-10-08", VOLTA, `${RING} Брак`, 1),
    line("2026-10-08", VOLTA, "Төмөр бетон цагираг Ф-1500", 9), // «1000» таарахгүй
    line("2026-10-08", VOLTA, RING, 100, "reclass"), // шилжүүлгийн мөр гарцад орохгүй
  ];
  const sales: SaleQty[] = [
    { day: "2026-10-10", item: RING, unit: "ш", qty: 50 },
    { day: "2026-10-20", item: RING, unit: "ш", qty: 28 },
    { day: "2026-10-20", item: `${RING} Брак`, unit: "ш", qty: 9 }, // брак борлуулалт «зарсан»-д ордоггүй
  ];
  const id = buildProductSearch({ ...base, lines }).products[0].id;
  const v = buildProductSearch({ ...base, lines, sales, stock: [{ item: RING, unit: "ш", qty: 116 }] });
  const card = v.products[0];

  it("нэг карт: үйлдвэрлэсэн 154, зарсан 78, агуулахад 116; Засвар 5, Брак 1 жижгээр", () => {
    expect(v.products).toHaveLength(1);
    expect(card).toMatchObject({ name: RING, unit: "ширхэг", produced: 154, sold: 78, stock: 116, repair: 5, defect: 1 });
  });
  it("цехээр: Вольтамикс 114, ТБХЭЦ 40 (том нь эхэнд)", () => {
    expect(card.workshops.map((w) => [w.short, w.qty])).toEqual([["Вольтамикс", 114], ["ТБХЭЦ", 40]]);
  });
  it("өдөр бүр: 10-06: 40, 10-07: 37, 10-08: 37, 10-09: 40 (шинэ нь дээр), зарсан өдрүүд нийлнэ", () => {
    const sel = buildProductSearch({ ...base, lines, sales, selected: id }).detail!;
    expect(sel.days.filter((d) => d.produced > 0).map((d) => [d.date, d.produced])).toEqual([["2026-10-09", 40], ["2026-10-08", 37], ["2026-10-07", 37], ["2026-10-06", 40]]);
    expect(sel.days.map((d) => d.date)).toEqual(["2026-10-20", "2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06"]);
    expect(sel.days.find((d) => d.date === "2026-10-20")).toMatchObject({ produced: 0, sold: 28 });
    expect(sel.days.find((d) => d.date === "2026-10-09")!.workshops).toEqual([{ short: "ТБХЭЦ", qty: 40 }]);
  });
  it("Зас, Брак нэр үндсэн бүтээгдэхүүндээ нэгдэнэ (нэг карт), 1500 орохгүй", () => {
    expect(buildProductSearch({ ...base, q: "цагираг", lines, sales }).products.map((p) => p.name).sort()).toEqual(["Төмөр бетон цагираг Ф-1000 Хүчитгэсэн", "Төмөр бетон цагираг Ф-1500"]);
  });
});

describe("хугацаа, 12 сар, эцсийн үлдэгдэл", () => {
  it("12 сар today-ийн сараар төгсөнө", () => {
    expect(last12Months("2026-11-25")).toEqual(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  });
  it("сонгосон хугацаанаас гадна ч 12 сарын хүснэгтэд орно; эцсийн үлдэгдэл одоогийн үлдэгдлээс буцааж тооцогдоно", () => {
    const lines = [line("2026-09-10", TBHETS, RING, 100), line("2026-10-10", TBHETS, RING, 50), line("2026-11-10", TBHETS, RING, 20)];
    const sales: SaleQty[] = [{ day: "2026-10-12", item: RING, unit: "ш", qty: 30 }, { day: "2026-11-12", item: RING, unit: "ш", qty: 5 }];
    const ringId = buildProductSearch({ ...base, lines }).products[0].id;
    const d = buildProductSearch({ ...base, from: "2026-11-01", to: "2026-11-30", lines, sales, stock: [{ item: RING, unit: "ш", qty: 200 }], selected: ringId })
      .detail!;
    const row = (m: string) => d.months.find((x) => x.month === m)!;
    expect(d.months).toHaveLength(12);
    expect(row("2026-11")).toMatchObject({ produced: 20, sold: 5, closing: 200 });
    expect(row("2026-10")).toMatchObject({ produced: 50, sold: 30, closing: 185 }); // 200 - 20 + 5
    expect(row("2026-09")).toMatchObject({ produced: 100, sold: 0, closing: 165 }); // 185 - 50 + 30
    expect(d.days.map((x) => x.date)).toEqual(["2026-11-12", "2026-11-10"]);
  });
  it("хугацааны бэлэн сонголтууд", () => {
    expect(periodRange("this", "2026-11-25")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("last", "2026-11-25")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("last", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("year", "2026-11-25")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("month", "2026-11-25", "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("хугацааны гаднах өдрийн гарц нэмэгдэхгүй", () => {
    const lines = [line("2026-09-30", TBHETS, RING, 10), line("2026-10-01", TBHETS, RING, 7), line("2026-11-01", TBHETS, RING, 3)];
    expect(buildProductSearch({ ...base, lines }).products[0].produced).toBe(7);
  });
});

describe("хайлтгүй үед: хамгийн их үйлдвэрлэсэн, зарсан 10", () => {
  const lines = Array.from({ length: 12 }, (_, i) => line("2026-10-05", TBHETS, `Бараа ${i + 1}`, (i + 1) * 10));
  const sales: SaleQty[] = Array.from({ length: 12 }, (_, i) => ({ day: "2026-10-06", item: `Бараа ${i + 1}`, unit: "ш", qty: 100 - i }));
  it("10 мөр, их нь эхэнд", () => {
    const v = buildProductSearch({ ...base, q: "", lines, sales });
    expect(v.products).toEqual([]);
    expect(v.top!.produced).toHaveLength(10);
    expect(v.top!.produced[0]).toMatchObject({ name: "Бараа 12", produced: 120 });
    expect(v.top!.sold[0]).toMatchObject({ name: "Бараа 1", sold: 100 });
    expect(v.top!.sold).toHaveLength(10);
  });
  it("зөвхөн ширхгээр эрэмбэлнэ: шоо метр, тонн өөр нэгжтэй харьцуулагдахгүй", () => {
    const v = buildProductSearch({ ...base, q: "", lines: [...lines, { ...line("2026-10-05", TBHETS, "Бетон зуурмаг", 9999), unit: "м3" }], sales: [] });
    expect(v.top!.produced.map((p) => p.name)).not.toContain("Бетон зуурмаг");
  });
});

describe("цехийн эрхтэй хэрэглэгч (showSales=false)", () => {
  it("зарсан, агуулахын тоо null, 12 сарын зарсан, үлдэгдэл null", () => {
    const lines = [line("2026-10-05", TBHETS, RING, 10)];
    const v = buildProductSearch({ ...base, lines, sales: [{ day: "2026-10-06", item: RING, unit: "ш", qty: 5 }], stock: [{ item: RING, unit: "ш", qty: 99 }], showSales: false, selected: buildProductSearch({ ...base, lines }).products[0].id });
    expect(v.products[0]).toMatchObject({ produced: 10, sold: null, stock: null });
    expect(v.detail!.months.every((m) => m.sold === null && m.closing === null)).toBe(true);
    expect(v.detail!.days.every((d) => d.sold === null)).toBe(true);
  });
});

describe("захирлын харагдацад хориотой үгс", () => {
  it("үр дүнгийн JSON-д данс, баримтын дугаар, нягтлангийн нэр томьёо байхгүй", () => {
    const lines = [line("2026-10-05", TBHETS, RING, 10), line("2026-10-05", TBHETS, `${RING} Брак`, 1), line("2026-10-05", "БАЗ-3", "Бетон", 5, "semi")];
    const json = JSON.stringify(buildProductSearch({ ...base, lines, sales: [{ day: "2026-10-06", item: RING, unit: "ш", qty: 5 }], stock: [{ item: RING, unit: "ш", qty: 9 }], selected: "x" }));
    for (const w of ["1441", "1С", "1C", "нягтлан", "Нягтлан", "хагас боловсруулсан", "Комментарий", "docNumber", "docRef"]) expect(json, w).not.toContain(w);
  });
});

describe("эцсийн үлдэгдэл: шилжүүлэг, батлагдаагүй баримт (1С-ийн үлдэгдэлтэй таарна)", () => {
  const DER = "Төмөр замын бетон дэр";
  const input = (extra: Partial<SearchInput>): SearchInput => ({ ...base, q: "дэр", from: "2026-10-01", to: "2026-10-31", lines: [], ...extra });
  const idOf = () => buildProductSearch(input({ lines: [line("2026-10-05", TBHETS, DER, 1)] })).products[0].id;
  const closing = (extra: Partial<SearchInput>, m: string) => buildProductSearch(input({ ...extra, selected: idOf() })).detail!.months.find((x) => x.month === m)!.closing;

  it("бракаас/засвараас бэлэн болгосон (+), бэлнээс брак болгосон (-), өөр бүтээгдэхүүнээс шилжүүлсэн (+/-) нь буцаан тооцоонд орно", () => {
    const moves: ProdLine[] = [
      line("2026-11-01", TBHETS, DER, 2113, "defect_to_ready"),
      line("2026-11-01", TBHETS, DER, 141, "repair_to_ready"),
      line("2026-11-20", TBHETS, DER, 78, "swap_in"),
      line("2026-11-21", TBHETS, DER, 10, "swap_out"),
      line("2026-11-22", TBHETS, `${DER} Брак`, 5, "reclass"),
    ];
    const stock = [{ item: DER, unit: "ш", qty: 160 }];
    const sales: SaleQty[] = [{ day: "2026-11-05", item: DER, unit: "ш", qty: 9027 }];
    // 2026-11: өмнөх сарын эцэс = 160 - 0 (үйлдвэрлэл) + 9027 (зарсан) - (2113 + 141 + 78 - 10 - 5)
    expect(closing({ stock, sales, moves }, "2026-10")).toBe(160 + 9027 - (2113 + 141 + 78 - 10 - 5));
    expect(closing({ stock, sales }, "2026-10")).toBe(160 + 9027); // шилжүүлэггүй бол зөрнө
  });
  it("шилжүүлгийн мөр гарц, нийт, өдөр бүрийн үйлдвэрлэсэнд ордоггүй", () => {
    const v = buildProductSearch(input({ lines: [line("2026-10-05", TBHETS, DER, 10)], moves: [line("2026-10-06", TBHETS, DER, 500, "swap_in"), line("2026-10-06", TBHETS, DER, 7, "defect_to_ready")], selected: idOf() }));
    expect(v.products[0].produced).toBe(10);
    expect(v.detail!.days.map((d) => d.date)).toEqual(["2026-10-05"]);
  });
  it("батлагдаагүй баримт «үйлдвэрлэсэн»-д орно, харин эцсийн үлдэгдлийн тооцоонд ордоггүй", () => {
    const lines: ProdLine[] = [line("2026-11-10", TBHETS, DER, 100), { ...line("2026-11-11", TBHETS, DER, 30), posted: false }];
    const v = buildProductSearch(input({ from: "2026-11-01", to: "2026-11-30", lines, stock: [{ item: DER, unit: "ш", qty: 500 }], selected: idOf() }));
    expect(v.products[0].produced).toBe(130);
    expect(v.detail!.months.find((m) => m.month === "2026-10")!.closing).toBe(400); // 500 - 100 (зөвхөн батлагдсан)
  });
});
