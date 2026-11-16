import { describe, expect, it } from "vitest";
import { buildStockTree, effectiveKeeper, leafWarehouses, unknownTitle, type StockRow, type WarehouseRow } from "./stock-tree";

const wh = (id: string, name: string, extra: Partial<WarehouseRow> = {}): WarehouseRow => ({ id, name, onecCode: null, parentId: null, reservable: true, keeperId: null, keeperName: null, ...extra });
const row = (id: string, code: string, item: string, amount: number, extra: Partial<StockRow> = {}): StockRow => ({
  id,
  warehouse_code: code,
  warehouse: "",
  item_code: `c-${item}`,
  item,
  unit: "ш",
  account: "1411",
  qty: 1,
  amount,
  unit_cost: amount,
  ...extra,
});

// нярвын нэр кодонд биш, Warehouse → User-ээс ирдэг: тестийн нэрүүд зохиомол
const WAREHOUSES: WarehouseRow[] = [
  wh("g-a", "Бүлэг А", { keeperId: "u1", keeperName: "Нярав Нэг" }),
  wh("a-1", "Склад А1", { onecCode: "00-A1", parentId: "g-a" }),
  wh("a-2", "Склад А2", { onecCode: "00-A2", parentId: "g-a" }),
  wh("g-b", "Бүлэг Б"), // нярав оноогоогүй
  wh("b-1", "Склад Б1", { onecCode: "00-B1", parentId: "g-b" }),
  wh("g-fin", "Бэлэн бүтээгдэхүүн", { keeperId: "u2", keeperName: "Нярав Хоёр" }),
  wh("f-1", "Бэлэн А", { onecCode: "00-F1", parentId: "g-fin", reservable: false }),
];

describe("effectiveKeeper / leafWarehouses", () => {
  const byId = new Map(WAREHOUSES.map((w) => [w.id, w]));
  it("склад нь өөрийн нярав, үгүй бол бүлгийнхийг авна; оноогоогүй бол null", () => {
    expect(effectiveKeeper(byId.get("a-1")!, byId)).toEqual({ id: "u1", name: "Нярав Нэг" });
    expect(effectiveKeeper(byId.get("b-1")!, byId)).toBeNull();
    expect(effectiveKeeper({ ...byId.get("a-1")!, keeperId: "u9", keeperName: "Өөр" }, byId)).toEqual({ id: "u9", name: "Өөр" });
  });
  it("зөвхөн onecCode-той складууд", () => {
    expect(leafWarehouses(WAREHOUSES).map((l) => l.code)).toEqual(["00-A1", "00-A2", "00-B1", "00-F1"]);
  });
});

describe("buildStockTree", () => {
  const rows = [
    row("1", "00-A1", "x", 100),
    row("2", "00-A1", "y", 300),
    row("3", "00-A1", "y", 50, { account: "1412" }), // ижил бараа өөр дансанд: барааны тоо давхардахгүй
    row("4", "00-A2", "z", 20),
    row("5", "00-B1", "w", 5000),
    row("6", "00-F1", "fin", 10),
    row("7", "", "blank1", 70, { account: "1418" }),
    row("8", "", "blank2", 30, { account: "1418" }),
    row("9", "99-ZZ", "stray", 1, { warehouse: "Үл мэдэгдэх склад" }),
  ];
  const tree = buildStockTree(WAREHOUSES, rows, { includeEmpty: true });

  it("3 түвшин: бүлэг → склад → бараа; бүлгүүд дүнгээр буурна, «ERP-д холбогдоогүй» дараа, «Агуулах тодорхойгүй» хамгийн доор", () => {
    expect(tree.map((g) => g.name)).toEqual(["Бүлэг Б", "Бүлэг А", "Бэлэн бүтээгдэхүүн", "ERP-д холбогдоогүй склад", "Агуулах тодорхойгүй"]);
    expect(tree.map((g) => g.kind)).toEqual(["group", "group", "group", "unmapped", "unknown"]);
  });
  it("бүлэг, склад бүрт барааны тоо (давхардалгүй) ба нийт дүн", () => {
    const a = tree.find((g) => g.name === "Бүлэг А")!;
    expect(a).toMatchObject({ items: 3, amount: 470 });
    expect(a.warehouses.map((w) => [w.name, w.items, w.amount])).toEqual([
      ["Склад А1", 2, 450],
      ["Склад А2", 1, 20],
    ]);
  });
  it("склад дотор дүнгээр буурахаар", () => {
    const a1 = tree.find((g) => g.name === "Бүлэг А")!.warehouses[0];
    expect(a1.rows.map((r) => r.amount)).toEqual([300, 100, 50]);
  });
  it("нярав: оноосон нэр, оноогоогүй бол null; нэр кодонд биш өгөгдлөөс", () => {
    expect(tree.find((g) => g.name === "Бүлэг А")!.keeper).toEqual({ id: "u1", name: "Нярав Нэг" });
    expect(tree.find((g) => g.name === "Бүлэг А")!.warehouses[0].keeper).toEqual({ id: "u1", name: "Нярав Нэг" });
    expect(tree.find((g) => g.name === "Бүлэг Б")!.keeper).toBeNull();
    expect(tree.find((g) => g.name === "Бүлэг Б")!.warehouses[0].keeper).toBeNull();
  });
  it("reservable=false склад тусад нь тэмдэглэгдэнэ", () => {
    const fin = tree.find((g) => g.name === "Бэлэн бүтээгдэхүүн")!.warehouses[0];
    expect(fin.reservable).toBe(false);
    expect(tree.find((g) => g.name === "Бүлэг А")!.warehouses.every((w) => w.reservable)).toBe(true);
  });
  it("складын код хоосон мөрүүд тусдаа бүлэг, дансууд нь гарчигт", () => {
    const unknown = tree.at(-1)!;
    expect(unknown).toMatchObject({ items: 2, amount: 100, accounts: ["1418"] });
    expect(unknownTitle(unknown)).toBe("Агуулах тодорхойгүй (1418 данс)");
  });
  it("Warehouse.onecCode-д байхгүй код нууц алдагдахгүй: «ERP-д холбогдоогүй склад»", () => {
    const stray = tree.find((g) => g.kind === "unmapped")!;
    expect(stray.warehouses).toMatchObject([{ key: "99-ZZ", name: "Үл мэдэгдэх склад", amount: 1 }]);
  });
  it("нийт: бүлгүүдийн дүнгийн нийлбэр = мөрүүдийн нийлбэр (юу ч алдагдаагүй)", () => {
    expect(tree.reduce((s, g) => s + g.amount, 0)).toBe(rows.reduce((s, r) => s + r.amount, 0));
  });
  it("includeEmpty: шүүлтгүй үед бараагүй складыг 0-тэй харуулна, шүүлттэй үед нууна", () => {
    const only = [row("1", "00-A1", "x", 100)];
    const all = buildStockTree(WAREHOUSES, only, { includeEmpty: true });
    expect(all.find((g) => g.name === "Бүлэг А")!.warehouses.map((w) => [w.name, w.items])).toEqual([["Склад А1", 1], ["Склад А2", 0]]);
    expect(all.map((g) => g.name)).toContain("Бүлэг Б");
    const filtered = buildStockTree(WAREHOUSES, only, { includeEmpty: false });
    expect(filtered.map((g) => g.name)).toEqual(["Бүлэг А"]);
    expect(filtered[0].warehouses.map((w) => w.name)).toEqual(["Склад А1"]);
  });
  it("мөр огт байхгүй, шүүлттэй бол мод хоосон", () => {
    expect(buildStockTree(WAREHOUSES, [], { includeEmpty: false })).toEqual([]);
  });
});

describe("unknownTitle", () => {
  it("дансгүй бол нэр, 3-аас олон бол «…»", () => {
    expect(unknownTitle({ name: "Агуулах тодорхойгүй", accounts: [] })).toBe("Агуулах тодорхойгүй");
    expect(unknownTitle({ name: "Агуулах тодорхойгүй", accounts: ["1", "2", "3", "4"] })).toBe("Агуулах тодорхойгүй (1, 2, 3, … данс)");
  });
});
