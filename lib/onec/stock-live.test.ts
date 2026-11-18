import { describe, expect, it } from "vitest";
import { buildAccountBook } from "./accounts";
import { buildStockLive, type StockNames } from "./stock-live";
import { buildStockTree, isOffWarehouse, OFF_WAREHOUSE_NAME, type WarehouseRow } from "./stock-tree";

const A_1401 = "a0000000-0000-0000-0000-000000001401";
const A_1415 = "a0000000-0000-0000-0000-000000141501";
const A_1418 = "a0000000-0000-0000-0000-000000141801";
const A_1421 = "a0000000-0000-0000-0000-000000001421";
const W1 = "b0000000-0000-0000-0000-000000000001";
const W2 = "b0000000-0000-0000-0000-000000000002";
const I1 = "c0000000-0000-0000-0000-000000000001";
const I2 = "c0000000-0000-0000-0000-000000000002";
const EMP = "d0000000-0000-0000-0000-000000000001";

const book = buildAccountBook([
  { Ref_Key: A_1401, Code: "1401.00", Description: "Түүхий Эд, материал" },
  { Ref_Key: A_1415, Code: "1415.01", Description: "Сэлбэг хэрэгсэл" },
  { Ref_Key: A_1418, Code: "1418.01", Description: "Ашиглалтанд буй ажлын хувцас" },
  { Ref_Key: A_1421, Code: "1421.00", Description: "Үндсэн Үйлдвэрлэл" },
]);
const names: StockNames = {
  items: new Map([
    [I1, { name: "Цемент", code: "00-1", unit: "кг" }],
    [I2, { name: "Гутал", code: "00-2", unit: "ш" }],
  ]),
  warehouses: new Map([
    [W1, { name: "Цайны газрын агуулах", code: "00-000008" }],
    [W2, { name: "Хангамжийн агуулах", code: "00-000002" }],
  ]),
};
const bal = (acc: string, item: string | null, wh: string | null, amount: number, qty: number, dim2Type = "StandardODATA.Catalog_Склады") => ({
  Account_Key: acc,
  ExtDimension1: item,
  ExtDimension1_Type: item ? "StandardODATA.Catalog_Номенклатура" : "",
  ExtDimension2: wh,
  ExtDimension2_Type: wh ? dim2Type : "",
  СуммаBalance: amount,
  КоличествоBalance: qty,
});

const balances = [
  bal(A_1401, I1, W1, 1000, 10),
  bal(A_1415, I1, W1, 250.5, 2), // ижил бараа, ижил агуулах, өөр данс: нэг мөр болно
  bal(A_1401, I1, W2, 400, 4),
  bal(A_1401, I2, W2, -30, -1), // хасах үлдэгдэл
  bal(A_1418, I2, EMP, 77.25, 3, "StandardODATA.Catalog_ФизическиеЛица"), // 2-р субконт нь агуулах биш
  bal(A_1418, I1, null, 10, 1), // 2-р субконт хоосон
  bal(A_1421, null, null, 5000, 0), // 142x: Дуусаагүй үйлдвэрлэл, хүснэгтэд ордоггүй
  bal(A_1401, I2, W1, 0, 0), // хоосон мөр
];

describe("агуулах тус бүрийн үлдэгдэл (14xx Balance, 2-р субконто = Агуулах)", () => {
  const live = buildStockLive("2026-11-18", balances, book, names);

  it("нэг бараа нэг агуулахад хэд хэдэн дансанд байвал нэг мөр, тоо дүн нэгдэнэ; дансны НЭР жагсана", () => {
    const row = live.rows.find((r) => r.warehouse_code === "00-000008" && r.item_code === "00-1")!;
    expect(row).toMatchObject({ qty: 12, amount: 1250.5, unit: "кг", warehouse: "Цайны газрын агуулах", unit_cost: 104.21 });
    expect(row.account).toBe("Сэлбэг хэрэгсэл, Түүхий Эд, материал");
    expect(live.rows.filter((r) => r.warehouse_code === "00-000008")).toHaveLength(1);
  });

  it("142x хүснэгтэд орохгүй, тусад нь; хоосон мөр орохгүй", () => {
    expect(live.reconciliation.wip).toBe(5000);
    expect(live.rows.some((r) => r.amount === 5000)).toBe(false);
    expect(live.rows.some((r) => r.warehouse_code === "00-000008" && r.item_code === "00-2")).toBe(false);
  });

  it("2-р субконтод агуулах байхгүй мөрүүд (1418.xx) «агуулах тодорхойгүй» биш: дансныхаа нэртэй `acct:` код; агуулахын талбар 1С-д хоосон бол тэмдэглэнэ", () => {
    const noWh = live.rows.filter((r) => isOffWarehouse(r.warehouse_code));
    expect(noWh.map((r) => r.amount).sort()).toEqual([10, 77.25]);
    expect(noWh.every((r) => r.warehouse_code === "acct:1418.01" && r.warehouse === "Ашиглалтанд буй ажлын хувцас")).toBe(true);
    // агуулахын талбар (Склады төрөл) байгаа ч утга хоосон: 1С-д заагаагүй гэж тэмдэглэнэ
    const gap = buildStockLive("2026-11-18", [{ ...bal(A_1401, I1, null, 28, 1), ExtDimension2: "00000000-0000-0000-0000-000000000000", ExtDimension2_Type: "StandardODATA.Catalog_Склады" }], book, names).rows[0];
    expect(gap).toMatchObject({ warehouse_code: "acct:1401", warehouse: "Түүхий Эд, материал · 1С-д агуулах заагаагүй", amount: 28 });
  });

  it("нийт = 14xx Balance (142x-гүй): 0 зөрүү, юу ч алдагдаагүй", () => {
    expect(live.reconciliation).toEqual({ balance: 1707.75, table: 1707.75, difference: 0, wip: 5000 });
    expect(live.rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(1707.75, 2);
  });

  it("мод: агуулах бүрт өөрийн дүн, «Агуулах тодорхойгүй» гэж хэзээ ч гарахгүй, хамгийн доор «Агуулахад хадгалагдаагүй» (дансны нэрээр)", () => {
    const warehouses: WarehouseRow[] = [
      { id: "g", name: "Бүлэг", onecCode: null, parentId: null, reservable: true, keeperId: null, keeperName: null },
      { id: "w", name: "Цайны газар", onecCode: "00-000008", parentId: "g", reservable: true, keeperId: null, keeperName: null },
    ];
    const tree = buildStockTree(warehouses, live.rows, { includeEmpty: false });
    expect(tree.at(-1)).toMatchObject({ kind: "off_warehouse", name: OFF_WAREHOUSE_NAME, amount: 87.25, accounts: ["Ашиглалтанд буй ажлын хувцас"] });
    expect(tree.at(-1)!.warehouses.map((w) => w.name)).toEqual(["Ашиглалтанд буй ажлын хувцас"]);
    expect(tree.find((g) => g.kind === "group")!.warehouses[0]).toMatchObject({ name: "Цайны газар", amount: 1250.5, items: 1 });
    expect(JSON.stringify(tree)).not.toContain("тодорхойгүй");
    expect(tree.reduce((s, g) => s + g.amount, 0)).toBeCloseTo(live.reconciliation.balance, 2);
  });

  it("барааны холбоос алдагдсан мөр ч нийт дүнд орно (мөр алдагдахгүй)", () => {
    const l = buildStockLive("2026-11-18", [bal(A_1401, null, W1, 99, 1)], book, names);
    expect(l.rows[0]).toMatchObject({ item: "Бараа тодорхойгүй", amount: 99, warehouse_code: "00-000008" });
    expect(l.reconciliation.difference).toBe(0);
  });
});
