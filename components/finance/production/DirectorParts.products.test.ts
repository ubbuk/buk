import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DirectorCard, ProductCats, SimpleProduct } from "@/lib/onec/production-view";
import { CatProductLines, MAX_STACK, MonthProgress, ProductLegend, productColorNames, OTHER_COLOR, PRODUCT_COLORS, WorkshopCards, productDefectPct, productStackBars, productSummary, productTotals, shortUnit, singleProductBars, topProductNames, typesText, type ProductSeriesPoint } from "./DirectorParts";

// Өөр өөр бүтээгдэхүүний ширхгийг НЭМЖ харуулахгүй: нэг бүтээгдэхүүн бол тоо, олон бол жагсаалт («4 төрлийн бүтээдэхүүн»)

const p = (name: string, qty: number, unit = "ш", extra: Partial<SimpleProduct> = {}): SimpleProduct => ({ name, qty, unit, ...extra });
const card = (name: string, products: SimpleProduct[], monthProducts: SimpleProduct[] = products): DirectorCard => ({
  name,
  concrete: false,
  day: products.length ? [{ unit: "ширхэг", qty: products.reduce((s, x) => s + x.qty, 0) }] : [],
  products,
  top: products[0] ?? null,
  lastDay: "2098-04-09",
  month: [],
  monthProducts,
  unit: "ширхэг",
  monthQty: 0,
  monthDays: [],
  dayCats: null,
  monthCats: null,
  defectPct: null,
  monthDefectPct: null,
  lateDefectDay: 0,
  lateDefectMonth: 0,
  monthDaysCats: [],
  monthDaysProducts: [],
  convDay: { fromDefect: 0, fromRepair: 0, products: [] },
  convMonth: { fromDefect: 0, fromRepair: 0, products: [] },
  convDays: [],
});
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("productSummary", () => {
  it("хоосон / нэг / олон; олон бол эхний 3 (их нь эхэнд) ба «+N бусад»-ын тоо", () => {
    expect(productSummary([])).toEqual({ kind: "none" });
    expect(productSummary([p("Шон 80*80", 715)])).toEqual({ kind: "single", product: p("Шон 80*80", 715) });
    const s = productSummary([p("A", 1), p("B", 4), p("C", 2), p("D", 3), p("E", 5)]);
    expect(s).toMatchObject({ kind: "many", count: 5, more: 2 });
    expect(s.kind === "many" && s.shown.map((x) => x.name)).toEqual(["E", "B", "D"]);
  });
  it("нэгж, төрлийн үг", () => {
    expect(shortUnit("ш")).toBe("ш");
    expect(shortUnit("ширхэг")).toBe("ш");
    expect(shortUnit("м3")).toBe("м³");
    expect(typesText(4)).toBe("4 төрлийн бүтээгдэхүүн");
  });
});

describe("цехийн карт", () => {
  it("нэг бүтээгдэхүүн: том тоо + нэгж + нэр («Шон 80*80 — 715 ш»)", () => {
    const o = html(createElement(WorkshopCards, { cards: [card("Тенсиланд хэсэг", [p("Шон 80*80", 715)])], day: "2098-04-09" }));
    expect(o).toContain(">715<");
    expect(o).toContain(">ш<");
    expect(o).toContain("Шон 80*80");
    expect(o).not.toContain("+");
  });
  it("олон бүтээгдэхүүн: эхний 3 мөр мөрөөр + «+2 бусад», тоонуудыг НЭМЭХГҮЙ (нийлбэр байхгүй)", () => {
    const products = [p("БУЗ суваг Н-910", 17), p("БУЗ суваг Н-710", 10), p("Лотки", 5), p("Таг", 2), p("L panel", 1)];
    const o = html(createElement(WorkshopCards, { cards: [card("Төмөр бетон хийц эдлэлийн цех", products)], day: "2098-04-09" }));
    for (const n of ["БУЗ суваг Н-910", "БУЗ суваг Н-710", "Лотки"]) expect(o).toContain(n);
    expect(o).not.toContain("Таг");
    expect(o).toContain("+2 бусад");
    expect(o).not.toContain(">35<"); // 17 + 10 + 5 + 2 + 1 = 35: нэмсэн нийлбэр харагдахгүй
    expect(o).toContain("17 <span");
  });
  it("бетон хийцийн нэг бүтээгдэхүүн: брак хувь бүтээгдэхүүнийх (брак / (бэлэн + засвар + брак))", () => {
    const o = html(createElement(WorkshopCards, { cards: [card("Бетон дэрний хэсэг", [p("Дэр", 95, "ш", { repair: 3, defect: 2 })])], day: "2098-04-09" }));
    expect(o).toContain("Брак 2%");
    expect(productDefectPct({ qty: 95, repair: 3, defect: 2 })).toBe(2);
    expect(productDefectPct({ qty: 10 })).toBeNull();
  });
  it("мэдээгүй цех: «Мэдээ ороогүй»", () => {
    expect(html(createElement(WorkshopCards, { cards: [card("Металл хийц", [])], day: "2098-04-09" }))).toContain("Мэдээ ороогүй");
  });
});

describe("«нийт явц» мөр", () => {
  it("нэг бүтээгдэхүүн бол тэр, олон бол гол бүтээгдэхүүн + «N төрөл» (нийлбэр биш)", () => {
    const one = card("Тенсиланд хэсэг", [], [p("Шон 80*80", 4996)]);
    const many = card("Төмөр бетон хийц эдлэлийн цех", [], [p("БУЗ суваг Н-910", 17), p("L panel", 1), p("Лотки", 4), p("Таг", 13)]);
    const o = html(createElement(MonthProgress, { cards: [one, many], month: "2098-04", day: "2098-04-09" }));
    expect(o).toContain("4,996 ш");
    expect(o).toContain("17 ш");
    expect(o).toContain("БУЗ суваг Н-910");
    expect(o).toContain("4 төрөл");
    expect(o).not.toContain("35 ш"); // 17 + 1 + 4 + 13 нэмэгдээгүй
  });
});

describe("жагсаалтад брак хувь бүтээгдэхүүн бүрээр", () => {
  it("Брак баганад тоо ба хувь", () => {
    const o = html(createElement(CatProductLines, { products: [p("Дэр", 95, "ш", { repair: 3, defect: 2 }), p("Шон", 50, "ш", { repair: 0, defect: 0 })] }));
    expect(o).toContain(">2%<");
    expect(o.match(/\d%/g)).toHaveLength(1); // брак байхгүй бүтээгдэхүүнд хувь гарахгүй
  });
});

const items = (...xs: [string, number, number?, number?][]): ProductCats[] => xs.map(([name, ready, repair = 0, defect = 0]) => ({ name, unit: "ш", ready, repair, defect }));
const series: ProductSeriesPoint[] = [
  { key: "2098-04-01", label: "1", when: "4-р сарын 1", items: items(["A", 10], ["B", 5], ["C", 1]) },
  { key: "2098-04-02", label: "2", when: "4-р сарын 2", items: items(["A", 20, 2, 1], ["D", 4], ["E", 3], ["F", 2], ["G", 1]) },
  { key: "2098-04-03", label: "3", when: "4-р сарын 3", items: [] },
];

describe("график: бүтээгдэхүүнээр давхарласан", () => {
  it("хамгийн их бүтээгдэхүүн 5 нэр, үлдсэн нь «Бусад» (өөр өнгө)", () => {
    const names = topProductNames(series);
    expect(names).toHaveLength(MAX_STACK);
    expect(names.slice(0, 2)).toEqual(["A", "B"]);
    const bars = productStackBars(series, names, "ш");
    const d2 = bars[1];
    expect(d2.parts!.at(-1)).toEqual({ value: 1 + 0, color: OTHER_COLOR }); // G (6 дахь) нь «Бусад»
    expect(d2.parts!.slice(0, 5).map((x) => x.color)).toEqual([...PRODUCT_COLORS]);
    expect(d2.value).toBe(22 + 4 + 3 + 2 + 1);
  });
  it("5 ба түүнээс цөөн бүтээгдэхүүн бол «Бусад» хэсэг байхгүй; мэдээгүй өдөр 0", () => {
    const bars = productStackBars(series.slice(0, 1), ["A", "B", "C"], "ш");
    expect(bars[0].parts).toHaveLength(3);
    expect(productStackBars(series, topProductNames(series), "ш")[2].value).toBe(0);
  });
  it("tooltip-д бүтээгдэхүүн бүрийн тоо, нэр", () => {
    expect(productStackBars(series, topProductNames(series), "ш")[0].title).toBe("4-р сарын 1: A 10, B 5, C 1 ш");
  });
  it("сонгосон бүтээгдэхүүн: бетон хийцэд Бэлэн/Засвар/Брак давхарласан, бусад цехэд нэг өнгө", () => {
    const c = singleProductBars(series, "A", true, "ш");
    expect(c[1].parts!.map((x) => x.value)).toEqual([20, 2, 1]);
    expect(c[1].value).toBe(23);
    const n = singleProductBars(series, "A", false, "ш");
    expect(n[1].parts).toBeUndefined();
    expect(n[1].value).toBe(20);
    expect(singleProductBars(series, "Z", true, "ш").every((b) => b.value === 0)).toBe(true);
  });
  it("сонгосон бүтээгдэхүүний нийлбэр (12 сарын брак хувь)", () => {
    expect(productTotals(series, "A")).toEqual({ ready: 30, repair: 2, defect: 1 });
    expect(productDefectPct({ qty: 30, repair: 2, defect: 1 })).toBe(3); // 1 / 33
  });
  it("тайлбар: «Бүгд», бүтээгдэхүүн бүр (өнгөтэй), 5-аас олон бол «Бусад»", () => {
    const o = html(createElement(ProductLegend, { names: ["A", "B"], hasOther: true, selected: "A", onSelect: () => {} }));
    expect(o).toContain("Бүгд");
    expect(o).toContain("Бусад");
    expect(o).toContain(PRODUCT_COLORS[0]);
    expect(o).toContain('aria-pressed="true"');
    expect(html(createElement(ProductLegend, { names: ["A"], hasOther: false, selected: null, onSelect: () => {} }))).not.toContain("Бусад");
  });
});

describe("хуудсууд: нийт тоо байхгүй, жагсаалт графикийн дээр", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  it("үндсэн хуудас, компонентод «Тэр өдөр нийт үйлдвэрлэсэн» мөр байхгүй", () => {
    for (const f of ["app/(app)/finance/production/page.tsx", "components/finance/production/DirectorParts.tsx"]) {
      expect(read(f), f).not.toContain("Тэр өдөр нийт");
      expect(read(f), f).not.toContain("TotalLine");
    }
  });
  it("цехийн хуудас: «N төрлийн бүтээгдэхүүн» гарчиг, бүтээгдэхүүний жагсаалт нь өдрийн графикээс ӨМНӨ", () => {
    const src = read("app/(app)/finance/production/[workshop]/page.tsx");
    expect(src).toContain("typesText(");
    const list = src.indexOf("<CatProductLines products={card.monthProducts}");
    const chart = src.indexOf("<Bars items={dayItems}");
    expect(list).toBeGreaterThan(-1);
    expect(chart).toBeGreaterThan(list);
    expect(src).not.toContain("бэлэн <span"); // «бэлэн 35 ширхэг» нийлбэр гарчиг байхгүй
  });
});

describe("тогтмол өнгө: нэг бүтээгдэхүүн хоёр графикт ижил өнгөтэй", () => {
  const monthList = [{ name: "B" }, { name: "A" }, { name: "C" }];
  // 12 сарын цуваанд өөр бүтээгдэхүүн (Z) ихтэй: өмнөх логикоор тэр эхний өнгийг авах байсан
  const months: ProductSeriesPoint[] = [
    { key: "2098-03", label: "3", when: "3-р сар", items: items(["Z", 500], ["A", 1]) },
    { key: "2098-04", label: "4", when: "4-р сар", items: items(["B", 40], ["A", 20], ["C", 5], ["Z", 100]) },
  ];
  const days: ProductSeriesPoint[] = [{ key: "2098-04-02", label: "2", when: "4-р сарын 2", items: items(["A", 3], ["B", 9], ["C", 1]) }];

  it("сарын жагсаалтын эрэмбээр эхэлж, дутвал цувааны нийлбэрээр нөхнө (5 хүртэл)", () => {
    expect(productColorNames(monthList, [...days, ...months])).toEqual(["B", "A", "C", "Z"]);
    const many = ["a", "b", "c", "d", "e", "f"].map((name) => ({ name }));
    expect(productColorNames(many, [])).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("өдөр, сарын график ижил жагсаалтаар: A өдөр ч, сар ч ижил өнгөтэй", () => {
    const names = productColorNames(monthList, [...days, ...months]);
    const color = (bars: ReturnType<typeof productStackBars>, i: number, idx: number) => bars[i].parts![idx].color;
    const d = productStackBars(days, names, "ш");
    const m = productStackBars(months, names, "ш");
    const iA = names.indexOf("A");
    expect(color(d, 0, iA)).toBe(PRODUCT_COLORS[iA]);
    expect(color(m, 1, iA)).toBe(PRODUCT_COLORS[iA]);
    expect(d[0].parts![iA].value).toBe(3);
    expect(m[1].parts![iA].value).toBe(20);
    expect(color(d, 0, names.indexOf("B"))).toBe(color(m, 1, names.indexOf("B")));
  });
  it("жагсаалтад ороогүй (6 дахь) бүтээгдэхүүн хоёр графикт «Бусад»", () => {
    const names = productColorNames([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }], []);
    const s: ProductSeriesPoint[] = [{ key: "k", label: "1", when: "x", items: items(["a", 1], ["f", 7]) }];
    expect(productStackBars(s, names, "ш")[0].parts!.at(-1)).toEqual({ value: 7, color: OTHER_COLOR });
  });
  it("сонгосон бүтээгдэхүүн: бетон бус цехэд ч өөрийн тогтмол өнгөөр, хоёр графикт ижил", () => {
    const names = productColorNames(monthList, [...days, ...months]);
    const color = PRODUCT_COLORS[names.indexOf("A")];
    expect(singleProductBars(days, "A", false, "ш", color)[0].parts).toEqual([{ value: 3, color }]);
    expect(singleProductBars(months, "A", false, "ш", color)[1].parts).toEqual([{ value: 20, color }]);
    expect(singleProductBars(days, "A", false, "ш")[0].parts).toBeUndefined();
  });
  it("тайлбар: зөвхөн тухайн графикт байгаа бүтээгдэхүүн, өнгө нь жагсаалтын индексээр (хоёр графикт ижил)", () => {
    const names = ["B", "A", "C", "Z"];
    const o = html(createElement(ProductLegend, { names, present: new Set(["A", "C"]), hasOther: false, selected: null, onSelect: () => {} }));
    expect(o).not.toContain(">B<");
    expect(o).toContain(`background:${PRODUCT_COLORS[1]}`); // A = 2 дахь өнгө, B байхгүй ч
    expect(o).toContain(`background:${PRODUCT_COLORS[2]}`); // C
    expect(o).not.toContain(`background:${PRODUCT_COLORS[0]}`);
  });
  it("цехийн хуудас: өнгийг нэг жагсаалтаас (productColorNames) хоёр графикт өгдөг", () => {
    const src = readFileSync(path.resolve(__dirname, "../../..", "app/(app)/finance/production/[workshop]/page.tsx"), "utf8");
    expect(src).toContain("productColorNames(");
    expect(src).toContain("productStackBars(daysSeries, colorNames, unit)");
    expect(src).toContain("productStackBars(monthsSeries, colorNames, unit)");
    expect(src).not.toContain("topProductNames(");
  });
});
