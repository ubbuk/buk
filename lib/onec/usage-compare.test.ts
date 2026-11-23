import { describe, expect, it } from "vitest";
import type { WarehouseRow } from "./stock-tree";
import type { UsageDocument, UsageResult } from "./usage";
import { compareUsage, usageByWarehouse } from "./usage-compare";

const doc = (date: string, amount: number, extra: Partial<UsageDocument> = {}): UsageDocument => ({
  id: `${date}-${amount}-${extra.warehouse ?? ""}`,
  number: "1",
  date: `${date}T00:00:00`,
  department: "Цех",
  warehouse: "Склад",
  warehouseCode: "",
  recipient: "",
  purpose: "",
  amount,
  ...extra,
});

const result = (month: string, days: number, docs: UsageDocument[]): UsageResult => ({
  month,
  totals: { amount: docs.reduce((s, d) => s + d.amount, 0), documents: docs.length, materials: 0 },
  byMaterial: [],
  byDepartment: [],
  deptMaterials: [],
  daily: Array.from({ length: days }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { date, amount: docs.filter((d) => d.date.startsWith(date)).reduce((s, d) => s + d.amount, 0) };
  }),
  documents: docs,
});

describe("compareUsage: өмнөх сарын МЭН ҮЕТЭЙ харьцуулалт", () => {
  const prev = result("2026-10", 31, [doc("2026-10-02", 100), doc("2026-10-10", 300), doc("2026-10-20", 1000)]);

  it("одоогийн сар (өнөөдөр 11-р сарын 12): өмнөх сарын 1-12-той харьцуулна, 20-ны баримтыг оруулахгүй", () => {
    const cur = result("2026-11", 30, [doc("2026-11-03", 150), doc("2026-11-11", 450)]);
    const { comparison } = compareUsage(cur, prev, "2026-11-12");
    expect(comparison).toEqual({ prevMonth: "2026-10", throughDay: 12, amount: 400, documents: 2, changePct: 50, documentsChangePct: 0 });
  });

  it("өнгөрсөн сар (today = null): өмнөх сар бүтнээрээ", () => {
    const cur = result("2026-11", 30, [doc("2026-11-03", 1400)]);
    const { comparison } = compareUsage(cur, prev, null);
    expect(comparison).toMatchObject({ throughDay: null, amount: 1400, documents: 3, changePct: 0, documentsChangePct: -66.7 });
  });

  it("өмнөх сард зарцуулалт 0 бол хувь null (хуурамч хязгааргүй өсөлт гаргахгүй)", () => {
    const cur = result("2026-11", 30, [doc("2026-11-03", 50)]);
    const { comparison } = compareUsage(cur, result("2026-10", 31, []), "2026-11-12");
    expect(comparison).toMatchObject({ amount: 0, changePct: null, documentsChangePct: null });
  });

  it("өдөр бүрийн график: өмнөх сарын ижил өдөр (daily[i].previous); богино сарын дараах өдөр 0", () => {
    const cur = result("2026-11", 30, [doc("2026-11-10", 5)]);
    const { daily } = compareUsage(cur, prev, "2026-11-12");
    expect(daily).toHaveLength(30);
    expect(daily[9]).toEqual({ date: "2026-11-10", amount: 5, previous: 300 });
    expect(daily[1].previous).toBe(100);
    const shortPrev = result("2026-02", 28, [doc("2026-02-05", 7)]);
    const mar = compareUsage(result("2026-03", 31, []), shortPrev, null).daily;
    expect(mar[4].previous).toBe(7);
    expect(mar[30].previous).toBe(0);
  });

  it("өмнөх сарыг татаж чадаагүй (null) бол харьцуулалт, previous байхгүй", () => {
    const cur = result("2026-11", 30, [doc("2026-11-03", 150)]);
    const r = compareUsage(cur, null, "2026-11-12");
    expect(r.comparison).toBeNull();
    expect(r.daily).toBe(cur.daily);
    expect(r.daily[0]).not.toHaveProperty("previous");
  });
});

const wh = (id: string, name: string, extra: Partial<WarehouseRow> = {}): WarehouseRow => ({ id, name, onecCode: null, parentId: null, reservable: true, keeperId: null, keeperName: null, ...extra });
const WAREHOUSES: WarehouseRow[] = [
  wh("g1", "Бүлэг А", { keeperId: "u1", keeperName: "Нярав Нэг" }),
  wh("a1", "Склад А1", { onecCode: "00-A1", parentId: "g1" }),
  wh("g2", "Бүлэг Б"),
  wh("b1", "Склад Б1", { onecCode: "00-B1", parentId: "g2" }),
];

describe("usageByWarehouse: 1С склад → Warehouse.onecCode → нярвын бүлэг", () => {
  const docs = [
    doc("2026-11-01", 100, { warehouse: "Нэр 1С дээр өөр", warehouseCode: "00-A1" }),
    doc("2026-11-02", 50, { warehouse: "Нэр 1С дээр өөр", warehouseCode: "00-A1" }),
    doc("2026-11-03", 400, { warehouse: "Склад Б1", warehouseCode: "" }), // код олдохгүй: нэрээр
    doc("2026-11-04", 10, { warehouse: "Үл мэдэгдэх склад", warehouseCode: "99-ZZ" }),
  ];
  const rows = usageByWarehouse(docs, WAREHOUSES);

  it("дүнгээр буурахаар; код, нэрээр холбогдоно; нярвын бүлэг ба нярав (бүлгийнх)", () => {
    expect(rows.map((r) => [r.name, r.amount, r.documents])).toEqual([
      ["Склад Б1", 400, 1],
      ["Склад А1", 150, 2],
      ["Үл мэдэгдэх склад", 10, 1],
    ]);
    expect(rows.find((r) => r.name === "Склад А1")).toMatchObject({ key: "00-A1", group: "Бүлэг А", keeper: { id: "u1", name: "Нярав Нэг" }, mapped: true });
  });

  it("нярав оноогоогүй бүлэг keeper=null", () => {
    expect(rows.find((r) => r.name === "Склад Б1")).toMatchObject({ group: "Бүлэг Б", keeper: null, mapped: true });
  });

  it("ERP-д холбогдоогүй склад нууцлагдахгүй (mapped: false)", () => {
    expect(rows.find((r) => r.name === "Үл мэдэгдэх склад")).toMatchObject({ group: null, keeper: null, mapped: false });
  });

  it("нийлбэр алдагдахгүй", () => {
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(docs.reduce((s, d) => s + d.amount, 0));
  });
});
