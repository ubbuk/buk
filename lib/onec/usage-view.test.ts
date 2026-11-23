import { describe, expect, it } from "vitest";
import { buildUsage } from "./usage";
import { buildUsageView } from "./usage-view";
import { sumUsage } from "./usage-trend";
import { formatQuantities } from "@/lib/units";

const ZERO = "00000000-0000-0000-0000-000000000000";
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";
const D1 = "d1d1d1d1-0000-0000-0000-000000000001";
const D2 = "d2d2d2d2-0000-0000-0000-000000000002";
const D3 = "d3d3d3d3-0000-0000-0000-000000000003";
const WORKSHOP = "c1c1c1c1-0000-0000-0000-000000000009";
const OFFICE = "c2c2c2c2-0000-0000-0000-000000000009";
const WH = "e1e1e1e1-0000-0000-0000-000000000008";

const doc = (id: string, number: string, dept: string) => ({ Ref_Key: id, Number: number, Date: "2026-10-05T10:00:00", Склад_Key: WH, ПодразделениеЗатрат_Key: dept, ПодразделениеОрганизации_Key: ZERO, Комментарий: "Дорж Болд ажилтны цалингаас" });
const rec = (recorder: string, item: string, amount: number, qty: number) => ({ Recorder: recorder, Period: "2026-10-05T10:00:00", Сумма: String(amount), КоличествоCr: String(qty), ExtDimensionCr1: item, ExtDimensionCr1_Type: "StandardODATA.Catalog_Номенклатура" });

const usage = buildUsage({
  month: "2026-10",
  docs: [doc(D1, "1", WORKSHOP), doc(D2, "2", WORKSHOP), doc(D3, "3", OFFICE)],
  records: [rec(D1, A, 1_000_000, 10), rec(D2, A, 500_000, 5), rec(D1, B, 300_000, 18_500), rec(D3, A, 100_000, 1), rec(D3, C, 40_000, 3200)],
  names: {
    items: new Map([[A, { name: "Цемент М400", unit: "тн" }], [B, { name: "Арматур", unit: "кг" }], [C, { name: "Боолт", unit: "ш" }]]),
    departments: new Map([[WORKSHOP, "Бетон цех"], [OFFICE, "Захиргаа"]]),
    warehouses: new Map([[WH, "Төв агуулах"]]),
    contractors: new Map(),
  },
});

describe("buildUsage: хэлтэс × материал", () => {
  it("тоо, дүнг цех бүрээр материалаар нэгтгэнэ; нийлбэр нь материал, хэлтсийн нийлбэртэй таарна", () => {
    const total = usage.deptMaterials.reduce((s, m) => s + m.amount, 0);
    expect(total).toBe(usage.totals.amount);
    expect(usage.deptMaterials.find((m) => m.department === "Бетон цех" && m.key === A)).toMatchObject({ name: "Цемент М400", unit: "тн", quantity: 15, amount: 1_500_000 });
    for (const dep of usage.byDepartment) expect(usage.deptMaterials.filter((m) => m.department === dep.name).reduce((s, m) => s + m.amount, 0)).toBe(dep.amount);
    for (const mat of usage.byMaterial) expect(usage.deptMaterials.filter((m) => m.key === mat.key).reduce((s, m) => s + m.amount, 0)).toBe(mat.amount);
  });
});

describe("buildUsageView: цех → материал, материал → цех", () => {
  const v = buildUsageView(usage.byDepartment, usage.byMaterial, usage.deptMaterials);

  it("цех: дүнгээр, материал бүр тоо хэмжээ нэгжтэй + ₮; нэгжийг нэмэхгүй, кг нь тонн болно", () => {
    expect(v.departments.map((d) => d.name)).toEqual(["Бетон цех", "Захиргаа"]);
    const w = v.departments[0];
    expect(w.materials.map((m) => [m.name, m.quantity, m.unit, m.amount])).toEqual([["Цемент М400", 15, "тн", 1_500_000], ["Арматур", 18_500, "кг", 300_000]]);
    expect(formatQuantities(w.quantities).short).toBe("33.5 тонн"); // 15 тн + 18.5 тн (кг)
    expect(formatQuantities(v.departments[1].quantities).short).toBe("1 тонн · 3,200 ширхэг");
  });

  it("материал: цехүүдээр задрана", () => {
    const cement = v.materials.find((m) => m.key === A)!;
    expect(cement.departments.map((d) => [d.name, d.quantity, d.amount])).toEqual([["Бетон цех", 15, 1_500_000], ["Захиргаа", 1, 100_000]]);
  });
});

describe("usage-trend: сарын нийт", () => {
  it("зөвхөн бараа материалын кредит талын бичилтийн дүн", () => {
    expect(sumUsage([rec(D1, A, 100.5, 1), rec(D1, B, 50, 1), { Сумма: "999", ExtDimensionCr1_Type: "StandardODATA.Catalog_Контрагенты" }])).toBe(150.5);
    expect(sumUsage([])).toBe(0);
  });
});
