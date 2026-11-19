import { describe, expect, it } from "vitest";
import { buildStockView, stockGroupName } from "./stock-view";
import { formatQuantities } from "@/lib/units";
import type { StockRow } from "./stock-tree";

let n = 0;
const row = (over: Partial<StockRow>): StockRow => ({
  id: `r${++n}`,
  warehouse_code: "00-1",
  warehouse: "Төв агуулах",
  item_code: "C1",
  item: "Цемент М400",
  unit: "тн",
  account: "Түүхий Эд, материал",
  group: "Түүхий Эд, материал",
  qty: 10,
  amount: 1_000_000,
  unit_cost: 100_000,
  ...over,
});

describe("buildStockView: бүлэг → бараа → агуулах", () => {
  const rows = [
    row({ qty: 12, amount: 8_000_000 }),
    row({ warehouse_code: "00-2", warehouse: "Цехийн агуулах", qty: 18, amount: 13_400_000 }),
    row({ item_code: "R1", item: "Арматур", unit: "кг", qty: 18_500, amount: 30_000_000 }),
    row({ item_code: "B1", item: "Боолт М12", unit: "Sh", qty: 3200, amount: 2_000_000, group: "Сэлбэг хэрэгсэл", account: "Сэлбэг хэрэгсэл" }),
    row({ item_code: "X1", item: "Бэлэн хоолой", unit: "ш", qty: 40, amount: 9_000_000, group: "Бараа", account: "Бараа" }),
  ];
  const v = buildStockView(rows);

  it("бараа агуулахуудаар нийлж, нэгж, дүнгээ хадгална (30 тонн · 21.4 сая₮)", () => {
    const cement = v.groups.flatMap((g) => g.list).find((i) => i.code === "C1")!;
    expect(cement).toMatchObject({ qty: 30, unit: "тн", amount: 21_400_000 });
    expect(cement.warehouses.map((w) => w.name)).toEqual(["Цехийн агуулах", "Төв агуулах"]); // том дүн түрүүлнэ
  });

  it("бүлэг: дүнгээр, ойлгомжтой нэртэй; өөр нэгжийг нэмэхгүй, кг нь тонн болно", () => {
    expect(v.groups.map((g) => g.name)).toEqual(["Түүхий эд, материал", "Худалдан авсан бараа", "Сэлбэг хэрэгсэл"]);
    const raw = v.groups[0];
    expect(raw.amount).toBe(51_400_000);
    expect(raw.quantities).toEqual([{ unit: "тонн", qty: 48.5 }]); // 30 тонн + 18,500 кг
    expect(formatQuantities(raw.quantities).short).toBe("48.5 тонн");
    expect(v.groups[2].quantities).toEqual([{ unit: "ширхэг", qty: 3200 }]);
  });

  it("нэг бүлэгт өөр нэгжтэй бараа: нэгж бүр тусдаа", () => {
    const mixed = buildStockView([row({ qty: 30, unit: "тн" }), row({ item_code: "B1", item: "Боолт", unit: "ш", qty: 3200, amount: 1 })]);
    expect(formatQuantities(mixed.groups[0].quantities).short).toBe("30 тонн · 3,200 ширхэг");
  });

  it("агуулахаар: агуулах → бараа (тоо, нэгж, ₮)", () => {
    const wh = v.warehouses.find((w) => w.code === "00-2")!;
    expect(wh).toMatchObject({ name: "Цехийн агуулах", amount: 13_400_000, items: 1 });
    expect(wh.list[0]).toMatchObject({ name: "Цемент М400", qty: 18, unit: "тн", group: "Түүхий эд, материал" });
  });

  it("хамгийн үнэтэй 10 бараа", () => {
    const many = Array.from({ length: 15 }, (_, i) => row({ item_code: `K${i}`, item: `Бараа ${i}`, amount: 100 + i }));
    const top = buildStockView(many).top;
    expect(top).toHaveLength(10);
    expect(top[0].name).toBe("Бараа 14");
  });

  it("хасах үлдэгдэл тэмдэглэгдэнэ; агуулахгүй үлдэгдэл хамгийн сүүлд", () => {
    const neg = buildStockView([row({ qty: -5, amount: -10 }), row({ warehouse_code: "acct:1418.01", warehouse: "Ашиглалтанд буй багаж", item_code: "T1", item: "Багаж", amount: 5_000_000 })]);
    expect(neg.groups[0].negative).toBe(1);
    expect(neg.groups[0].list.find((i) => i.code === "C1")!.negative).toBe(true);
    expect(neg.warehouses.at(-1)!.name).toBe("Ашиглалтанд буй багаж");
  });

  it("нийт дүн хадгалагдана: бүлгүүдийн нийлбэр = агуулахуудын нийлбэр = мөрүүдийн нийлбэр", () => {
    const total = rows.reduce((s, r) => s + r.amount, 0);
    expect(v.groups.reduce((s, g) => s + g.amount, 0)).toBe(total);
    expect(v.warehouses.reduce((s, w) => s + w.amount, 0)).toBe(total);
  });
});

describe("stockGroupName", () => {
  it("толь бичиг, хоосон", () => {
    expect(stockGroupName("Түүхий Эд, материал")).toBe("Түүхий эд, материал");
    expect(stockGroupName("Бараа")).toBe("Худалдан авсан бараа");
    expect(stockGroupName("Сэлбэг хэрэгсэл")).toBe("Сэлбэг хэрэгсэл");
    expect(stockGroupName("")).toBe("Бусад");
    expect(stockGroupName(undefined)).toBe("Бусад");
  });
});
