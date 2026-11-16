import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OBSOLETE_WAREHOUSE_IDS, WAREHOUSE_STRUCTURE, seedWarehouseStructure } from "./warehouse-structure";

// vitest.setup.ts points DATABASE_URL at the isolated test database before this client is created.
const prisma = new PrismaClient();
const MAT = "wsx-mat";

const allLocations = WAREHOUSE_STRUCTURE.flatMap((t) => t.locations.map((l) => ({ ...l, topId: t.id })));

beforeAll(async () => {
  await prisma.material.upsert({ where: { id: MAT }, update: {}, create: { id: MAT, code: MAT, name: MAT, unit: "ш", defaultPrice: 1 } });
});
afterAll(async () => {
  await prisma.inventoryBalance.deleteMany({ where: { materialId: MAT } });
  await prisma.material.deleteMany({ where: { id: MAT } });
  await prisma.warehouse.deleteMany({ where: { id: { in: OBSOLETE_WAREHOUSE_IDS }, inventoryBalances: { none: {} } } });
  await prisma.$disconnect();
});

describe("warehouse structure seed (1С warehouses)", () => {
  it("defines the confirmed structure: 4 keeper groups (named by what they hold, never by a person), a keeper-less group, a finished-goods group; 1С codes unique", () => {
    expect(WAREHOUSE_STRUCTURE.map((t) => t.name)).toEqual([
      "Механик, арматур, силос",
      "Хангамж, засвар",
      "Төмөр бетон, БАЗ",
      "Цайны газар",
      "Нярваргүй агуулахууд",
      "Бэлэн бүтээгдэхүүн (нөөцлөхгүй)",
    ]);
    expect(WAREHOUSE_STRUCTURE.map((t) => t.locations.length)).toEqual([5, 5, 8, 1, 3, 3]);
    const codes = allLocations.map((l) => l.onecCode);
    expect(new Set(codes).size).toBe(25);
    expect(codes).not.toContain("");
  });

  it("only the three finished-goods warehouses are not reservable", async () => {
    await seedWarehouseStructure(prisma);
    const notReservable = await prisma.warehouse.findMany({ where: { reservable: false, id: { in: allLocations.map((l) => l.id) } }, select: { onecCode: true } });
    expect(notReservable.map((w) => w.onecCode).sort()).toEqual(["00-000003", "00-000010", "00-000030"]);
    // and they stay visible: active, with their keeper-less group
    expect(await prisma.warehouse.count({ where: { onecCode: { in: ["00-000003", "00-000010", "00-000030"] }, isActive: true, parent: { keeperId: null } } })).toBe(3);
  });

  it("creates every 1С warehouse under its keeper group with its code, and the groups carry no code", async () => {
    await seedWarehouseStructure(prisma);
    for (const l of allLocations) {
      const row = await prisma.warehouse.findUniqueOrThrow({ where: { id: l.id } });
      expect(row).toMatchObject({ name: l.name, onecCode: l.onecCode, parentId: l.topId, isActive: true });
    }
    for (const t of WAREHOUSE_STRUCTURE) {
      expect(await prisma.warehouse.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ parentId: null, onecCode: null, name: t.name });
    }
    // exactly two levels
    expect(await prisma.warehouse.count({ where: { id: { in: allLocations.map((l) => l.id) }, parent: { parentId: { not: null } } } })).toBe(0);
  });

  it("re-uses the existing central warehouse: Хангамжийн агуулах, priority 10, stock untouched", async () => {
    await prisma.inventoryBalance.upsert({
      where: { materialId_warehouseId: { materialId: MAT, warehouseId: "w-central" } },
      update: { quantityOnHand: 7 },
      create: { materialId: MAT, warehouseId: "w-central", quantityOnHand: 7 },
    });
    const before = await prisma.inventoryBalance.count({ where: { warehouseId: "w-central" } });
    await seedWarehouseStructure(prisma);
    const central = await prisma.warehouse.findUniqueOrThrow({ where: { id: "w-central" } });
    expect(central).toMatchObject({ name: "Хангамжийн агуулах", onecCode: "00-000002", parentId: "w-uuganzetseg", sortPriority: 10, slug: "tov-aguulah" });
    expect(await prisma.inventoryBalance.count({ where: { warehouseId: "w-central" } })).toBe(before);
    expect(Number((await prisma.inventoryBalance.findFirstOrThrow({ where: { materialId: MAT, warehouseId: "w-central" } })).quantityOnHand)).toBe(7);
  });

  it("is idempotent and never overwrites an administrator's keeper or priority", async () => {
    const original = (await prisma.warehouse.findUniqueOrThrow({ where: { id: "w-uuganzetseg" } })).keeperId;
    await prisma.warehouse.update({ where: { id: "w-uuganzetseg" }, data: { keeperId: null } });
    await prisma.warehouse.update({ where: { id: "w-1c-00-000005" }, data: { sortPriority: 42 } });
    const count = await prisma.warehouse.count();
    await seedWarehouseStructure(prisma, { uuganzetsegKeeperId: "u-sarnai" });
    await seedWarehouseStructure(prisma, { uuganzetsegKeeperId: "u-sarnai" });
    expect(await prisma.warehouse.count()).toBe(count);
    // keepers are written only when a row is created: the cleared keeper stays cleared, the priority stays 42
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: "w-uuganzetseg" } })).keeperId).toBeNull();
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: "w-1c-00-000005" } })).sortPriority).toBe(42);
    await prisma.warehouse.update({ where: { id: "w-uuganzetseg" }, data: { keeperId: original } });
    await prisma.warehouse.update({ where: { id: "w-1c-00-000005" }, data: { sortPriority: 100 } });
  });

  it("renames the groups that carried a person's name, touching only the name (slug, parent, code, keeper, priority, stock stay)", async () => {
    const OLD: Record<string, string> = { "w-bold": "Болд", "w-uuganzetseg": "Ууганцэцэг (хангамж)", "w-sarangerel": "Сарангэрэл", "w-boogii": "Боогий" };
    const keeper = (await prisma.user.findFirstOrThrow({ where: { role: "STOREKEEPER" }, select: { id: true } })).id;
    const ids = Object.keys(OLD);
    const originals = await prisma.warehouse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, keeperId: true, sortPriority: true } });
    // the state production is in today: the old names, an administrator-assigned keeper and priority, stock on a 1С warehouse
    for (const id of ids) await prisma.warehouse.update({ where: { id }, data: { name: OLD[id], keeperId: keeper, sortPriority: 77 } });
    await prisma.inventoryBalance.upsert({
      where: { materialId_warehouseId: { materialId: MAT, warehouseId: "w-1c-00-000005" } },
      update: { quantityOnHand: 9 },
      create: { materialId: MAT, warehouseId: "w-1c-00-000005", quantityOnHand: 9 },
    });
    const snapshot = async () => (await prisma.warehouse.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })).map((w) => ({ id: w.id, slug: w.slug, parentId: w.parentId, onecCode: w.onecCode, keeperId: w.keeperId, sortPriority: w.sortPriority, isActive: w.isActive, reservable: w.reservable }));
    const before = await snapshot();

    await seedWarehouseStructure(prisma);
    await seedWarehouseStructure(prisma); // idempotent

    const names = Object.fromEntries((await prisma.warehouse.findMany({ where: { id: { in: ids } } })).map((w) => [w.id, w.name]));
    expect(names).toEqual({ "w-bold": "Механик, арматур, силос", "w-uuganzetseg": "Хангамж, засвар", "w-sarangerel": "Төмөр бетон, БАЗ", "w-boogii": "Цайны газар" });
    for (const person of Object.values(OLD)) expect(Object.values(names)).not.toContain(person);
    expect(await snapshot()).toEqual(before); // everything but the name is as it was
    expect(Number((await prisma.inventoryBalance.findFirstOrThrow({ where: { materialId: MAT, warehouseId: "w-1c-00-000005" } })).quantityOnHand)).toBe(9);

    for (const o of originals) await prisma.warehouse.update({ where: { id: o.id }, data: { keeperId: o.keeperId, sortPriority: o.sortPriority } });
    await prisma.inventoryBalance.deleteMany({ where: { materialId: MAT, warehouseId: "w-1c-00-000005" } });
  });

  it("assigns no keeper user by default (production: the admin UI does it)", async () => {
    await seedWarehouseStructure(prisma);
    for (const t of WAREHOUSE_STRUCTURE) if (t.keeper === undefined) expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: t.id } })).keeperId).toBeNull();
  });

  it("removes the invented locations only when nothing refers to them", async () => {
    await prisma.warehouse.upsert({ where: { id: "w-bold-meh" }, update: {}, create: { id: "w-bold-meh", name: "Механик цех 1, 2", parentId: "w-bold" } });
    await prisma.warehouse.upsert({ where: { id: "w-zasvar" }, update: {}, create: { id: "w-zasvar", name: "Засвар", parentId: "w-uuganzetseg" } });
    await prisma.inventoryBalance.upsert({
      where: { materialId_warehouseId: { materialId: MAT, warehouseId: "w-bold-meh" } },
      update: {},
      create: { materialId: MAT, warehouseId: "w-bold-meh", quantityOnHand: 3 },
    });
    const result = await seedWarehouseStructure(prisma);
    expect(result.removed).toContain("w-zasvar");
    expect(result.kept).toContain("w-bold-meh");
    expect(await prisma.warehouse.findUnique({ where: { id: "w-zasvar" } })).toBeNull();
    expect(Number((await prisma.inventoryBalance.findFirstOrThrow({ where: { warehouseId: "w-bold-meh" } })).quantityOnHand)).toBe(3);
  });
});
