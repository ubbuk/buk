import { describe, expect, it } from "vitest";
import { categorizeExpense, cleanExpenseName } from "./expense-categories";
import { buildExpenseView, type PlRow } from "./expense-view";

const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
const row = (month: string, item: string, amount: number, account = "7000.00"): PlRow => ({ month, account, item, amount });

describe("categorizeExpense: ердийн ангилал, дансны кодгүй", () => {
  const c = (item: string, account = "7000.00") => categorizeExpense({ account, item });
  it("анхдагч дүрмээр нэрнээс ангилна", () => {
    expect(c("7002 Цахилгааны зардал")).toBe("utilities");
    expect(c("7003 Уур, дулааны зардал")).toBe("utilities");
    expect(c("7007 ШТМ-н зардал")).toBe("fuel");
    expect(c("7029 Түрээсийн зардал")).toBe("rent");
    expect(c("7006 Тээврийн зардал")).toBe("transport");
    expect(c("7019 Засвар үйлчилгээний зардал")).toBe("repair");
    expect(c("7034 Банкны гүйлгээний шимтгэл")).toBe("bank");
    expect(c("ХЧТА ажил олгогчоос")).toBe("payroll");
    expect(c("Элэгдлийн зардал")).toBe("depreciation");
    expect(c("Албан томилолтын зардал")).toBe("transport");
    expect(c("Ус хангамжийн зардал")).toBe("utilities");
  });
  it("Нийгмийн даатгал нь Даатгал биш Цалин ба НДШ-д, жинхэнэ даатгал нь Даатгалд орно", () => {
    expect(c("Нийгмийн даатгалын шимтгэл")).toBe("payroll");
    expect(c("Эд хөрөнгийн даатгал")).toBe("insurance");
  });
  it("таарахгүй бол Бусад; том жижиг үсэг ялгахгүй", () => {
    expect(c("Тодорхойгүй зардал")).toBe("other");
    expect(c("ЦАХИЛГААНЫ ЗАРДАЛ")).toBe("utilities");
  });
  it("админы дүрэм анхдагчаас өмнө, priority өсөхөөр", () => {
    expect(categorizeExpense({ account: "7000.00", item: "Цахилгаан" }, [{ field: "ITEM", pattern: "цахилгаан", category: "rent" }])).toBe("rent");
    const rules = [
      { field: "ITEM" as const, pattern: "хоол", category: "other" as const, priority: 200 },
      { field: "ITEM" as const, pattern: "хоол", category: "payroll" as const, priority: 10 },
    ];
    expect(categorizeExpense({ account: "7000.00", item: "Ажилчдын хоол" }, rules)).toBe("payroll");
    expect(categorizeExpense({ account: "7400.00", item: "Бусад" }, [{ field: "ACCOUNT", pattern: "74", category: "bank" }])).toBe("bank");
  });
  it("зардлын кодыг нүүрнээс хасна", () => {
    expect(cleanExpenseName("7010 Хөдөлмөр хамгаалын зардал")).toBe("Хөдөлмөр хамгаалын зардал");
    expect(cleanExpenseName("ХЧТА ажил олгогчоос")).toBe("ХЧТА ажил олгогчоос");
  });
});

describe("buildExpenseView", () => {
  const rows = [
    row("2026-11", "7002 Цахилгааны зардал", 60),
    row("2026-11", "7029 Түрээсийн зардал", 30),
    row("2026-11", "Тодорхойгүй", 10),
    row("2026-11", "Борлуулсан өртөг", 900, "6101.00"),
    row("2026-10", "7002 Цахилгааны зардал", 40),
    row("2026-10", "7029 Түрээсийн зардал", 30),
    row("2026-10", "Борлуулсан өртөг", 500, "6101.00"),
  ];

  it("борлуулсан бүтээгдэхүүний өртөг ангилалд ороход биш, тусдаа мөр", () => {
    const v = buildExpenseView(rows, months, []);
    expect(v.total).toBe(100);
    expect(v.cogs).toEqual({ amount: 900, prevAmount: 500 });
    expect(v.categories.map((c) => c.id)).toEqual(["utilities", "rent", "other"]);
  });

  it("өмнөх сартай харьцуулалт, ангилал бүрийн %, хамгийн том 3", () => {
    const v = buildExpenseView(rows, months, []);
    expect(v.prevLoaded).toBe(true);
    expect(v.prevTotal).toBe(70);
    expect(v.changePct).toBeCloseTo(42.9, 1);
    const util = v.categories[0];
    expect(util.amount).toBe(60);
    expect(util.prevAmount).toBe(40);
    expect(util.share).toBe(60);
    expect(util.items).toEqual([{ name: "Цахилгааны зардал", account: "7000.00", amount: 60, prevAmount: 40, changePct: 50 }]);
    expect(v.top.map((t) => t.id)).toEqual(["utilities", "rent"]); // «Бусад» топод ордоггүй
  });

  it("өмнөх сар татагдаагүй бол харьцуулалтгүй (0 биш)", () => {
    const only = rows.filter((r) => r.month === "2026-11");
    const v = buildExpenseView(only, months, [], new Set(["2026-11"]));
    expect(v.prevLoaded).toBe(false);
    expect(v.changePct).toBeNull();
    expect(v.prevTotal).toBe(0);
    expect(v.categories.every((c) => c.changePct === null && c.prevAmount === 0)).toBe(true);
    expect(v.months.map((m) => m.loaded)).toEqual([false, false, false, true]);
  });

  it("өмнөх сар татагдсан ч зардалгүй бол бодит 0: харьцуулалт гарна", () => {
    const v = buildExpenseView(rows.filter((r) => r.month === "2026-11"), months, [], new Set(["2026-10", "2026-11"]));
    expect(v.prevLoaded).toBe(true);
    expect(v.prevTotal).toBe(0);
  });

  it("12 сарын цуваа ангилал бүрт, «Бусад» 10%-иас дээш бол сануулга", () => {
    const v = buildExpenseView(rows, months, []);
    expect(v.categories[0].series).toEqual([0, 0, 40, 60]);
    expect(v.otherShare).toBe(10);
    expect(v.otherWarn).toBe(false); // яг 10% нь сануулахгүй
    const more = buildExpenseView([...rows, row("2026-11", "Өөр", 20)], months, []);
    expect(more.otherWarn).toBe(true);
  });

  it("админы дүрэм ангиллыг өөрчилнө", () => {
    const v = buildExpenseView(rows, months, [{ field: "ITEM", pattern: "тодорхойгүй", category: "insurance" }]);
    expect(v.categories.map((c) => c.id)).toContain("insurance");
    expect(v.otherShare).toBe(0);
  });
});
