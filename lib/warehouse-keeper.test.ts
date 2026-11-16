import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { departmentApprove, warehouseCheck } from "./workflow";
import { setKeeperMode, getKeeperMode } from "./warehouse-settings";
import { assignWarehouseKeeper } from "./warehouse-keeper-admin";
import { allocateAcrossBalances, orderBalances, totalFree, type BalanceRow } from "./warehouse-allocation";

// Only the session lookup is replaced; the routes, authorization and queries run for real against the isolated test DB.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { POST as CREATE_REQUEST } from "@/app/api/requests/route";
import { PATCH as PATCH_SETTINGS } from "@/app/api/admin/settings/route";
import { PATCH as PATCH_WAREHOUSE } from "@/app/api/admin/warehouses/[id]/route";

const P = "wk-";
const PIN = "1234";
const PRIMARY_KEEPER = "u-sarnai"; // the seeded STOREKEEPER_LEAD holder

const DEPT = `${P}dept`;
const HEAD = `${P}head`;
const EMP = `${P}emp`;
const ADMIN = `${P}admin`;
const KEEPER_A = `${P}keeper-a`;
const KEEPER_B = `${P}keeper-b`;
const TOP_A = `${P}top-a`;
const TOP_B = `${P}top-b`;
const TOP_C = `${P}top-c`; // no keeper
const LOC_A = `${P}loc-a`;
const LOC_B = `${P}loc-b`;
const LOC_C = `${P}loc-c`;
const LOC_OFF = `${P}loc-off`; // inactive warehouse
const M = {
  a: `${P}mat-a`, // stock only in loc A
  b: `${P}mat-b`, // stock only in loc B
  c: `${P}mat-c`, // stock only in the keeper-less warehouse
  none: `${P}mat-none`, // no stock anywhere
  multi: `${P}mat-multi`, // 4 in A (priority 50), 5 in B (priority 60)
  off: `${P}mat-off`, // stock only in the inactive warehouse
  race: `${P}mat-race`, // 5 in A
};

const as = (id: string | null, role = "EMPLOYEE") => {
  session.current = id ? { user: { id, role, departmentId: id === EMP ? DEPT : null, name: id, email: `${id}@t.local` } } : null;
};

const createRequest = async (materialId: string, quantity = 1) => {
  as(EMP);
  const res = await CREATE_REQUEST(
    new Request("http://localhost/api/requests", {
      method: "POST",
      body: JSON.stringify({ departmentId: DEPT, items: [{ materialId, materialName: "wk", unit: "ш", requestedQuantity: quantity, unitPrice: 100 }] }),
    })
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.id as string;
};

const step2 = async (requestId: string) =>
  prisma.approvalStep.findFirstOrThrow({ where: { requestId, type: "WAREHOUSE_CHECK" } });

async function cleanup() {
  const requests = await prisma.materialRequest.findMany({ where: { requestedById: EMP }, select: { id: true, items: { select: { id: true } } } });
  const ids = requests.map((r) => r.id);
  const itemIds = requests.flatMap((r) => r.items.map((i) => i.id));
  const reservations = await prisma.stockReservation.findMany({ where: { requestItemId: { in: itemIds } }, select: { id: true } });
  await prisma.stockIssue.deleteMany({ where: { reservationId: { in: reservations.map((r) => r.id) } } });
  await prisma.stockReservation.deleteMany({ where: { requestItemId: { in: itemIds } } });
  await prisma.warehouseCheckItem.deleteMany({ where: { requestItemId: { in: itemIds } } });
  await prisma.warehouseCheck.deleteMany({ where: { requestId: { in: ids } } });
  await prisma.approvalAction.deleteMany({ where: { approvalStep: { requestId: { in: ids } } } });
  await prisma.notification.deleteMany({ where: { OR: [{ relatedRequestId: { in: ids } }, { userId: { startsWith: P } }] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: ids } }, { actorId: { startsWith: P } }, { entityId: { startsWith: P } }] } });
  await prisma.materialRequest.deleteMany({ where: { id: { in: ids } } });
  await prisma.inventoryBalance.deleteMany({ where: { materialId: { startsWith: P } } });
  await prisma.material.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.warehouse.updateMany({ where: { id: { startsWith: P } }, data: { keeperId: null } });
  await prisma.warehouse.deleteMany({ where: { id: { startsWith: P }, parentId: { not: null } } });
  await prisma.warehouse.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.department.updateMany({ where: { id: DEPT }, data: { headId: null } });
  await prisma.department.deleteMany({ where: { id: DEPT } });
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

async function setStock(materialId: string, warehouseId: string, quantityOnHand: number) {
  await prisma.inventoryBalance.upsert({
    where: { materialId_warehouseId: { materialId, warehouseId } },
    update: { quantityOnHand },
    create: { materialId, warehouseId, quantityOnHand },
  });
}

beforeAll(async () => {
  await cleanup();
  await prisma.department.create({ data: { id: DEPT, name: "wk dept", type: "FACTORY" } });
  const users: [string, string][] = [[HEAD, "BOSS"], [EMP, "EMPLOYEE"], [ADMIN, "ADMIN"], [KEEPER_A, "STOREKEEPER"], [KEEPER_B, "STOREKEEPER"]];
  for (const [id, role] of users) {
    await prisma.user.create({
      data: { id, email: `${id}@test.local`, name: id, role: role as never, passwordHash: "x", departmentId: id === EMP || id === HEAD ? DEPT : null },
    });
  }
  await prisma.department.update({ where: { id: DEPT }, data: { headId: HEAD } });
  const pinHash = await bcrypt.hash(PIN, 10);
  for (const userId of [HEAD, KEEPER_A, KEEPER_B, PRIMARY_KEEPER]) {
    await prisma.approvalPinCredential.upsert({ where: { userId }, update: { pinHash, failedAttempts: 0, lockedUntil: null }, create: { userId, pinHash } });
  }

  await prisma.warehouse.createMany({
    data: [
      { id: TOP_A, name: "wk A", keeperId: KEEPER_A },
      { id: TOP_B, name: "wk B", keeperId: KEEPER_B },
      { id: TOP_C, name: "wk C" },
    ],
  });
  await prisma.warehouse.createMany({
    data: [
      { id: LOC_A, name: "wk loc A", parentId: TOP_A, sortPriority: 50 },
      { id: LOC_B, name: "wk loc B", parentId: TOP_B, sortPriority: 60 },
      { id: LOC_C, name: "wk loc C", parentId: TOP_C, sortPriority: 70 },
      { id: LOC_OFF, name: "wk off", parentId: TOP_A, sortPriority: 1, isActive: false },
    ],
  });
  await prisma.material.createMany({ data: Object.values(M).map((id) => ({ id, code: id, name: id, unit: "ш", defaultPrice: 100 })) });
  await setStock(M.a, LOC_A, 20);
  await setStock(M.b, LOC_B, 20);
  await setStock(M.c, LOC_C, 20);
  await setStock(M.multi, LOC_A, 4);
  await setStock(M.multi, LOC_B, 5);
  await setStock(M.off, LOC_OFF, 9);
  await setStock(M.race, LOC_A, 5);
  await prisma.systemSetting.deleteMany({ where: { key: "step2_keeper_mode" } });
});

afterAll(async () => {
  await prisma.systemSetting.deleteMany({ where: { key: "step2_keeper_mode" } });
  await cleanup();
});

const row = (id: string, warehouseId: string, onHand: number, sortPriority: number, reserved = 0): BalanceRow => ({
  id,
  materialId: "m",
  warehouseId,
  quantityOnHand: onHand,
  quantityReserved: reserved,
  sortPriority,
});

describe("allocation order (pure)", () => {
  it("orders by priority, then the larger free quantity, then warehouse id", () => {
    const ordered = orderBalances([row("1", "w-z", 5, 100), row("2", "w-y", 9, 100), row("3", "w-a", 1, 10), row("4", "w-b", 9, 100)]);
    // "2" and "4" tie on priority and free quantity, so the lower warehouse id (w-b) goes first
    expect(ordered.map((r) => r.id)).toEqual(["3", "4", "2", "1"]);
  });

  it("counts free (on hand minus reserved) stock, never negative", () => {
    expect(totalFree([row("1", "a", 5, 1, 2), row("2", "b", 1, 1, 4)])).toBe(3);
  });

  it("splits a line across warehouses in order and tracks what earlier lines consumed", () => {
    const rows = orderBalances([row("1", "a", 4, 10), row("2", "b", 5, 20)]);
    const consumed = new Map<string, number>();
    const first = allocateAcrossBalances(rows, 6, consumed);
    expect(first.map((a) => [a.warehouseId, a.quantity])).toEqual([["a", 4], ["b", 2]]);
    const second = allocateAcrossBalances(rows, 6, consumed);
    expect(second.map((a) => [a.warehouseId, a.quantity])).toEqual([["b", 3]]);
  });
});

describe("step 2 keeper selection (POST /api/requests)", () => {
  it("defaults to the PRIMARY mode: every request goes to the primary keeper", async () => {
    expect(await getKeeperMode()).toBe("PRIMARY");
    const id = await createRequest(M.b);
    expect((await step2(id)).assignedUserId).toBe(PRIMARY_KEEPER);
  });

  it("BY_WAREHOUSE: goes to the keeper of the warehouse that holds the material", async () => {
    await prisma.$transaction((tx) => setKeeperMode(tx, "BY_WAREHOUSE", ADMIN));
    expect((await step2(await createRequest(M.a))).assignedUserId).toBe(KEEPER_A);
    expect((await step2(await createRequest(M.b))).assignedUserId).toBe(KEEPER_B);
  });

  it("BY_WAREHOUSE: a warehouse without a keeper falls back to the primary keeper and is audited", async () => {
    const id = await createRequest(M.c);
    expect((await step2(id)).assignedUserId).toBe(PRIMARY_KEEPER);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, afterJson: { contains: "STOREKEEPER_FALLBACK" } } });
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ reason: "NO_KEEPER", warehouseId: TOP_C, assignedUserId: PRIMARY_KEEPER });
  });

  it("BY_WAREHOUSE: a material with no stock anywhere falls back to the primary keeper", async () => {
    const id = await createRequest(M.none);
    expect((await step2(id)).assignedUserId).toBe(PRIMARY_KEEPER);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, afterJson: { contains: "STOREKEEPER_FALLBACK" } } });
    expect(JSON.parse(audit.afterJson!).reason).toBe("NO_STOCK");
  });

  it("BY_WAREHOUSE: an inactive or non-storekeeper keeper is not used", async () => {
    await prisma.user.update({ where: { id: KEEPER_A }, data: { isActive: false } });
    try {
      const id = await createRequest(M.a);
      expect((await step2(id)).assignedUserId).toBe(PRIMARY_KEEPER);
    } finally {
      await prisma.user.update({ where: { id: KEEPER_A }, data: { isActive: true } });
    }
  });

  it("an inactive warehouse is ignored when choosing the keeper", async () => {
    expect((await step2(await createRequest(M.off))).assignedUserId).toBe(PRIMARY_KEEPER);
  });

  it("switching back to PRIMARY restores the single-keeper routing", async () => {
    await prisma.$transaction((tx) => setKeeperMode(tx, "PRIMARY", ADMIN));
    expect((await step2(await createRequest(M.a))).assignedUserId).toBe(PRIMARY_KEEPER);
  });
});

describe("keeper authorization", () => {
  it("a keeper of another warehouse cannot decide this request's warehouse check (403); the assigned keeper can", async () => {
    await prisma.$transaction((tx) => setKeeperMode(tx, "BY_WAREHOUSE", ADMIN));
    const id = await createRequest(M.a, 2);
    const head = await departmentApprove(id, HEAD, PIN, 1);
    expect(head.ok).toBe(true);
    const item = await prisma.materialRequestItem.findFirstOrThrow({ where: { requestId: id } });

    const wrong = await warehouseCheck(id, KEEPER_B, [{ requestItemId: item.id, availableQuantity: 2 }], PIN, 2);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.status).toBe(403);

    const right = await warehouseCheck(id, KEEPER_A, [{ requestItemId: item.id, availableQuantity: 2 }], PIN, 2);
    expect(right.ok).toBe(true);
    // the keeper's decision is final: a fully covered request completes, there is no senior-keeper step
    if (right.ok) expect(right.request.status).toBe("COMPLETED");
    await prisma.$transaction((tx) => setKeeperMode(tx, "PRIMARY", ADMIN));
  });
});

describe("reservation across warehouses", () => {
  it("shows the free stock of all active warehouses and reserves exactly that, split in priority order", async () => {
    const id = await createRequest(M.multi, 12);
    const item = await prisma.materialRequestItem.findFirstOrThrow({ where: { requestId: id } });
    expect(Number(item.warehouseBalanceAtRequest)).toBe(9); // 4 + 5, same rows the reservation uses
    expect((await departmentApprove(id, HEAD, PIN, 1)).ok).toBe(true);

    const result = await warehouseCheck(id, PRIMARY_KEEPER, [{ requestItemId: item.id, availableQuantity: 12 }], PIN, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.items[0].allocatedQuantity).toBe(9);
    expect(result.request.items[0].missingQuantity).toBe(3);

    const reservations = await prisma.stockReservation.findMany({ where: { requestItemId: item.id }, orderBy: { quantity: "asc" } });
    expect(reservations.map((r) => [r.warehouseId, Number(r.quantity), r.status])).toEqual([
      [LOC_A, 4, "ISSUED"],
      [LOC_B, 5, "ISSUED"],
    ]);
    const balances = await prisma.inventoryBalance.findMany({ where: { materialId: M.multi } });
    expect(balances.every((b) => Number(b.quantityOnHand) === 0)).toBe(true);
    expect(await prisma.stockIssue.count({ where: { reservation: { requestItemId: item.id } } })).toBe(2);
  });

  it("partial: takes from the first warehouse before touching the next", async () => {
    await setStock(M.multi, LOC_A, 4);
    await setStock(M.multi, LOC_B, 5);
    const id = await createRequest(M.multi, 6);
    const item = await prisma.materialRequestItem.findFirstOrThrow({ where: { requestId: id } });
    await departmentApprove(id, HEAD, PIN, 1);
    const result = await warehouseCheck(id, PRIMARY_KEEPER, [{ requestItemId: item.id, availableQuantity: 6 }], PIN, 2);
    expect(result.ok).toBe(true);
    const byWarehouse = Object.fromEntries(
      (await prisma.stockReservation.findMany({ where: { requestItemId: item.id } })).map((r) => [r.warehouseId, Number(r.quantity)])
    );
    expect(byWarehouse).toEqual({ [LOC_A]: 4, [LOC_B]: 2 });
  });

  it("never reserves from an inactive warehouse, and the shown stock excludes it too", async () => {
    const id = await createRequest(M.off, 3);
    const item = await prisma.materialRequestItem.findFirstOrThrow({ where: { requestId: id } });
    expect(Number(item.warehouseBalanceAtRequest)).toBe(0);
    await departmentApprove(id, HEAD, PIN, 1);
    const result = await warehouseCheck(id, PRIMARY_KEEPER, [{ requestItemId: item.id, availableQuantity: 3 }], PIN, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.items[0].allocatedQuantity).toBe(0);
    expect(await prisma.stockReservation.count({ where: { requestItemId: item.id } })).toBe(0);
  });

  it("two requests racing for the same stock cannot reserve it twice", async () => {
    const prepare = async () => {
      const id = await createRequest(M.race, 5);
      const item = await prisma.materialRequestItem.findFirstOrThrow({ where: { requestId: id } });
      await departmentApprove(id, HEAD, PIN, 1);
      return { id, itemId: item.id };
    };
    const [r1, r2] = [await prepare(), await prepare()];
    const results = await Promise.all([
      warehouseCheck(r1.id, PRIMARY_KEEPER, [{ requestItemId: r1.itemId, availableQuantity: 5 }], PIN, 2),
      warehouseCheck(r2.id, PRIMARY_KEEPER, [{ requestItemId: r2.itemId, availableQuantity: 5 }], PIN, 2),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const reserved = await prisma.stockReservation.aggregate({ _sum: { quantity: true }, where: { requestItemId: { in: [r1.itemId, r2.itemId] } } });
    expect(Number(reserved._sum.quantity)).toBe(5);
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { materialId_warehouseId: { materialId: M.race, warehouseId: LOC_A } } });
    expect(Number(balance.quantityOnHand)).toBe(0);
  });
});

describe("admin: keepers and mode", () => {
  const patchWarehouse = (id: string, body: unknown) =>
    PATCH_WAREHOUSE(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

  it("only an admin can change the mode or a keeper", async () => {
    as(EMP);
    expect((await PATCH_SETTINGS(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ keeperMode: "BY_WAREHOUSE" }) }))).status).toBe(403);
    expect((await patchWarehouse(TOP_C, { keeperId: KEEPER_A })).status).toBe(403);
  });

  it("an admin switches the mode, and it is audited", async () => {
    as(ADMIN, "ADMIN");
    const res = await PATCH_SETTINGS(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ keeperMode: "BY_WAREHOUSE" }) }));
    expect(res.status).toBe(200);
    expect(await getKeeperMode()).toBe("BY_WAREHOUSE");
    expect(await prisma.auditLog.count({ where: { entityType: "SystemSetting", actorId: ADMIN } })).toBeGreaterThan(0);
    const bad = await PATCH_SETTINGS(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ keeperMode: "NOPE" }) }));
    expect(bad.status).toBe(400);
    await prisma.$transaction((tx) => setKeeperMode(tx, "PRIMARY", ADMIN));
  });

  it("a keeper must be an active STOREKEEPER and only top-level warehouses have one", async () => {
    as(ADMIN, "ADMIN");
    expect((await patchWarehouse(TOP_C, { keeperId: HEAD })).status).toBe(400); // BOSS, not STOREKEEPER
    expect((await patchWarehouse(LOC_C, { keeperId: KEEPER_A })).status).toBe(400); // a location
    expect((await patchWarehouse("nope", { keeperId: KEEPER_A })).status).toBe(404);
  });

  it("assigning a keeper writes the audit/grant records; the new keeper starts getting that warehouse's requests", async () => {
    as(ADMIN, "ADMIN");
    expect((await patchWarehouse(TOP_C, { keeperId: KEEPER_B })).status).toBe(200);
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: TOP_C } })).keeperId).toBe(KEEPER_B);
    expect(await prisma.auditLog.count({ where: { entityType: "Warehouse", entityId: TOP_C, actorId: ADMIN } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { userId: KEEPER_B, title: "Таны эрх, албан тушаал өөрчлөгдлөө" } })).toBeGreaterThan(0);

    await prisma.$transaction((tx) => setKeeperMode(tx, "BY_WAREHOUSE", ADMIN));
    expect((await step2(await createRequest(M.c))).assignedUserId).toBe(KEEPER_B);
    await prisma.$transaction((tx) => setKeeperMode(tx, "PRIMARY", ADMIN));
  });

  it("replacing a keeper re-points the open warehouse checks, and the outgoing keeper is locked out", async () => {
    await prisma.$transaction((tx) => setKeeperMode(tx, "BY_WAREHOUSE", ADMIN));
    const id = await createRequest(M.b, 1);
    await departmentApprove(id, HEAD, PIN, 1);
    expect((await step2(id)).assignedUserId).toBe(KEEPER_B);
    await prisma.$transaction((tx) => setKeeperMode(tx, "PRIMARY", ADMIN));

    // KEEPER_B now also keeps TOP_C (above); free it so the replacement is a plain hand-over
    await prisma.warehouse.update({ where: { id: TOP_C }, data: { keeperId: null } });
    // earlier tests left other open checks with KEEPER_B: they move too
    const open = await prisma.approvalStep.count({
      where: { type: "WAREHOUSE_CHECK", status: "PENDING", assignedUserId: KEEPER_B, request: { status: { in: ["PENDING_DEPARTMENT_APPROVAL", "PENDING_WAREHOUSE_CHECK"] } } },
    });
    expect(open).toBeGreaterThanOrEqual(1);
    const moved = await assignWarehouseKeeper(TOP_B, KEEPER_A, ADMIN);
    expect(moved).toMatchObject({ ok: true, changed: true, repointed: open });
    expect((await step2(id)).assignedUserId).toBe(KEEPER_A);

    const item = await prisma.materialRequestItem.findFirstOrThrow({ where: { requestId: id } });
    const old = await warehouseCheck(id, KEEPER_B, [{ requestItemId: item.id, availableQuantity: 1 }], PIN, 2);
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.status).toBe(403);
    expect(await prisma.notification.count({ where: { userId: KEEPER_A, relatedRequestId: id, type: "WAREHOUSE_CHECK_NEEDED" } })).toBe(1);
  });

  it("does not re-point steps away from the primary keeper", async () => {
    const id = await createRequest(M.a, 1);
    await departmentApprove(id, HEAD, PIN, 1);
    // the primary keeper (not a warehouse keeper) is replaced as keeper of a warehouse: its own steps stay
    await prisma.warehouse.update({ where: { id: TOP_C }, data: { keeperId: PRIMARY_KEEPER } });
    const res = await assignWarehouseKeeper(TOP_C, KEEPER_A, ADMIN);
    expect(res).toMatchObject({ ok: true, repointed: 0 });
    expect((await step2(id)).assignedUserId).toBe(PRIMARY_KEEPER);
  });
});
