import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProductCard, ProductDetail } from "@/lib/onec/product-search";
import { shortUnit } from "./ProductParts";
import { PeriodBar, ProductCardView, ProductDetailView, SoldTopList, TopList, periodLabel, soldVariantText } from "./ProductParts";

const card: ProductCard = {
  id: "x|ширхэг",
  name: "Төмөр бетон цагираг Ф-1000 Хүчитгэсэн",
  unit: "ширхэг",
  produced: 154,
  repair: 7,
  defect: 1,
  sold: 78,
  soldAmount: 33_610_909.09,
  soldDefect: null,
  soldRepair: null,
  stock: 1234,
  warehouses: [
    { name: "Вольтамискын", qty: 1232 },
    { name: "Гадаа талбайн бэлэн бүтээгдэхүүний", qty: 2 },
  ],
  workshops: [
    { name: "Вольтамиксийн хэсэг", short: "Вольтамикс", slug: "voltamix", qty: 114 },
    { name: "Төмөр бетон хийц эдлэлийн цех", short: "ТБХЭЦ", slug: "tbhets", qty: 40 },
  ],
};
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("ProductCardView", () => {
  const out = html(createElement(ProductCardView, { card, period: "Энэ сар", open: false, onToggle: () => {} }));
  it("нэр · хугацаа; Үйлдвэрлэсэн | Зарсан | Агуулахад одоо; мянгатын таслал, нэгж", () => {
    expect(out).toContain("Төмөр бетон цагираг Ф-1000 Хүчитгэсэн");
    expect(out).toContain("· Энэ сар");
    for (const t of ["Үйлдвэрлэсэн", "Зарсан", "Агуулахад одоо"]) expect(out).toContain(t);
    expect(out).toContain(">154<");
    expect(out).toContain(">78<");
    expect(out).toContain(">1,234<");
    expect(out).toContain(">ш<");
  });
  it("жижгээр «Брак 1 · Засвар 7» (>0 үед), «Хийсэн: Вольтамикс 114, ТБХЭЦ 40»", () => {
    expect(out).toContain("Брак 1 · Засвар 7");
    expect(out).toContain("Хийсэн: Вольтамикс 114, ТБХЭЦ 40");
  });
  it("олон агуулахад байвал «Агуулахад: Вольтамискын 1,232, Гадаа талбайн бэлэн бүтээгдэхүүний 2» задаргаа; нэг агуулахад задаргаа гарахгүй", () => {
    expect(out).toContain("Агуулахад: Вольтамискын 1,232, Гадаа талбайн бэлэн бүтээгдэхүүний 2");
    const one = html(createElement(ProductCardView, { card: { ...card, warehouses: [] }, period: "Энэ сар", open: false, onToggle: () => {} }));
    expect(one).not.toContain("Агуулахад:");
  });
  it("брак, засвар 0 бол жижиг мөр гарахгүй; зарсан null (цехийн эрх) бол «—»", () => {
    const o = html(createElement(ProductCardView, { card: { ...card, repair: 0, defect: 0, sold: null, soldAmount: null, soldDefect: null, soldRepair: null, stock: null, warehouses: [] }, period: "Энэ сар", open: false, onToggle: () => {} }));
    expect(o).not.toContain("Брак");
    expect(o).not.toContain("Засвар");
    expect(o).toContain(">—<");
  });
});

describe("TopList, PeriodBar, нэгж", () => {
  it("TopList: мөр бүр товч, эрэмбийн дугаартай", () => {
    const o = html(createElement(TopList, { title: "Энэ сар хамгийн их үйлдвэрлэсэн 10", items: [card], kind: "produced", onPick: () => {} }));
    expect(o).toContain("Энэ сар хамгийн их үйлдвэрлэсэн 10");
    expect(o).toContain("<button");
    expect(o).toContain(">154<");
  });
  it("PeriodBar: Энэ сар / Өнгөрсөн сар / Энэ жил / Сар сонгох", () => {
    const o = html(createElement(PeriodBar, { active: "this", month: "2026-11", today: "2026-11-25", onPreset: () => {}, onMonth: () => {} }));
    for (const t of ["Энэ сар", "Өнгөрсөн сар", "Энэ жил", "Сар сонгох"]) expect(o).toContain(t);
    expect(o).toContain('aria-pressed="true"');
  });
  it("хугацааны нэр, богино нэгж", () => {
    expect(periodLabel("last", "2026-10-01", "2026-10-31")).toBe("Өнгөрсөн сар");
    expect(periodLabel("month", "2026-10-01", "2026-10-31")).toBe("2026 оны 10-р сар");
    expect(shortUnit("ширхэг")).toBe("ш");
    expect(shortUnit("шоо метр")).toBe("м³");
    expect(shortUnit("боодол")).toBe("боодол");
  });
});

describe("ProductDetailView", () => {
  const detail: ProductDetail = {
    id: "x|ширхэг",
    name: card.name,
    unit: "ширхэг",
    days: [
      { date: "2026-10-09", produced: 40, sold: 0, workshops: [{ short: "ТБХЭЦ", qty: 40 }] },
      { date: "2026-10-05", produced: 0, sold: 40, workshops: [] },
    ],
    months: Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(12).padStart(2, "0")}`.replace("2025-12", i === 0 ? "2025-12" : `2026-${String(i).padStart(2, "0")}`), produced: i * 10, sold: i * 5, closing: 100 + i })),
  };
  const out = html(createElement(ProductDetailView, { detail, from: "2026-10-01", to: "2026-10-31", today: "2026-11-25", showSales: true, onMonth: () => {} }));
  it("«Өдөр бүрээр»: «10-р сарын 9, Баасан» — үйлдвэрлэсэн 40 ш; зөвхөн хөдөлгөөнтэй өдөр", () => {
    expect(out).toContain("Өдөр бүрээр");
    expect(out).toContain("10-р сарын 9, Баасан");
    expect(out).toContain("үйлдвэрлэсэн 40 ш");
    expect(out).toContain("зарсан 40 ш");
    expect(out).not.toContain('<span class="text-text">10-р сарын 8,'); // жагсаалтад хөдөлгөөнгүй өдөр байхгүй (графикийн tooltip-д байж болно)
  });
  it("«Сүүлийн 12 сар»: хүснэгт (Үйлдвэрлэсэн, Зарсан, Эцэст үлдсэн), 12 мөр", () => {
    expect(out).toContain("Сүүлийн 12 сар");
    for (const t of ["Үйлдвэрлэсэн", "Зарсан", "Эцэст үлдсэн"]) expect(out).toContain(t);
    expect(out.match(/<li><button type="button" class="focus-ring grid/g)).toHaveLength(12);
  });
  it("зарсан харагдахгүй (цехийн эрх) бол зарсан, үлдэгдлийн багана байхгүй", () => {
    const o = html(createElement(ProductDetailView, { detail: { ...detail, days: [detail.days[0]] }, from: "2026-10-01", to: "2026-10-31", today: "2026-11-25", showSales: false, onMonth: () => {} }));
    expect(o).not.toContain("зарсан");
    expect(o).not.toContain("Эцэст үлдсэн");
  });
});

describe("захирлын харагдацад хориотой үгс (UI-ийн эх)", () => {
  const root = path.resolve(__dirname, "../../..");
  const files = ["components/finance/products/ProductParts.tsx", "app/(app)/finance/products/page.tsx", "app/api/dashboard/products/route.ts", "lib/onec/product-search.ts"];
  it.each(files)("%s: данс, баримтын дугаар, нягтлангийн нэр томьёо хэрэглэгчид харагдах текстэд байхгүй", (f) => {
    const src = readFileSync(path.join(root, f), "utf8");
    // зөвхөн хэрэглэгчид харагдах мөр: тайлбар (// ба /* */) хасна
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
    for (const w of ["1441", "1С", "Нягтлан", "нягтлан", "хагас боловсруулсан", "Комментарий", "docNumber"]) expect(code, `${f}: ${w}`).not.toContain(w);
  });
  it("«Бүтээгдэхүүн» таб бусад табын ЭХЭНД байна", () => {
    const tabs = readFileSync(path.join(root, "components/finance/FinanceTabs.tsx"), "utf8");
    expect(tabs).toMatch(/const ORDER = \["products", "stock",/);
  });
});

describe("SoldTopList: «Дүнгээр | Тоогоор» сэлгэгч", () => {
  const sand: ProductCard = { ...card, id: "s", name: "Элс-угаасан (0-5)", unit: "шоо метр", sold: 706.4, soldAmount: 16_054_545, produced: 0, repair: 0, defect: 0, warehouses: [], workshops: [] };
  const der: ProductCard = { ...card, id: "d", name: "Төмөр замын бетон дэр", unit: "ширхэг", sold: 9027, soldAmount: 8_425_510_909, warehouses: [], workshops: [] };
  const render = (sort: "amount" | "qty") => html(createElement(SoldTopList, { title: "Энэ сар хамгийн их зарсан 10", byAmount: [der, sand], byQty: [der], sort, onSort: () => {}, onPick: () => {} }));
  it("анхдагч дүнгээр: нэр, дүн (сая₮/тэрбум₮) том, доор жижгээр тоо хэмжээ ба нэгж; м³ бараа ч орно", () => {
    const o = render("amount");
    expect(o).toContain("Энэ сар хамгийн их зарсан 10");
    expect(o).toContain("8.43 тэрбум₮");
    expect(o).toContain("9,027 ш");
    expect(o).toContain("Элс-угаасан (0-5)");
    expect(o).toContain("16.1 сая₮");
    expect(o).toContain("706 м³");
    expect(o.indexOf("8.43 тэрбум₮")).toBeLessThan(o.indexOf("16.1 сая₮"));
  });
  it("сэлгэгч: Дүнгээр (идэвхтэй), Тоогоор; тоогоор үед том нь тоо, жижиг нь дүн; м³ бараа гарахгүй (зөвхөн ширхэгээр)", () => {
    const a = render("amount");
    expect(a).toMatch(/aria-pressed="true"[^>]*>Дүнгээр/);
    expect(a).toMatch(/aria-pressed="false"[^>]*>Тоогоор/);
    const q = render("qty");
    expect(q).toMatch(/aria-pressed="true"[^>]*>Тоогоор/);
    expect(q).toContain("9,027 ш");
    expect(q).toContain("8.43 тэрбум₮");
    expect(q).not.toContain("Элс-угаасан");
  });
  it("хоосон жагсаалт: «Мэдээ ороогүй»", () => {
    expect(html(createElement(SoldTopList, { title: "t", byAmount: [], byQty: [], sort: "amount", onSort: () => {}, onPick: () => {} }))).toContain("Мэдээ ороогүй");
  });
  it("хуудас: анхдагч «Дүнгээр», ?sort=qty-ээр хуваалцаж болно", () => {
    const src = readFileSync(path.resolve(__dirname, "../../..", "app/(app)/finance/products/page.tsx"), "utf8");
    expect(src).toContain('sp.get("sort") === "qty" ? "qty" : "amount"');
    expect(src).toContain('params.set("sort", "qty")');
    expect(src).toContain("<SoldTopList");
  });
});

describe("Брак, Засвар зарсан: үндсэн тоонд нэмэгдэхгүй, жижгээр тусад нь", () => {
  it("soldVariantText: «Брак зарсан: 120 ш · 14.2 сая₮»; 0 эсвэл сөрөг бол хоосон", () => {
    expect(soldVariantText("Брак", { qty: 120, amount: 14_200_000 }, "ширхэг")).toBe("Брак зарсан: 120 ш · 14.2 сая₮");
    expect(soldVariantText("Засвар", { qty: 3, amount: 450_000 }, "ш")).toBe("Засвар зарсан: 3 ш · 450.0 мянга₮");
    expect(soldVariantText("Брак", { qty: 0, amount: 0 }, "ш")).toBe("");
    expect(soldVariantText("Брак", { qty: -2, amount: -100 }, "ш")).toBe("");
    expect(soldVariantText("Брак", null, "ш")).toBe("");
  });
  it("картанд жижиг мөр, үндсэн «Зарсан» тоо өөрчлөгдөхгүй", () => {
    const o = html(createElement(ProductCardView, { card: { ...card, soldDefect: { qty: 120, amount: 14_200_000 }, soldRepair: { qty: 8, amount: 900_000 } }, period: "Энэ сар", open: false, onToggle: () => {} }));
    expect(o).toContain("Брак зарсан: 120 ш · 14.2 сая₮");
    expect(o).toContain("Засвар зарсан: 8 ш · 900.0 мянга₮");
    expect(o).toContain(">78<"); // үндсэн зарсан
    expect(o).not.toContain(">198<"); // 78 + 120 нэмэгдээгүй
  });
  it("байхгүй бол мөр гарахгүй", () => {
    const o = html(createElement(ProductCardView, { card: { ...card, repair: 0, defect: 0, warehouses: [], workshops: [] }, period: "Энэ сар", open: false, onToggle: () => {} }));
    expect(o).not.toContain("зарсан:");
  });
});
