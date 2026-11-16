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
  it("defines the confirmed structure: 4 keeper groups + 1 keeper-less group, 1С codes unique", () => {
    expect(WAREHOUSE_STRUCTURE.map((t) => t.name)).toEqual(["Болд", "Ууганцэцэг (хангамж)", "Сарангэрэл", "Боогий", "Нярваргүй агуулахууд"]);
    expect(WAREHOUSE_STRUCTURE.map((t) => t.locations.length)).toEqual([5, 5, 8, 1, 3]);
    const codes = allLocations.map((l) => l.onecCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain("");
    // finished-goods warehouses are not reservable and must not be seeded as ordinary warehouses
    for (const c of ["00-000010", "00-000030", "00-000003"]) expect(codes).not.toContain(c);
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
