import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { recordAccountingEntry } from "./workflow";
import {
  classifyProcurement,
  completeProcurement,
  getProcurementDetail,
  getProcurementManagers,
  listProcurement,
  procurementCounts,
  reassignItem,
  recordPurchase,
  voidPurchase,
} from "./procurement";

// Domestic / International assignment on top of Manager procurement, against the
// isolated test database. Requests are built directly in PENDING_PROCUREMENT with
// a warehouse check (the earlier stages are covered by procurement.test.ts and
// workflow.test.ts). The two procurement positions are configured here and the
// previous configuration is restored afterwards.
const TAG = Date.now().toString(36);
const P = "pa-";
const ids = {
  dept: `${P}dept-${TAG}`,
  mgrA: `${P}mgr-a`, // domestic
  mgrB: `${P}mgr-b`, // international
  mgrA2: `${P}mgr-a2`, // replacement for A
  mgrC: `${P}mgr-c`, // a MANAGER who holds neither position
  emp: `${P}emp`,
  acct: `${P}acct`,
  store: `${P}store`,
  admin: `${P}admin`,
};
const POSITIONS = ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] as const;
let previouslyActive: { id: string }[] = [];
let counter = 0;

async function cleanup() {
  const mine = { requestNumber: { startsWith: "PA-" } };
  await prisma.procurementPurchase.deleteMany({ where: { requestItem: { request: mine } } });
  await prisma.warehouseCheck.deleteMany({ where: { request: mine } });
  await prisma.accountingRecord.deleteMany({ where: { request: mine } });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: mine });
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.updateMany({ where: { id: { startsWith: P } }, data: { departmentId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  previouslyActive = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: [...POSITIONS] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: false, endedAt: new Date() } });

  await prisma.department.create({ data: { id: ids.dept, name: `PA${TAG} dept`, type: "FACTORY" } });
  const users: [string, "MANAGER" | "EMPLOYEE" | "CHIEF_ACCOUNTANT" | "STOREKEEPER" | "ADMIN"][] = [
    [ids.mgrA, "MANAGER"], [ids.mgrB, "MANAGER"], [ids.mgrA2, "MANAGER"], [ids.mgrC, "MANAGER"],
    [ids.emp, "EMPLOYEE"], [ids.acct, "CHIEF_ACCOUNTANT"], [ids.store, "STOREKEEPER"], [ids.admin, "ADMIN"],
  ];
  for (const [id, role] of users) {
    await prisma.user.upsert({
      where: { id },
      update: { role, isActive: true, departmentId: id === ids.emp ? ids.dept : null },
      create: { id, email: `${id}@test.local`, name: id, role, passwordHash: "x", departmentId: id === ids.emp ? ids.dept : null },
    });
  }
});

afterAll(async () => {
  await cleanup();
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: true, endedAt: null } });
});

/** Replaces the two positions exactly like POST /api/admin/approval-roles (old holder soft-ended). */
async function configure(domestic: string | null, international: string | null) {
  await prisma.approvalRoleAssignment.updateMany({ where: { role: { in: [...POSITIONS] }, isActive: true }, data: { isActive: false, endedAt: new Date() } });
  if (domestic) await prisma.approvalRoleAssignment.create({ data: { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: domestic } });
  if (international) await prisma.approvalRoleAssignment.create({ data: { role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: international } });
}

type K = "cement" | "bearing" | "nozzle" | "washer" | "bolt";
interface Built {
  requestId: string;
  requestNumber: string;
  item: Record<K, string>;
}

/** cement 20, bearing 12, nozzle 4 to buy; washer 6 fully issued from stock; bolt 10 with 4 issued (6 to buy). */
async function procurementRequest(): Promise<Built> {
  counter += 1;
  const requestNumber = `PA-${TAG}-${counter}`;
  const spec: Record<K, { requested: number; issued: number }> = {
    cement: { requested: 20, issued: 0 },
    bearing: { requested: 12, issued: 0 },
    nozzle: { requested: 4, issued: 0 },
    washer: { requested: 6, issued: 6 },
    bolt: { requested: 10, issued: 4 },
  };
  const keys = Object.keys(spec) as K[];
  const types = ["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL"] as const;
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber,
      year: 9999,
      sequence: counter,
      departmentId: ids.dept,
      requestedById: ids.emp,
      status: "PENDING_PROCUREMENT",
      version: 5,
      items: {
        create: keys.map((k, i) => ({ lineNo: i + 1, unit: "ш", requestedQuantity: spec[k].requested, unitPrice: 100, totalPrice: spec[k].requested * 100, manualMaterialName: `PA${TAG} ${k}` })),
      },
      approvalSteps: {
        create: [
          ...types.map((type, i) => ({ type, sequence: i + 1, status: "APPROVED" as const, assignedUserId: ids.store })),
          { type: "MANAGER_PROCUREMENT" as const, sequence: 6, status: "PENDING" as const, assignedUserId: null },
          { type: "ACCOUNTING_RECORD" as const, sequence: 7, status: "PENDING" as const, assignedUserId: ids.acct },
        ],
      },
    },
    include: { items: { orderBy: { lineNo: "asc" } } },
  });
  const item = {} as Record<K, string>;
  const check = await prisma.warehouseCheck.create({ data: { requestId: created.id, checkedById: ids.store } });
  for (const [i, k] of keys.entries()) {
    item[k] = created.items[i].id;
    await prisma.warehouseCheckItem.create({
      data: { warehouseCheckId: check.id, requestItemId: item[k], availableQuantity: spec[k].issued, allocatedQuantity: spec[k].issued, missingQuantity: spec[k].requested - spec[k].issued },
    });
  }
  return { requestId: created.id, requestNumber, item };
}

const buy = (b: Built, who: string, k: K, quantity: number, unitPrice = 100, key?: string) =>
  recordPurchase(b.requestId, who, { itemId: b.item[k], quantity, unitPrice, clientRequestId: key });
const classify = (b: Built, who = ids.mgrB, international: K[] = ["bearing", "nozzle"]) => classifyProcurement(b.requestId, who, international.map((k) => b.item[k]));
const classified = async () => {
  await configure(ids.mgrA, ids.mgrB);
  const b = await procurementRequest();
  const r = await classify(b);
  if (!r.ok) throw new Error(r.error);
  return b;
};
const statusOf = async (b: Built) => (await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } })).status;
const assignmentOf = (b: Built, k: K) => prisma.procurementItemAssignment.findUnique({ where: { requestItemId: b.item[k] } });
const purchaseRows = (b: Built, k: K) => prisma.procurementPurchase.count({ where: { requestItemId: b.item[k] } });

describe("configuration", () => {
  it("is LEGACY (any manager may buy, no classification) until an ADMIN configures a position", async () => {
    await configure(null, null);
    const b = await procurementRequest();
    expect((await getProcurementManagers()).mode).toBe("LEGACY");
    expect((await buy(b, ids.mgrC, "cement", 5)).ok).toBe(true);
    expect((await getProcurementDetail(b.requestId, { id: ids.mgrC, role: "MANAGER" }))!.items.find((i) => i.itemId === b.item.cement)!.canAct).toBe(true);
    expect(await classify(b)).toMatchObject({ ok: false, status: 409 }); // nothing to classify against
  });

  it("reads a deactivated or demoted holder as 'no manager', without handing the position to anybody", async () => {
    await configure(ids.mgrA, ids.mgrB);
    await prisma.user.update({ where: { id: ids.mgrA }, data: { isActive: false } });
    try {
      expect(await getProcurementManagers()).toMatchObject({ mode: "ASSIGNED", domestic: null, international: { id: ids.mgrB } });
    } finally {
      await prisma.user.update({ where: { id: ids.mgrA }, data: { isActive: true } });
    }
  });
});

describe("1-3, 16. the International manager classifies; the rest becomes domestic", () => {
  it("assigns the chosen items abroad and every other outstanding item to the Domestic manager", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await procurementRequest();
    const result = await classify(b, ids.mgrB, ["bearing", "nozzle"]);
    expect(result).toMatchObject({ ok: true, duplicate: false });

    expect(await assignmentOf(b, "bearing")).toMatchObject({ kind: "INTERNATIONAL", assignedManagerId: ids.mgrB });
    expect(await assignmentOf(b, "nozzle")).toMatchObject({ kind: "INTERNATIONAL", assignedManagerId: ids.mgrB });
    expect(await assignmentOf(b, "cement")).toMatchObject({ kind: "DOMESTIC", assignedManagerId: ids.mgrA });
    expect(await assignmentOf(b, "bolt")).toMatchObject({ kind: "DOMESTIC", assignedManagerId: ids.mgrA }); // only its 6 outstanding
    // fully-issued material never enters procurement assignment
    expect(await assignmentOf(b, "washer")).toBeNull();
    expect(await prisma.procurementItemAssignment.count({ where: { requestItem: { requestId: b.requestId } } })).toBe(4);

    const row = await prisma.procurementClassification.findUniqueOrThrow({ where: { requestId: b.requestId } });
    expect(row.confirmedById).toBe(ids.mgrB);
    expect(await prisma.auditLog.count({ where: { entityType: "MaterialRequest", entityId: b.requestId, action: "PROCUREMENT_CLASSIFY", actorId: ids.mgrB } })).toBe(1);
    for (const manager of [ids.mgrA, ids.mgrB]) {
      expect(await prisma.notification.count({ where: { userId: manager, relatedRequestId: b.requestId, type: "PROCUREMENT_REQUIRED" } })).toBeGreaterThan(0);
    }
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
  });

  it("choosing nothing sends every outstanding item to the Domestic manager", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await procurementRequest();
    expect((await classify(b, ids.mgrB, [])).ok).toBe(true);
    expect(await prisma.procurementItemAssignment.count({ where: { requestItem: { requestId: b.requestId }, kind: "DOMESTIC" } })).toBe(4);
  });

  it("refuses to classify a warehouse-fulfilled item, an unknown item, or an incomplete configuration", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await procurementRequest();
    expect(await classify(b, ids.mgrB, ["bearing", "washer"])).toMatchObject({ ok: false, status: 400 });
    expect(await classifyProcurement(b.requestId, ids.mgrB, ["no-such-item"])).toMatchObject({ ok: false, status: 404 });
    expect(await prisma.procurementClassification.count({ where: { requestId: b.requestId } })).toBe(0);

    await configure(null, ids.mgrB); // no Domestic manager: the rest would have nobody
    expect(await classify(b)).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.procurementItemAssignment.count({ where: { requestItem: { requestId: b.requestId } } })).toBe(0);
  });
});

describe("7. purchases wait for the classification", () => {
  it("nobody can record a purchase before the International manager confirms", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await procurementRequest();
    for (const who of [ids.mgrA, ids.mgrB, ids.mgrC]) expect(await buy(b, who, "cement", 1)).toMatchObject({ ok: false, status: expect.any(Number) });
    expect(await buy(b, ids.mgrA, "cement", 1)).toMatchObject({ status: 409 });
    expect(await buy(b, ids.mgrB, "bearing", 1)).toMatchObject({ status: 409 });
    expect(await purchaseRows(b, "cement")).toBe(0);
    expect((await getProcurementDetail(b.requestId, { id: ids.mgrA, role: "MANAGER" }))!.items.every((i) => !i.canAct)).toBe(true);
  });
});

describe("4-5. each manager buys only their own items", () => {
  it("Manager A cannot buy, correct or void Manager B's items, and vice versa", async () => {
    const b = await classified();
    expect(await buy(b, ids.mgrA, "bearing", 1)).toMatchObject({ ok: false, status: 403 });
    expect(await buy(b, ids.mgrB, "cement", 1)).toMatchObject({ ok: false, status: 403 });
    expect(await buy(b, ids.mgrC, "cement", 1)).toMatchObject({ ok: false, status: 403 });

    const mineB = await buy(b, ids.mgrB, "bearing", 5);
    const mineA = await buy(b, ids.mgrA, "cement", 5);
    if (!mineB.ok || !mineA.ok) throw new Error("setup failed");
    const bearingPurchase = mineB.detail.items.find((i) => i.itemId === b.item.bearing)!.purchases[0];
    const cementPurchase = mineA.detail.items.find((i) => i.itemId === b.item.cement)!.purchases[0];

    expect(await voidPurchase(b.requestId, ids.mgrA, bearingPurchase.id, "x")).toMatchObject({ ok: false, status: 403 });
    expect(await voidPurchase(b.requestId, ids.mgrA, bearingPurchase.id, "x", { unitPrice: 1 })).toMatchObject({ ok: false, status: 403 });
    expect(await voidPurchase(b.requestId, ids.mgrB, cementPurchase.id, "x")).toMatchObject({ ok: false, status: 403 });
    // nothing changed
    expect((await prisma.procurementPurchase.findUniqueOrThrow({ where: { id: bearingPurchase.id } })).voidedAt).toBeNull();
    expect((await prisma.procurementPurchase.findUniqueOrThrow({ where: { id: cementPurchase.id } })).voidedAt).toBeNull();
    // the owners can
    expect((await voidPurchase(b.requestId, ids.mgrB, bearingPurchase.id, "typo", { unitPrice: 111 })).ok).toBe(true);
    expect((await voidPurchase(b.requestId, ids.mgrA, cementPurchase.id, "typo")).ok).toBe(true);
  });

  it("the detail tells each manager what they may act on", async () => {
    const b = await classified();
    const asA = (await getProcurementDetail(b.requestId, { id: ids.mgrA, role: "MANAGER" }))!;
    const asB = (await getProcurementDetail(b.requestId, { id: ids.mgrB, role: "MANAGER" }))!;
    const can = (d: typeof asA) => d.items.filter((i) => i.canAct).map((i) => i.materialName.replace(`PA${TAG} `, "")).sort();
    expect(can(asA)).toEqual(["bolt", "cement"]);
    expect(can(asB)).toEqual(["bearing", "nozzle"]);
    expect(asA.canClassify || asA.canReassign).toBe(false);
    expect(asB.canReassign).toBe(true);
    expect(asB.canClassify).toBe(false); // already classified
    expect(asA.items.find((i) => i.itemId === b.item.bearing)).toMatchObject({ assignment: { kind: "INTERNATIONAL", managerName: ids.mgrB } });
  });
});

describe("6. the classification cannot be confirmed twice with conflicting results", () => {
  it("accepts the same selection again (idempotent), refuses a different one, and refuses other managers", async () => {
    const b = await classified();
    expect(await classify(b, ids.mgrB, ["nozzle", "bearing"])).toMatchObject({ ok: true, duplicate: true });
    expect(await classify(b, ids.mgrB, ["bearing"])).toMatchObject({ ok: false, status: 409 });
    expect(await classify(b, ids.mgrB, [])).toMatchObject({ ok: false, status: 409 });
    expect(await classify(b, ids.mgrA)).toMatchObject({ ok: false, status: 403 });
    expect(await classify(b, ids.mgrC)).toMatchObject({ ok: false, status: 403 });
    expect(await classify(b, ids.admin)).toMatchObject({ ok: false, status: 403 });
    expect(await assignmentOf(b, "bearing")).toMatchObject({ kind: "INTERNATIONAL" });
    expect(await prisma.auditLog.count({ where: { entityType: "MaterialRequest", entityId: b.requestId, action: "PROCUREMENT_CLASSIFY" } })).toBe(1);
  });

  it("concurrent confirmations produce exactly one classification", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await procurementRequest();
    const results = await Promise.all([classify(b, ids.mgrB, ["bearing"]), classify(b, ids.mgrB, ["bearing"]), classify(b, ids.mgrB, ["nozzle"]), classify(b, ids.mgrB, ["bearing"])]);
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect(await prisma.procurementClassification.count({ where: { requestId: b.requestId } })).toBe(1);
    expect(await prisma.procurementItemAssignment.count({ where: { requestItem: { requestId: b.requestId } } })).toBe(4);
  });
});

describe("8-9. reassignment is controlled and never rewrites purchases", () => {
  it("needs the International manager and a reason, and leaves an audit record", async () => {
    const b = await classified();
    expect(await reassignItem(b.requestId, ids.mgrA, b.item.bearing, "DOMESTIC", "why")).toMatchObject({ ok: false, status: 403 });
    expect(await reassignItem(b.requestId, ids.admin, b.item.bearing, "DOMESTIC", "why")).toMatchObject({ ok: false, status: 403 });
    expect(await reassignItem(b.requestId, ids.mgrB, b.item.bearing, "DOMESTIC", "   ")).toMatchObject({ ok: false, status: 400 });
    expect(await reassignItem(b.requestId, ids.mgrB, b.item.bearing, "INTERNATIONAL", "same")).toMatchObject({ ok: false, status: 409 }); // no change
    expect(await reassignItem(b.requestId, ids.mgrB, b.item.washer, "DOMESTIC", "covered by stock")).toMatchObject({ ok: false, status: 409 });
    expect(await assignmentOf(b, "bearing")).toMatchObject({ kind: "INTERNATIONAL", assignedManagerId: ids.mgrB });

    const moved = await reassignItem(b.requestId, ids.mgrB, b.item.bearing, "DOMESTIC", "supplier found in Ulaanbaatar");
    expect(moved.ok).toBe(true);
    expect(await assignmentOf(b, "bearing")).toMatchObject({ kind: "DOMESTIC", assignedManagerId: ids.mgrA });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "ProcurementItemAssignment", entityId: b.item.bearing, action: "PROCUREMENT_REASSIGN" } });
    expect(log.actorId).toBe(ids.mgrB);
    expect(JSON.parse(log.beforeJson!)).toEqual({ kind: "INTERNATIONAL", assignedManagerId: ids.mgrB });
    expect(JSON.parse(log.afterJson!)).toMatchObject({ kind: "DOMESTIC", assignedManagerId: ids.mgrA, reason: "supplier found in Ulaanbaatar" });
    // and it is the new owner who can buy it now
    expect(await buy(b, ids.mgrB, "bearing", 1)).toMatchObject({ ok: false, status: 403 });
    expect((await buy(b, ids.mgrA, "bearing", 1)).ok).toBe(true);
  });

  it("is blocked while the responsible manager holds active purchase records, and never touches them", async () => {
    const b = await classified();
    const bought = await buy(b, ids.mgrA, "cement", 8, 55);
    if (!bought.ok) throw new Error(bought.error);
    const before = await prisma.procurementPurchase.findMany({ where: { requestItemId: b.item.cement } });

    const blocked = await reassignItem(b.requestId, ids.mgrB, b.item.cement, "INTERNATIONAL", "changed our mind");
    expect(blocked).toMatchObject({ ok: false, status: 409 });
    if (!blocked.ok) expect(blocked.error).toContain("худалдан авалтын бичлэг");
    expect(await assignmentOf(b, "cement")).toMatchObject({ kind: "DOMESTIC", assignedManagerId: ids.mgrA });
    expect(await prisma.procurementPurchase.findMany({ where: { requestItemId: b.item.cement } })).toEqual(before);

    // once the owner voids the active purchase (history stays), the item can move
    const purchase = bought.detail.items.find((i) => i.itemId === b.item.cement)!.purchases[0];
    expect((await voidPurchase(b.requestId, ids.mgrA, purchase.id, "ordered the wrong grade")).ok).toBe(true);
    expect((await reassignItem(b.requestId, ids.mgrB, b.item.cement, "INTERNATIONAL", "import it instead")).ok).toBe(true);
    expect(await purchaseRows(b, "cement")).toBe(1); // the voided row is still there
    expect((await prisma.procurementPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).voidReason).toBe("ordered the wrong grade");
  });
});

describe("17. replacing or deactivating a manager never silently transfers active work", () => {
  it("a replacement manager does not inherit the previous manager's items; the International manager hands them over explicitly, keeping the purchases", async () => {
    const b = await classified();
    expect((await buy(b, ids.mgrA, "cement", 8, 55)).ok).toBe(true);
    const original = await prisma.procurementPurchase.findFirstOrThrow({ where: { requestItemId: b.item.cement } });

    await configure(ids.mgrA2, ids.mgrB); // admin replaces A with A2
    expect(await assignmentOf(b, "cement")).toMatchObject({ assignedManagerId: ids.mgrA }); // nothing moved
    expect(await buy(b, ids.mgrA2, "cement", 1)).toMatchObject({ ok: false, status: 403 });
    expect((await getProcurementDetail(b.requestId, { id: ids.mgrA2, role: "MANAGER" }))!.items.every((i) => !i.canAct)).toBe(true);

    // the old holder is no longer the position holder, so the purchases no longer block a handover
    const handed = await reassignItem(b.requestId, ids.mgrB, b.item.cement, "DOMESTIC", "Manager A was replaced");
    expect(handed.ok).toBe(true);
    expect(await assignmentOf(b, "cement")).toMatchObject({ assignedManagerId: ids.mgrA2 });
    expect(await prisma.procurementPurchase.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original); // untouched, still A's
    expect((await buy(b, ids.mgrA2, "cement", 12, 60)).ok).toBe(true); // 8 + 12 = 20
    expect((await getProcurementDetail(b.requestId))!.items.find((i) => i.itemId === b.item.cement)).toMatchObject({ purchasedQuantity: 20, checked: true });
  });

  it("a deactivated manager can no longer act, and the work waits for an explicit reassignment", async () => {
    const b = await classified();
    await prisma.user.update({ where: { id: ids.mgrA }, data: { isActive: false } });
    try {
      expect(await buy(b, ids.mgrA, "cement", 1)).toMatchObject({ ok: false, status: 403 });
      expect(await assignmentOf(b, "cement")).toMatchObject({ assignedManagerId: ids.mgrA });
      // there is no active Domestic manager to hand it to until an ADMIN configures one
      expect(await reassignItem(b.requestId, ids.mgrB, b.item.cement, "DOMESTIC", "A left")).toMatchObject({ ok: false, status: 409 });
    } finally {
      await prisma.user.update({ where: { id: ids.mgrA }, data: { isActive: true } });
    }
  });
});

describe("10-12. the request reaches accounting only when BOTH groups are bought", () => {
  const buyGroup = async (b: Built, who: string, items: [K, number][]) => {
    for (const [k, qty] of items) {
      const r = await buy(b, who, k, qty);
      if (!r.ok) throw new Error(r.error);
    }
  };

  it("domestic alone does not complete it", async () => {
    const b = await classified();
    await buyGroup(b, ids.mgrA, [["cement", 20], ["bolt", 6]]);
    const done = await completeProcurement(b.requestId, ids.mgrA);
    expect(done).toMatchObject({ ok: false, status: 409 });
    if (!done.ok) expect(done.error).toContain(`PA${TAG} bearing`);
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
    const detail = (await getProcurementDetail(b.requestId, { id: ids.mgrA, role: "MANAGER" }))!;
    expect(detail).toMatchObject({ canComplete: false, viewerCanComplete: false, completedItemCount: 2, requiredItemCount: 4 });
  });

  it("international alone (2 of 3 in the example: one item still open) does not complete it either", async () => {
    const b = await classified();
    await buyGroup(b, ids.mgrB, [["bearing", 12], ["nozzle", 3]]);
    expect(await completeProcurement(b.requestId, ids.mgrB)).toMatchObject({ ok: false, status: 409 });
    await buyGroup(b, ids.mgrB, [["nozzle", 1]]);
    expect(await completeProcurement(b.requestId, ids.mgrB)).toMatchObject({ ok: false, status: 409 }); // domestic still open
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
  });

  it("completes exactly once when everything is bought, then the Chief Accountant registers it", async () => {
    const b = await classified();
    await buyGroup(b, ids.mgrA, [["cement", 20], ["bolt", 6]]);
    await buyGroup(b, ids.mgrB, [["bearing", 12], ["nozzle", 4]]);
    expect(await completeProcurement(b.requestId, ids.mgrC)).toMatchObject({ ok: false, status: 403 }); // uninvolved manager

    const detail = (await getProcurementDetail(b.requestId, { id: ids.mgrB, role: "MANAGER" }))!;
    expect(detail).toMatchObject({ canComplete: true, viewerCanComplete: true });

    const results = await Promise.all([completeProcurement(b.requestId, ids.mgrA), completeProcurement(b.requestId, ids.mgrB)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await statusOf(b)).toBe("PENDING_ACCOUNTING");
    expect(await prisma.notification.count({ where: { userId: ids.acct, relatedRequestId: b.requestId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "MaterialRequest", entityId: b.requestId, action: "PROCUREMENT_COMPLETE" } })).toBe(1);
    expect(await completeProcurement(b.requestId, ids.mgrA)).toMatchObject({ ok: false, status: 409 });

    const version = (await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } })).version;
    expect((await recordAccountingEntry(b.requestId, ids.acct, { ledgerNumber: `PA-${TAG}`, recordDate: new Date() }, version)).ok).toBe(true);
  });

  it("a request with nothing left to buy still needs the classification and an explicit completion", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await procurementRequest();
    await prisma.warehouseCheckItem.updateMany({ where: { requestItem: { requestId: b.requestId } }, data: { missingQuantity: 0 } });
    expect(await completeProcurement(b.requestId, ids.mgrA)).toMatchObject({ ok: false, status: 409 }); // not classified
    expect((await classifyProcurement(b.requestId, ids.mgrB, [])).ok).toBe(true);
    expect(await prisma.procurementItemAssignment.count({ where: { requestItem: { requestId: b.requestId } } })).toBe(0);
    expect((await completeProcurement(b.requestId, ids.mgrA)).ok).toBe(true);
  });
});

describe("13. concurrent purchases stay consistent", () => {
  it("parallel purchases by both managers never exceed any item's requirement", async () => {
    const b = await classified();
    const jobs = [
      ...Array.from({ length: 10 }, (_, i) => buy(b, ids.mgrA, "cement", 5, 50, `a-${TAG}-${i}`)), // 20 needed: exactly 4 fit
      ...Array.from({ length: 10 }, (_, i) => buy(b, ids.mgrB, "bearing", 3, 70, `b-${TAG}-${i}`)), // 12 needed: exactly 4 fit
      buy(b, ids.mgrA, "bearing", 1), // not A's item -- always refused, even mid-race
      buy(b, ids.mgrB, "cement", 1),
    ];
    const results = await Promise.all(jobs);
    expect(results.slice(0, 10).filter((r) => r.ok)).toHaveLength(4);
    expect(results.slice(10, 20).filter((r) => r.ok)).toHaveLength(4);
    expect(results.slice(20).every((r) => !r.ok && r.status === 403)).toBe(true);
    const detail = (await getProcurementDetail(b.requestId))!;
    expect(detail.items.find((i) => i.itemId === b.item.cement)).toMatchObject({ purchasedQuantity: 20, checked: true });
    expect(detail.items.find((i) => i.itemId === b.item.bearing)).toMatchObject({ purchasedQuantity: 12, checked: true });
  });

  it("a retried submission with the same key is counted once", async () => {
    const b = await classified();
    const first = await buy(b, ids.mgrA, "cement", 5, 50, `retry-${TAG}`);
    const again = await buy(b, ids.mgrA, "cement", 5, 50, `retry-${TAG}`);
    expect([first, again]).toMatchObject([{ ok: true, duplicate: false }, { ok: true, duplicate: true }]);
    expect(await purchaseRows(b, "cement")).toBe(1);
    // the key does not let another manager reach past their items
    expect(await buy(b, ids.mgrB, "cement", 5, 50, `retry-${TAG}`)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("15. in-flight requests from before assignment existed", () => {
  it("keep their purchase records; classification is then required before more purchases", async () => {
    await configure(null, null);
    const b = await procurementRequest();
    expect((await buy(b, ids.mgrC, "cement", 8, 40)).ok).toBe(true); // bought under the previous behaviour
    const before = await prisma.procurementPurchase.findMany({ where: { requestItemId: b.item.cement } });

    await configure(ids.mgrA, ids.mgrB); // admin turns assignment on
    expect(await buy(b, ids.mgrC, "cement", 1)).toMatchObject({ ok: false, status: 409 }); // unclassified now
    expect(await buy(b, ids.mgrA, "cement", 1)).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.procurementPurchase.findMany({ where: { requestItemId: b.item.cement } })).toEqual(before);

    expect((await classify(b)).ok).toBe(true);
    expect(await prisma.procurementPurchase.findMany({ where: { requestItemId: b.item.cement } })).toEqual(before); // untouched
    expect((await buy(b, ids.mgrA, "cement", 12, 45)).ok).toBe(true); // 8 earlier + 12 now
    expect((await getProcurementDetail(b.requestId))!.items.find((i) => i.itemId === b.item.cement)).toMatchObject({ purchasedQuantity: 20, checked: true });
  });

  it("requests without a Manager step (already past procurement) never appear and are untouched", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await procurementRequest();
    await prisma.approvalStep.deleteMany({ where: { requestId: b.requestId, type: "MANAGER_PROCUREMENT" } });
    await prisma.materialRequest.update({ where: { id: b.requestId }, data: { status: "PENDING_ACCOUNTING" } });
    const snapshot = await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } });
    for (const tab of ["classify", "awaiting", "in_progress", "completed", "all"] as const) {
      const list = await listProcurement({ tab, q: b.requestNumber, scope: "all", page: 1, pageSize: 10 });
      expect(list.total, tab).toBe(0);
    }
    expect(await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } })).toEqual(snapshot);
  });
});

describe("18. the dashboard and its filters follow the assignments", () => {
  it("before classification only the International manager sees the request, under 'classify'", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await procurementRequest();
    const find = (who: string, tab: "classify" | "awaiting" | "all", scope: "mine" | "all" = "mine") =>
      listProcurement({ tab, q: b.requestNumber, viewerId: who, scope, page: 1, pageSize: 10 }).then((r) => r.rows.map((x) => x.requestNumber));

    expect(await find(ids.mgrB, "classify")).toEqual([b.requestNumber]);
    expect(await find(ids.mgrA, "classify")).toEqual([]); // not theirs to classify
    expect(await find(ids.mgrA, "all")).toEqual([]);
    expect(await find(ids.mgrC, "classify")).toEqual([]);
    expect(await find(ids.mgrA, "classify", "all")).toEqual([b.requestNumber]); // shared context on request
    expect((await listProcurement({ tab: "classify", q: b.requestNumber, page: 1, pageSize: 10 })).rows[0]).toMatchObject({ classified: false });
  });

  it("after classification each manager's list holds only requests with items assigned to them", async () => {
    const b = await classified();
    const only = async (who: string, extra: Partial<Parameters<typeof listProcurement>[0]> = {}) =>
      (await listProcurement({ tab: "all", q: b.requestNumber, viewerId: who, scope: "mine", page: 1, pageSize: 10, ...extra })).rows;

    const aRows = await only(ids.mgrA);
    expect(aRows.map((r) => r.requestNumber)).toEqual([b.requestNumber]);
    expect(aRows[0].classified).toBe(true);
    expect(aRows[0].items.filter((i) => i.mine).map((i) => i.materialName.replace(`PA${TAG} `, "")).sort()).toEqual(["bolt", "cement"]);
    expect(aRows[0].items.filter((i) => i.kind === "INTERNATIONAL")).toHaveLength(2); // the rest is visible context
    expect((await only(ids.mgrB)).map((r) => r.requestNumber)).toEqual([b.requestNumber]);
    expect(await only(ids.mgrC)).toEqual([]);
    expect((await only(ids.mgrC, { scope: "all" })).map((r) => r.requestNumber)).toEqual([b.requestNumber]);
    // it is no longer in anybody's 'classify' queue
    expect((await listProcurement({ tab: "classify", q: b.requestNumber, viewerId: ids.mgrB, scope: "mine", page: 1, pageSize: 10 })).total).toBe(0);
  });

  it("the kind filter, search and counters respect the same scope", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await procurementRequest();
    expect((await classify(b, ids.mgrB, ["bearing"])).ok).toBe(true);
    const q = { tab: "all" as const, q: `PA${TAG} bearing`, page: 1, pageSize: 50 };

    expect((await listProcurement({ ...q, viewerId: ids.mgrB, scope: "mine", kind: "INTERNATIONAL" })).rows.map((r) => r.requestNumber)).toContain(b.requestNumber);
    expect((await listProcurement({ ...q, viewerId: ids.mgrA, scope: "mine", kind: "INTERNATIONAL" })).rows.map((r) => r.requestNumber)).not.toContain(b.requestNumber); // A holds no international item
    expect((await listProcurement({ ...q, viewerId: ids.mgrA, scope: "mine", kind: "DOMESTIC" })).rows.map((r) => r.requestNumber)).toContain(b.requestNumber);
    expect((await listProcurement({ ...q, viewerId: ids.mgrC, scope: "mine" })).rows.map((r) => r.requestNumber)).not.toContain(b.requestNumber);

    const a = await procurementCounts({ id: ids.mgrA, scope: "mine" });
    const c = await procurementCounts({ id: ids.mgrC, scope: "mine" });
    const everyone = await procurementCounts({ id: ids.mgrC, scope: "all" });
    expect(a.awaiting).toBeGreaterThan(c.awaiting);
    expect(everyone.awaiting).toBeGreaterThanOrEqual(a.awaiting);
    expect(c.classify).toBe(0);
  });
});
