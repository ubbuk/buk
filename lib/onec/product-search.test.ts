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
    expect(v.top!.soldByQty[0]).toMatchObject({ name: "Бараа 1", sold: 100 });
    expect(v.top!.soldByQty).toHaveLength(10);
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

describe("агуулахаар задаргаа (Ф-1000, 2026-10: нягтлангийн карт Вольтамикс 114, нийт 116)", () => {
  const VOLTA_WH = "Вольтамискын агуулах";
  const YARD_WH = "Гадаа талбайн бэлэн бүтээгдэхүүний агуулах";
  const stock = [
    { item: RING, unit: "ш", qty: 114, warehouse: VOLTA_WH },
    { item: RING, unit: "ш", qty: 2, warehouse: YARD_WH },
  ];
  it("нийт нь бүх агуулахын нийлбэр (116), задаргаа нь агуулах бүр (их нь эхэнд, «агуулах» гэдэг үггүй)", () => {
    const c = buildProductSearch({ ...base, lines: [line("2026-10-06", VOLTA, RING, 154)], stock }).products[0];
    expect(c.stock).toBe(116);
    expect(c.warehouses).toEqual([{ name: "Вольтамискын", qty: 114 }, { name: "Гадаа талбайн бэлэн бүтээгдэхүүний", qty: 2 }]);
  });
  it("нэг агуулах, 0 үлдэгдэлтэй агуулах бол задаргаа гарахгүй; агуулахын нэргүй мөр нийтэд орно", () => {
    const one = buildProductSearch({ ...base, lines: [line("2026-10-06", VOLTA, RING, 1)], stock: [stock[0], { item: RING, unit: "ш", qty: 0, warehouse: YARD_WH }] }).products[0];
    expect(one.warehouses).toEqual([]);
    expect(one.stock).toBe(114);
    expect(buildProductSearch({ ...base, lines: [line("2026-10-06", VOLTA, RING, 1)], stock: [{ item: RING, unit: "ш", qty: 5 }] }).products[0]).toMatchObject({ stock: 5, warehouses: [] });
  });
  it("цехийн эрхтэй хэрэглэгчид агуулахын задаргаа ирэхгүй", () => {
    expect(buildProductSearch({ ...base, lines: [line("2026-10-06", VOLTA, RING, 1)], stock, showSales: false }).products[0]).toMatchObject({ stock: null, warehouses: [] });
  });
});

describe("«Зарсан 10»: борлуулалтын ДҮНгээр (₮, НӨАТ-гүй), нэгж харгалзахгүй", () => {
  const sale = (item: string, unit: string, qty: number, amount: number, day = "2026-10-06"): SaleQty => ({ day, item, unit, qty, amount });
  const sales: SaleQty[] = [
    sale("Төмөр замын бетон дэр", "ш", 30_370, 8_425_510_909),
    sale("Элс-угаасан (0-5)", "м3", 706.4, 16_054_545), // шоо метр: ширхэгтэй хамт дүнгээр эрэмбэлэгдэнэ
    sale("Хаягдал төмрийн үнэ", "тн", 113_350, 32_009_545),
    sale("L panel", "ш", 5, 94_690_909),
    sale("Төмөр бетон цагираг Ф-1000 Хүчитгэсэн", "ш", 78, 33_610_909.09),
    sale("Төмөр бетон цагираг Ф-1000 Хүчитгэсэн", "ш", -3, -1_000_000, "2026-10-20"), // буцаалт: дүн, тоо хасагдана
    sale("Төмөр бетон цагираг Ф-1000 Хүчитгэсэн Брак", "ш", 9, 999_999_999), // брак хувилбар: үндсэн бүтээгдэхүүнд орохгүй
    sale("Өөр сарын бараа", "ш", 1, 777, "2026-09-30"), // хугацааны гадна
  ];
  const v = buildProductSearch({ ...base, q: "", lines: [], sales });
  it("дүнгээр буурахаар; м³, тонн ч орно; үндсэн бүтээгдэхүүн бүрд нэг мөр (буцаалт хасагдсан)", () => {
    expect(v.top!.soldByAmount.map((c) => [c.name, c.soldAmount])).toEqual([
      ["Төмөр замын бетон дэр", 8_425_510_909],
      ["Төмөр бетон цагираг Ф-1000 Хүчитгэсэн", 32_610_909.09],
      ["Хаягдал төмрийн үнэ", 32_009_545],
      ["L panel", 94_690_909 > 32_610_909.09 ? 94_690_909 : 0],
      ["Элс-угаасан (0-5)", 16_054_545],
    ].sort((a, b) => (b[1] as number) - (a[1] as number)));
  });
  it("мөр бүр: нэр, дүн, тоо хэмжээ ба нэгж (9,027 ш гэх мэт)", () => {
    const sand = v.top!.soldByAmount.find((c) => c.name.startsWith("Элс"))!;
    expect(sand).toMatchObject({ sold: 706.4, soldAmount: 16_054_545, unit: "шоо метр" });
    const ring = v.top!.soldByAmount.find((c) => c.name.includes("Ф-1000"))!;
    expect(ring).toMatchObject({ sold: 75, soldAmount: 32_610_909.09 });
  });
  it("«Тоогоор» жагсаалт хэвээр: зөвхөн ширхэг, тоо хэмжээгээр", () => {
    expect(v.top!.soldByQty.map((c) => c.name)).toEqual(["Төмөр замын бетон дэр", "Төмөр бетон цагираг Ф-1000 Хүчитгэсэн", "L panel"]);
    expect(v.top!.soldByQty[0].sold).toBe(30_370);
  });
  it("10 хүртэл мөр; хугацааны гадна, 0 дүнтэй бараа орохгүй", () => {
    const many: SaleQty[] = Array.from({ length: 14 }, (_, i) => sale(`Бараа ${i + 1}`, i % 2 ? "тн" : "ш", 1, (i + 1) * 100));
    const m = buildProductSearch({ ...base, q: "", lines: [], sales: [...many, sale("Үнэгүй", "ш", 3, 0)] });
    expect(m.top!.soldByAmount).toHaveLength(10);
    expect(m.top!.soldByAmount[0].name).toBe("Бараа 14");
    expect(m.top!.soldByAmount.map((c) => c.name)).not.toContain("Үнэгүй");
    expect(v.top!.soldByAmount.map((c) => c.name)).not.toContain("Өөр сарын бараа");
  });
  it("карт: soldAmount бодит дүн; цехийн эрхтэй хэрэглэгчид null (ирэхгүй)", () => {
    const s = buildProductSearch({ ...base, q: "ф-1000 хүчитгэсэн", lines: [], sales });
    expect(s.products[0]).toMatchObject({ sold: 75, soldAmount: 32_610_909.09 });
    const hidden = buildProductSearch({ ...base, q: "", lines: [], sales, showSales: false });
    expect(hidden.top!.soldByAmount).toEqual([]);
    expect(hidden.top!.soldByQty).toEqual([]);
    expect(JSON.stringify(hidden)).not.toContain("8425510909");
    expect(buildProductSearch({ ...base, q: "дэр", lines: [line("2026-10-05", TBHETS, "Төмөр замын бетон дэр", 10)], sales, showSales: false }).products[0].soldAmount).toBeNull();
  });
  it("дүн байхгүй (хуучин мөр) бол 0 гэж тооцно", () => {
    const old = buildProductSearch({ ...base, q: "", lines: [], sales: [{ day: "2026-10-06", item: "Х", unit: "ш", qty: 5 }] });
    expect(old.top!.soldByAmount).toEqual([]);
    expect(old.top!.soldByQty[0].sold).toBe(5);
  });
});
