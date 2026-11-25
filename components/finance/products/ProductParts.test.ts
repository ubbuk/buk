import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProductCard, ProductDetail } from "@/lib/onec/product-search";
import { shortUnit } from "./ProductParts";
import { PeriodBar, ProductCardView, ProductDetailView, TopList, periodLabel } from "./ProductParts";

const card: ProductCard = {
  id: "x|ширхэг",
  name: "Төмөр бетон цагираг Ф-1000 Хүчитгэсэн",
  unit: "ширхэг",
  produced: 154,
  repair: 7,
  defect: 1,
  sold: 78,
  stock: 1234,
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
  it("брак, засвар 0 бол жижиг мөр гарахгүй; зарсан null (цехийн эрх) бол «—»", () => {
    const o = html(createElement(ProductCardView, { card: { ...card, repair: 0, defect: 0, sold: null, stock: null }, period: "Энэ сар", open: false, onToggle: () => {} }));
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
