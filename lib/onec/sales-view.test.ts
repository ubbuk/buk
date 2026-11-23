import { describe, expect, it } from "vitest";
import { amountMatches, parseQuery } from "@/lib/query-parse";
import { buildSalesView, reconcileSales, type SalesLine } from "./sales-view";
import { formatQuantities } from "@/lib/units";

const line = (over: Partial<SalesLine>): SalesLine => ({ client_code: "C1", client: "Альфа ХХК", item_code: "I1", item: "Цемент М400", unit: "тн", qty: 10, revenue: 1_000_000, cost: 700_000, direct: false, ...over });

describe("buildSalesView: орлого, өртөг, ашиг", () => {
  const lines = [
    line({}),
    line({ item_code: "I2", item: "Арматур", unit: "кг", qty: 18_500, revenue: 30_000_000, cost: 24_000_000 }),
    line({ item_code: "I3", item: "Боолт", unit: "ш", qty: 3200, revenue: 2_000_000, cost: 1_500_000 }),
    line({ client_code: "C2", client: "Бета ХХК", qty: 5, revenue: 500_000, cost: 400_000 }),
    line({ client_code: "", client: "", item_code: "", item: "", unit: "", qty: 0, revenue: 0, cost: 900_000, direct: true }), // цехээс шууд зарцуулсан материал
  ];
  const v = buildSalesView(lines);

  it("KPI: орлого, өртөг (нийт = борлуулсан барааны + шууд), ашиг = орлого − өртөг, ашгийн хувь", () => {
    expect(v.kpi).toEqual({ revenue: 33_500_000, cost: 27_500_000, costOfGoods: 26_600_000, costDirect: 900_000, profit: 6_000_000, margin: 17.9 });
  });

  it("харилцагчаар: орлого, ашиг, хувь; худалдан авсан бараа тоо хэмжээ нэгжтэй; нэгж холигдохгүй, кг нь тонн болно", () => {
    const a = v.clients[0];
    expect(a).toMatchObject({ name: "Альфа ХХК", revenue: 33_000_000, cost: 26_200_000, profit: 6_800_000 });
    expect(a.margin).toBe(20.6);
    expect(formatQuantities(a.quantities).short).toBe("28.5 тонн · 3,200 ширхэг"); // 10 тн + 18,500 кг, ширхэг тусдаа
    expect(a.products.map((p) => [p.name, p.qty, p.unit])).toEqual([["Арматур", 18_500, "кг"], ["Боолт", 3200, "ш"], ["Цемент М400", 10, "тн"]]);
  });

  it("бүтээгдэхүүнээр: худалдан авагчид, ашиг", () => {
    const cement = v.items.find((i) => i.code === "I1")!;
    expect(cement).toMatchObject({ qty: 15, revenue: 1_500_000, profit: 400_000, unit: "тн" });
    expect(cement.clients.map((c) => [c.name, c.qty])).toEqual([["Альфа ХХК", 10], ["Бета ХХК", 5]]);
  });

  it("шууд өртөг харилцагч, бүтээгдэхүүний жагсаалтад орохгүй; нийт ашиг нь жагсаалтуудын ашгийн нийлбэр − шууд өртөг", () => {
    expect(v.clients.some((c) => c.name === "Тодорхойгүй харилцагч")).toBe(false);
    const clientProfit = v.clients.reduce((s, c) => s + c.profit, 0);
    expect(clientProfit - v.kpi.costDirect).toBe(v.kpi.profit);
    expect(v.items.reduce((s, i) => s + i.revenue, 0)).toBe(v.kpi.revenue);
  });

  it("хоосон: ашгийн хувь null", () => {
    expect(buildSalesView([]).kpi).toEqual({ revenue: 0, cost: 0, costOfGoods: 0, costDirect: 0, profit: 0, margin: null });
  });
});

describe("reconcileSales: жагсаалтын нийлбэр = дээд талын Ашиг", () => {
  it("Σ харилцагчийн ашиг − хуваарилагдаагүй зардал = нийт ашиг", () => {
    const v = buildSalesView([line({}), line({ client_code: "C2", client: "Бета ХХК", revenue: 500_000, cost: 400_000 }), line({ client_code: "", client: "", item_code: "", item: "", unit: "", qty: 0, revenue: 0, cost: 1_430_000, direct: true })]);
    const r = reconcileSales(v);
    expect(r).toEqual({ listProfit: 400_000, unassigned: -1_430_000, total: -1_030_000, matches: true });
    expect(r.total).toBe(v.kpi.profit);
  });

  it("шууд өртөггүй бол хуваарилагдаагүй 0, нийлбэр ашигтай тэнцүү (бутархай дүнтэй ч)", () => {
    const v = buildSalesView([line({ revenue: 100.1, cost: 33.3 }), line({ client_code: "C2", client: "Бета", revenue: 200.2, cost: 66.6 }), line({ client_code: "C3", client: "Гамма", revenue: 0.05, cost: 0.02 })]);
    const r = reconcileSales(v);
    expect(r.unassigned).toBe(0);
    expect(r.matches).toBe(true);
  });
});

describe("хайлт: дүн ба үг", () => {
  it("«84 сая», 84073015", () => {
    expect(amountMatches(parseQuery("84 сая"), 84_073_015)).toBe(true);
    expect(amountMatches(parseQuery("84 сая"), 85_000_000)).toBe(false);
    expect(amountMatches(parseQuery("84073015"), 84_073_015.25)).toBe(true);
    expect(amountMatches(parseQuery("цемент"), 5)).toBe(true);
  });
});
