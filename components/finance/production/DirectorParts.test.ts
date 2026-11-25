import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DirectorCard } from "@/lib/onec/production-view";
import { MonthProgress, WorkshopCards, workshopHref } from "./DirectorParts";

const card = (name: string, over: Partial<DirectorCard> = {}): DirectorCard => ({
  name,
  day: [{ unit: "ширхэг", qty: 715 }],
  products: [{ name: "Шон 80*80", qty: 715, unit: "ш" }],
  top: { name: "Шон 80*80", qty: 715, unit: "ш" },
  lastDay: "2098-04-09",
  month: [{ unit: "ширхэг", qty: 4996 }],
  monthProducts: [],
  unit: "ширхэг",
  monthQty: 4996,
  monthDays: [],
  ...over,
});
const cards = [card("Тенсиланд хэсэг"), card("Бетон зуурмаг (БАЗ-3, БАЗ-4)", { day: [], top: null, monthQty: 0, month: [], lastDay: "2098-03-30" })];
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));

describe("workshopHref", () => {
  it("цехийн нэр (хаалт, таслалтай) кодлогдож, өдөр ?day=-ээр дамжина", () => {
    expect(workshopHref("Бетон зуурмаг (БАЗ-3, БАЗ-4)", "2098-04-09")).toBe(`/finance/production/${encodeURIComponent("Бетон зуурмаг (БАЗ-3, БАЗ-4)")}?day=2098-04-09`);
    expect(workshopHref("Тенсиланд хэсэг")).toBe(`/finance/production/${encodeURIComponent("Тенсиланд хэсэг")}`);
  });
});

describe("карт ба сарын мөр: дарахад задрахгүй, цехийн хуудас руу линк", () => {
  it("цех бүрийн карт (мэдээгүй ч) өдөртэй нь линк, товч (button) биш", () => {
    const html = renderToStaticMarkup(createElement(WorkshopCards, { cards, day: "2098-04-09" }));
    expect(hrefs(html)).toEqual(cards.map((c) => workshopHref(c.name, "2098-04-09")));
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-pressed");
  });
  it("сарын явцын мөр бүр өдөртэй нь линк, задрах (aria-expanded) байхгүй", () => {
    const html = renderToStaticMarkup(createElement(MonthProgress, { cards, month: "2098-04", day: "2098-04-09" }));
    expect(hrefs(html).sort()).toEqual(cards.map((c) => workshopHref(c.name, "2098-04-09")).sort());
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("<button");
  });
});
