import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { describeImport, importMaterials } from "./material-import";

// Real DB (isolated test database). A far-future snapshot date and IMPT-/IMP- prefixed codes keep this file clear of other data;
// the import is always given that date explicitly, so the global "latest snapshot" is never involved.
const D = "2033-02-02";
const P = "IMPT-";
const at = (d: string) => new Date(`${d}T00:00:00Z`);

const row = (warehouse_code: string, item_code: string, qty: number, amount: number, extra: Partial<{ item: string; unit: string; account: string }> = {}) => ({
  snapshotDate: at(D),
  warehouseCode: warehouse_code,
  warehouse: `1С ${warehouse_code}`,
  itemCode: item_code,
  item: extra.item ?? `Бараа ${item_code}`,
  unit: extra.unit ?? "ш",
  account: extra.account ?? "1510",
  qty,
  amount,
});

let wh1: string, wh2: string;

async function wipe() {
  await prisma.inventoryBalance.deleteMany({ where: { material: { code: { startsWith: P } } } });
  await prisma.material.deleteMany({ where: { code: { startsWith: P } } });
  await prisma.warehouse.deleteMany({ where: { name: { startsWith: "IMPT " } } });
  await prisma.onecStock.deleteMany({ where: { snapshotDate: at(D) } });
  await prisma.onecSyncLog.deleteMany({ where: { kind: "import-materials", period: D } });
}

beforeAll(wipe);
afterAll(wipe);
beforeEach(async () => {
  await wipe();
  wh1 = (await prisma.warehouse.create({ data: { name: "IMPT wh1", onecCode: "IMP-WH1" } })).id;
  wh2 = (await prisma.warehouse.create({ data: { name: "IMPT wh2", onecCode: "IMP-WH2" } })).id;
  await prisma.warehouse.createMany({
    data: [
      { name: "IMPT dup1", onecCode: "IMP-DUP" },
      { name: "IMPT dup2", onecCode: "IMP-DUP" },
      { name: "IMPT inactive", onecCode: "IMP-OFF", isActive: false },
      { name: "IMPT unmapped" }, // onecCode байхгүй
      { name: "IMPT finished goods", onecCode: "IMP-NR", reservable: false }, // бэлэн бүтээгдэхүүний склад
    ],
  });
  // ERP-д аль хэдийн байгаа Material, үлдэгдэл: хөндөгдөх ёсгүй
  const exist = await prisma.material.create({ data: { code: `${P}EXIST`, name: "Хуучин нэр", unit: "кг", defaultPrice: 55 } });
  const res = await prisma.material.create({ data: { code: `${P}RES`, name: "Нөөцлөгдсөн", unit: "ш", defaultPrice: 1 } });
  await prisma.inventoryBalance.create({ data: { materialId: exist.id, warehouseId: wh1, quantityOnHand: 7, quantityReserved: 3 } });
  await prisma.inventoryBalance.create({ data: { materialId: res.id, warehouseId: wh2, quantityOnHand: 9, quantityReserved: 5 } });

  await prisma.onecStock.createMany({
    data: [
      row("IMP-WH1", `${P}A`, 5, 500, { item: "Болт", account: "1510" }),
      row("IMP-WH1", `${P}A`, 3, 300, { item: "Болт", account: "1520" }), // нэг склад, өөр данс: нийлбэр 8
      row("IMP-WH2", `${P}A`, 2, 220, { item: "Болт" }),
      row("IMP-WH1", `${P}B`, 4, 40, { item: "Гайк", unit: "" }), // нэгжгүй → "ш"
      row("IMP-WH1", `${P}ZERO`, 0, 0),
      row("IMP-WH1", `${P}NEG`, -3, -30),
      row("IMP-WH1", "", 1, 1), // барааны код байхгүй
      row("IMP-UNMAPPED", `${P}C`, 9, 90), // 1С склад ERP-д холбогдоогүй
      row("IMP-DUP", `${P}D`, 1, 1), // хоёр агуулах ижил кодтой: тодорхойгүй
      row("IMP-OFF", `${P}E`, 3, 30), // идэвхгүй агуулах
      row("IMP-NR", `${P}F`, 6, 60), // reservable=false склад: оруулахгүй
      row("IMP-WH1", `${P}EXIST`, 10, 100),
      row("IMP-WH2", `${P}EXIST`, 4, 40),
      row("IMP-WH2", `${P}RES`, 4, 40),
    ],
  });
});

const counts = async () => ({
  materials: await prisma.material.count({ where: { code: { startsWith: P } } }),
  balances: await prisma.inventoryBalance.count({ where: { material: { code: { startsWith: P } } } }),
});
const bal = async (code: string, warehouseId: string) => {
  const b = await prisma.inventoryBalance.findFirst({ where: { material: { code }, warehouseId } });
  return b ? { onHand: Number(b.quantityOnHand), reserved: Number(b.quantityReserved) } : null;
};

describe("importMaterials: dry-run (анхдагч)", () => {
  it("юу ч бичихгүй, харин юу болохыг зөв тоолно", async () => {
    const r = await importMaterials({ date: D });
    expect(r.apply).toBe(false);
    expect(r.snapshot).toBe(D);
    expect(r.stockRows).toBe(14 - 1); // A@WH1-ийн хоёр данс нэг мөр болно
    expect(r.mappedWarehouses).toBeGreaterThanOrEqual(3); // WH1, WH2, DUP
    expect(r.ambiguousCodes).toContain("IMP-DUP");
    expect(r.skipped).toEqual({ noItemCode: 1, unmappedWarehouse: 2, nonReservableWarehouse: 1, ambiguousWarehouse: 1, nonPositive: 2, tooLarge: 0 });
    expect(r.materials).toEqual({ existing: 2, toCreate: 2, emptyUnit: 1 });
    expect(r.balances).toEqual({ toCreate: 4, existingKept: 2, toRefresh: 0, refreshBlocked: 0 });
    expect(r.unmapped.map((u) => u.code)).toEqual(expect.arrayContaining(["IMP-UNMAPPED", "IMP-OFF"]));
    expect(r.created).toEqual({ materials: 0, balances: 0, refreshed: 0 });
    expect(await counts()).toEqual({ materials: 2, balances: 2 }); // зөвхөн урьдчилж үүсгэсэн
    expect(await prisma.onecSyncLog.count({ where: { kind: "import-materials", period: D } })).toBe(0);
    const text = describeImport(r);
    expect(text).toContain("DRY-RUN");
    expect(text).toContain("--apply");
  });

  it("snapshot-д мөр байхгүй огноо: тайлан хоосон, алдаагүй", async () => {
    const r = await importMaterials({ date: "2033-02-03" });
    expect(r.snapshot).toBe("2033-02-03");
    expect(r.stockRows).toBe(0);
    expect(r.materials.toCreate + r.balances.toCreate).toBe(0);
  });

  it("буруу огнооны хэлбэрийг татгалзана", async () => {
    await expect(importMaterials({ date: "2033-2-3" })).rejects.toThrow("YYYY-MM-DD");
    await expect(importMaterials({ date: "2033-02-30" })).rejects.toThrow("YYYY-MM-DD");
  });
});

describe("importMaterials: apply", () => {
  it("зөвхөн дутууг нэмнэ: Material код, үнэ = жигнэсэн дундаж, склад дахь үлдэгдэл = данс нэгтгэсэн нийлбэр", async () => {
    const r = await importMaterials({ apply: true, date: D });
    expect(r.created).toEqual({ materials: 2, balances: 4, refreshed: 0 });

    const a = await prisma.material.findUniqueOrThrow({ where: { code: `${P}A` } });
    expect(a).toMatchObject({ name: "Болт", unit: "ш", isActive: true, category: null });
    expect(Number(a.defaultPrice)).toBe(102); // (800 + 220) / (8 + 2)
    const b = await prisma.material.findUniqueOrThrow({ where: { code: `${P}B` } });
    expect(b.unit).toBe("ш");
    expect(Number(b.defaultPrice)).toBe(10);

    expect(await bal(`${P}A`, wh1)).toEqual({ onHand: 8, reserved: 0 });
    expect(await bal(`${P}A`, wh2)).toEqual({ onHand: 2, reserved: 0 });
    expect(await bal(`${P}B`, wh1)).toEqual({ onHand: 4, reserved: 0 });
    expect(await bal(`${P}EXIST`, wh2)).toEqual({ onHand: 4, reserved: 0 }); // байгаа Material-ийн шинэ складын үлдэгдэл
  });

  it("байгаа Material болон байгаа үлдэгдлийг ХЭЗЭЭ Ч өөрчлөхгүй", async () => {
    await importMaterials({ apply: true, date: D });
    const exist = await prisma.material.findUniqueOrThrow({ where: { code: `${P}EXIST` } });
    expect(exist).toMatchObject({ name: "Хуучин нэр", unit: "кг" });
    expect(Number(exist.defaultPrice)).toBe(55);
    expect(await bal(`${P}EXIST`, wh1)).toEqual({ onHand: 7, reserved: 3 }); // snapshot 10 гэсэн ч дарагдаагүй
    expect(await bal(`${P}RES`, wh2)).toEqual({ onHand: 9, reserved: 5 });
  });

  it("тэг, сөрөг, кодгүй, холбогдоогүй, давхар кодтой, идэвхгүй, reservable=false агуулахын мөрийг оруулахгүй", async () => {
    await importMaterials({ apply: true, date: D });
    const codes = (await prisma.material.findMany({ where: { code: { startsWith: P } }, select: { code: true } })).map((m) => m.code).sort();
    expect(codes).toEqual([`${P}A`, `${P}B`, `${P}EXIST`, `${P}RES`]);
  });

  it("дахин ажиллуулахад юу ч нэмэхгүй (idempotent) ба onec_sync_log-д бүртгэнэ", async () => {
    await importMaterials({ apply: true, date: D });
    const again = await importMaterials({ apply: true, date: D });
    expect(again.created).toEqual({ materials: 0, balances: 0, refreshed: 0 });
    expect(again.materials.toCreate).toBe(0);
    expect(again.balances.toCreate).toBe(0);
    expect(await counts()).toEqual({ materials: 4, balances: 6 });
    const logs = await prisma.onecSyncLog.findMany({ where: { kind: "import-materials", period: D }, orderBy: { id: "asc" } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ ok: true, rows: 4 });
    expect(logs[1]).toMatchObject({ ok: true, rows: 0 });
  });
});

describe("importMaterials: --refresh-balances", () => {
  it("snapshot-оор quantityOnHand-ийг шинэчилнэ; нөөцөөс бага болох мөрийг алгасна; нөөц хөндөгдөхгүй", async () => {
    await importMaterials({ apply: true, date: D }); // эхлээд дутууг нөхнө
    const dry = await importMaterials({ date: D, refreshBalances: true });
    expect(dry.balances).toMatchObject({ toRefresh: 1, refreshBlocked: 1 }); // EXIST@WH1 (7→10), RES@WH2 (нөөц 5 > snapshot 4)
    expect(await bal(`${P}EXIST`, wh1)).toEqual({ onHand: 7, reserved: 3 }); // dry-run бичээгүй

    const r = await importMaterials({ apply: true, date: D, refreshBalances: true });
    expect(r.created.refreshed).toBe(1);
    expect(await bal(`${P}EXIST`, wh1)).toEqual({ onHand: 10, reserved: 3 });
    expect(await bal(`${P}RES`, wh2)).toEqual({ onHand: 9, reserved: 5 }); // алгассан
    expect(await bal(`${P}A`, wh1)).toEqual({ onHand: 8, reserved: 0 });
  });
});
