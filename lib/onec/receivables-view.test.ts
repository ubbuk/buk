import { describe, expect, it } from "vitest";
import { fromSnapshotRows, type SnapshotRow } from "./receivables";
import { buildReceivablesView, historyStartFrom, previousMonthEnd } from "./receivables-view";
import { nameKey } from "./receivable-aging";

const row = (key: string, name: string, balance: number): SnapshotRow => ({ accountCode: "1201", accountName: "Авлага", customerKey: key, customer: name, balance, customers: 1 });
const cur = fromSnapshotRows("2026-10-31", [row("k1", "Альфа ХХК", 1000), row("k2", "Бета ХХК", 400), row("k3", "Гамма ХХК", -50)]);
const prev = fromSnapshotRows("2026-09-30", [row("k1", "Альфа ХХК", 700), row("k3", "Гамма ХХК", -50)]);
const invoices = new Map([[nameKey("Альфа ХХК"), [{ date: "2026-10-20", total: 600 }, { date: "2026-08-15", total: 900 }]]]);

describe("buildReceivablesView", () => {
  const v = buildReceivablesView(cur, prev, invoices, "2026-01-01");

  it("өмнөх сартай харьцуулалт: харилцагч бүрийн өөрчлөлт, нийт", () => {
    expect(v.previous).toEqual({ asOf: "2026-09-30", receivable: 650, change: 700, changePct: 107.7 });
    const alpha = v.customers.find((c) => c.key === "k1")!;
    expect(alpha).toMatchObject({ previousBalance: 700, change: 300 });
    expect(v.customers.find((c) => c.key === "k2")).toMatchObject({ previousBalance: 0, change: 400 }); // өмнө нь өргүй байсан
  });

  it("нас: Альфа 600 нь 11 хоног (0–30), 400 нь 77 хоног (61–90); Бета борлуулалтгүй → Тодорхойгүй; урьдчилгаа нас байхгүй", () => {
    const alpha = v.customers.find((c) => c.key === "k1")!;
    expect(alpha.aging).toMatchObject({ b0_30: 600, b61_90: 400 });
    expect(v.customers.find((c) => c.key === "k2")!.aging).toMatchObject({ unknown: 400, b90: 0 });
    expect(v.customers.find((c) => c.key === "k3")!.aging).toMatchObject({ b0_30: 0, unknown: 0 });
    expect(v.aging.buckets.map((b) => [b.key, b.amount])).toEqual([["b0_30", 600], ["b31_60", 0], ["b61_90", 400], ["b90", 0], ["unknown", 400]]);
    expect(v.aging.over30).toBe(400);
    expect(v.aging.buckets.reduce((s, b) => s + b.amount, 0)).toBe(cur.totals.debit); // насны нийлбэр = өр (урьдчилгаагүй)
  });

  it("өмнөх сарын агшин зураггүй бол харьцуулалт null, өөрчлөлт null", () => {
    const w = buildReceivablesView(cur, null, invoices, "2026-01-01");
    expect(w.previous).toBeNull();
    expect(w.customers.every((c) => c.change === null && c.previousBalance === null)).toBe(true);
  });
});

describe("historyStartFrom / previousMonthEnd", () => {
  it("борлуулалтын түүх: asOf-ийн сараас хойш дараалсан саруудын эхлэл, завсартай бол завсараас хойш", () => {
    expect(historyStartFrom(["2026-01", "2026-02", "2026-03"], "2026-03-31")).toBe("2026-01-01");
    expect(historyStartFrom(["2026-01", "2026-03", "2026-04"], "2026-04-15")).toBe("2026-03-01");
    expect(historyStartFrom(["2026-01"], "2026-04-15")).toBeNull();
  });
  it("өмнөх сарын эцэс", () => {
    expect(previousMonthEnd("2026-10-31")).toBe("2026-09-30");
    expect(previousMonthEnd("2026-03-15")).toBe("2026-02-28");
    expect(previousMonthEnd("2026-01-10")).toBe("2025-12-31");
  });
});
