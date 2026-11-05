import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { classifyProcurement, completeProcurement, getProcurementDetail, getProcurementManagers, listProcurement, procurementCounts, recordPurchase, voidPurchase } from "./procurement";
import { executeHandover, orphanableWork, previewHandover } from "./procurement-handover";
import { pendingClassificationRequestIds, procurementBadgeCount } from "./procurement-workload";

// Manager workload badge + safe handover, against the isolated test database.
// Requests are built directly in PENDING_PROCUREMENT with a warehouse check. The two
// procurement positions are configured here and the previous configuration restored.
const TAG = Date.now().toString(36);
const P = "ph-";
const ids = {
  dept: `${P}dept-${TAG}`,
  mgrA: `${P}mgr-a`, // domestic
  mgrB: `${P}mgr-b`, // international
  mgrA2: `${P}mgr-a2`, // replacement
  mgrC: `${P}mgr-c`, // a manager holding nothing
  emp: `${P}emp`,
  acct: `${P}acct`,
  store: `${P}store`,
  admin: `${P}admin`,
  admin2: `${P}admin2`,
};
const POSITIONS = ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] as const;
const DOMESTIC = POSITIONS[0];
const INTERNATIONAL = POSITIONS[1];
let previouslyActive: { id: string }[] = [];
let counter = 0;
let keyCounter = 0;
const key = () => `ph-key-${TAG}-${(keyCounter += 1)}`;

async function wipeRequests() {
  const mine = { requestNumber: { startsWith: "PH-" } };
  await prisma.procurementPurchase.deleteMany({ where: { requestItem: { request: mine } } });
  await prisma.warehouseCheck.deleteMany({ where: { request: mine } });
  await prisma.accountingRecord.deleteMany({ where: { request: mine } });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: mine });
}
async function cleanup() {
  await wipeRequests();
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.updateMany({ where: { id: { startsWith: P } }, data: { departmentId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  previouslyActive = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: [...POSITIONS] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: false, endedAt: new Date() } });
  await prisma.department.create({ data: { id: ids.dept, name: `PH${TAG} dept`, type: "FACTORY" } });
  const users: [string, "MANAGER" | "EMPLOYEE" | "CHIEF_ACCOUNTANT" | "STOREKEEPER" | "ADMIN"][] = [
    [ids.mgrA, "MANAGER"], [ids.mgrB, "MANAGER"], [ids.mgrA2, "MANAGER"], [ids.mgrC, "MANAGER"],
    [ids.emp, "EMPLOYEE"], [ids.acct, "CHIEF_ACCOUNTANT"], [ids.store, "STOREKEEPER"], [ids.admin, "ADMIN"], [ids.admin2, "ADMIN"],
  ];
  for (const [id, role] of users) {
    await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role, passwordHash: "x", departmentId: id === ids.emp ? ids.dept : null } });
  }
});
beforeEach(async () => {
  await wipeRequests();
  await prisma.user.updateMany({ where: { id: { startsWith: P }, role: "MANAGER" }, data: { isActive: true } });
});
afterAll(async () => {
  await cleanup();
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: true, endedAt: null } });
});

async function configure(domestic: string | null, international: string | null) {
  await prisma.approvalRoleAssignment.updateMany({ where: { role: { in: [...POSITIONS] }, isActive: true }, data: { isActive: false, endedAt: new Date() } });
  if (domestic) await prisma.approvalRoleAssignment.create({ data: { role: DOMESTIC, userId: domestic } });
  if (international) await prisma.approvalRoleAssignment.create({ data: { role: INTERNATIONAL, userId: international } });
}

type K = "cement" | "bearing" | "nozzle" | "washer" | "bolt";
interface Built {
  requestId: string;
  item: Record<K, string>;
}

/** cement 20, bearing 12, nozzle 4 to buy; washer 6 fully issued from stock; bolt 10 with 4 issued (6 to buy). */
async function procurementRequest(): Promise<Built> {
  counter += 1;
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
      requestNumber: `PH-${TAG}-${counter}`,
      year: 9999,
      sequence: counter,
      departmentId: ids.dept,
      requestedById: ids.emp,
      status: "PENDING_PROCUREMENT",
      version: 5,
      items: { create: keys.map((k, i) => ({ lineNo: i + 1, unit: "ш", requestedQuantity: spec[k].requested, unitPrice: 100, totalPrice: spec[k].requested * 100, manualMaterialName: `PH${TAG} ${k}` })) },
      approvalSteps: {
        create: [
          ...types.map((type, i) => ({ type, sequence: i + 1, status: "APPROVED" as const, assignedUserId: ids.store, decidedById: ids.store, decidedAt: new Date() })),
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
  return { requestId: created.id, item };
}

const buy = (b: Built, who: string, k: K, quantity: number, unitPrice = 100) => recordPurchase(b.requestId, who, { itemId: b.item[k], quantity, unitPrice });
/** Domestic: cement + bolt. International: bearing + nozzle. */
const classifiedRequest = async () => {
  const b = await procurementRequest();
  const r = await classifyProcurement(b.requestId, ids.mgrB, [b.item.bearing, b.item.nozzle]);
  if (!r.ok) throw new Error(r.error);
  return b;
};
// The shared test database may hold unclassified requests from other suites: counts that include the
// classification queue are therefore asserted relative to this baseline, taken before the test builds anything.
const pendingBaseline = async () => (await pendingClassificationRequestIds()).length;
const asViewer = (id: string, role = "MANAGER") => ({ id, role });
const badge = async (id: string, role = "MANAGER") => procurementBadgeCount(asViewer(id, role), await getProcurementManagers());
const assignee = async (b: Built, k: K) => (await prisma.procurementItemAssignment.findUniqueOrThrow({ where: { requestItemId: b.item[k] } })).assignedManagerId;
const handover = (over: Partial<Parameters<typeof executeHandover>[0]> = {}) =>
  executeHandover({ position: DOMESTIC, newManagerId: ids.mgrA2, actorId: ids.admin, reason: "Ажлаас гарсан", clientRequestId: key(), expectedItems: 2, ...over });

describe("sidebar badge: distinct requests with unfinished work for the logged-in manager", () => {
  it("domestic manager counts only requests with unfinished domestic items assigned to them", async () => {
    await configure(ids.mgrA, ids.mgrB);
    await classifiedRequest();
    await classifiedRequest();
    expect(await badge(ids.mgrA)).toBe(2);
    expect(await badge(ids.mgrC)).toBe(0); // a manager holding nothing
  });

  it("international manager counts requests with unfinished international items", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const base = await badge(ids.mgrB);
    await classifiedRequest();
    expect(await badge(ids.mgrB)).toBe(base + 1);
  });

  it("the international classification queue is included (for the international manager only)", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const base = await badge(ids.mgrB);
    await procurementRequest(); // not classified yet
    expect(await badge(ids.mgrB)).toBe(base + 1);
    expect(await badge(ids.mgrA)).toBe(0);
  });

  it("counts a request once however many outstanding items it holds", async () => {
    await configure(ids.mgrA, ids.mgrB);
    await classifiedRequest(); // domestic: cement AND bolt outstanding
    expect(await badge(ids.mgrA)).toBe(1);
  });

  it("a request with unfinished work for both managers counts once for each", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const base = await badge(ids.mgrB);
    await classifiedRequest();
    expect([await badge(ids.mgrA), await badge(ids.mgrB)]).toEqual([1, base + 1]);
  });

  it("drops a request from a manager's badge once their own items are bought, and from both once completed", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const base = await badge(ids.mgrB);
    const b = await classifiedRequest();
    expect((await buy(b, ids.mgrA, "cement", 20)).ok).toBe(true);
    expect(await badge(ids.mgrA)).toBe(1); // bolt still open
    expect((await buy(b, ids.mgrA, "bolt", 6)).ok).toBe(true);
    expect(await badge(ids.mgrA)).toBe(0);
    expect(await badge(ids.mgrB)).toBe(base + 1); // international work is still outstanding
    expect((await buy(b, ids.mgrB, "bearing", 12)).ok).toBe(true);
    expect((await buy(b, ids.mgrB, "nozzle", 4)).ok).toBe(true);
    expect(await badge(ids.mgrB)).toBe(base);
    expect((await completeProcurement(b.requestId, ids.mgrA)).ok).toBe(true);
    expect([await badge(ids.mgrA), await badge(ids.mgrB)]).toEqual([0, base]);
  });

  it("excludes fully warehouse-fulfilled requests and voided purchases do not count as bought", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    const p = await buy(b, ids.mgrA, "cement", 20);
    expect(p.ok).toBe(true);
    await buy(b, ids.mgrA, "bolt", 6);
    expect(await badge(ids.mgrA)).toBe(0);
    if (p.ok) {
      const purchaseId = p.detail.items.find((i) => i.itemId === b.item.cement)!.purchases[0].id;
      expect((await voidPurchase(b.requestId, ids.mgrA, purchaseId, "Буруу бүртгэсэн")).ok).toBe(true);
    }
    expect(await badge(ids.mgrA)).toBe(1); // cement is outstanding again
  });

  it("agrees with the actionable dashboard list and its counter, for every viewer", async () => {
    await configure(ids.mgrA, ids.mgrB);
    await classifiedRequest();
    const done = await classifiedRequest();
    await buy(done, ids.mgrA, "cement", 20);
    await buy(done, ids.mgrA, "bolt", 6);
    await procurementRequest(); // awaiting classification
    for (const [id, role] of [[ids.mgrA, "MANAGER"], [ids.mgrB, "MANAGER"], [ids.mgrC, "MANAGER"], [ids.admin, "ADMIN"]] as const) {
      const list = await listProcurement({ tab: "all", viewerId: id, viewerRole: role, actionable: true, scope: role === "ADMIN" ? "all" : "mine", page: 1, pageSize: 100 });
      const counts = await procurementCounts({ id, role, scope: role === "ADMIN" ? "all" : "mine" });
      const n = await badge(id, role);
      expect(list.total, `${id} list`).toBe(n);
      expect(counts.actionable, `${id} counter`).toBe(n);
    }
    expect(await badge(ids.mgrA)).toBe(1);
  });

  it("behaves as before when no managers are configured (LEGACY): any manager sees open requests", async () => {
    await configure(null, null);
    const base = await badge(ids.mgrC);
    await procurementRequest();
    expect(await badge(ids.mgrC)).toBe(base + 1);
    expect(await badge(ids.emp, "EMPLOYEE")).toBe(0);
  });
});

describe("handover preview (read-only)", () => {
  it("shows previous/new manager, affected requests and items, partially purchased items and writes nothing", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b1 = await classifiedRequest();
    await classifiedRequest();
    await buy(b1, ids.mgrA, "cement", 5);
    const auditsBefore = await prisma.auditLog.count();
    const preview = await previewHandover(DOMESTIC, ids.mgrA2);
    expect(preview).toMatchObject({
      kind: "DOMESTIC",
      previousManager: { id: ids.mgrA },
      newManager: { id: ids.mgrA2 },
      newManagerProblem: null,
      affectedRequests: 2,
      affectedItems: 4,
      partiallyPurchasedItems: 1,
    });
    expect(preview.items.find((i) => i.itemId === b1.item.cement)).toMatchObject({ required: 20, purchased: 5, remaining: 15, fromManagerId: ids.mgrA });
    expect(await prisma.auditLog.count()).toBe(auditsBefore);
    expect(await assignee(b1, "cement")).toBe(ids.mgrA);
    expect((await getProcurementManagers()).domestic?.id).toBe(ids.mgrA);
  });

  it("flags an invalid replacement and counts pending classification for the international position", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const base = await pendingBaseline();
    await procurementRequest();
    expect((await previewHandover(DOMESTIC, ids.emp)).newManagerProblem).toMatch(/MANAGER/);
    expect((await previewHandover(DOMESTIC, ids.mgrB)).newManagerProblem).toMatch(/өөр өөр/);
    expect((await previewHandover(INTERNATIONAL, ids.mgrC)).pendingClassificationRequests).toBe(base + 1);
  });
});

describe("handover execution", () => {
  it("replaces the holder and transfers only the unfinished assignments of that responsibility, with audit and notification", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    const r = await handover();
    expect(r).toMatchObject({ ok: true, duplicate: false, summary: { previousManagerId: ids.mgrA, newManagerId: ids.mgrA2, affectedItemIds: expect.arrayContaining([b.item.cement, b.item.bolt]), positionChanged: true } });
    expect((await getProcurementManagers()).domestic?.id).toBe(ids.mgrA2);
    expect(await assignee(b, "cement")).toBe(ids.mgrA2);
    expect(await assignee(b, "bolt")).toBe(ids.mgrA2);
    expect(await assignee(b, "bearing")).toBe(ids.mgrB); // the other responsibility is untouched
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "ProcurementHandover", actorId: ids.admin } });
    expect(JSON.parse(log.afterJson!)).toMatchObject({ previousManagerId: ids.mgrA, newManagerId: ids.mgrA2, kind: "DOMESTIC", reason: "Ажлаас гарсан", affectedRequestIds: [b.requestId] });
    expect(await prisma.auditLog.count({ where: { entityType: "ProcurementItemAssignment", entityId: { in: [b.item.cement, b.item.bolt] }, action: "PROCUREMENT_REASSIGN" } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: ids.mgrA2, title: { contains: "шилжиж ирлээ" } } })).toBe(1);
    expect(await badge(ids.mgrA)).toBe(0);
    expect(await badge(ids.mgrA2)).toBe(1);
  });

  it("keeps recorded purchases attributed to the original manager and moves only the remaining quantity", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    await buy(b, ids.mgrA, "cement", 5, 123);
    const before = await prisma.procurementPurchase.findMany({ where: { requestItemId: b.item.cement } });
    expect((await handover()).ok).toBe(true);
    const after = await prisma.procurementPurchase.findMany({ where: { requestItemId: b.item.cement } });
    expect(after).toEqual(before); // rows byte-for-byte unchanged
    expect(after[0]).toMatchObject({ purchasedById: ids.mgrA });
    expect(Number(after[0].quantity)).toBe(5);
    expect(Number(after[0].unitPrice)).toBe(123);
    const item = (await getProcurementDetail(b.requestId, asViewer(ids.mgrA2)))!.items.find((i) => i.itemId === b.item.cement)!;
    expect(item).toMatchObject({ purchasedQuantity: 5, remainingQuantity: 15, canAct: true, assignment: { managerId: ids.mgrA2 } });
    expect(item.purchases[0].purchasedByName).toBe(ids.mgrA); // still shown as bought by the original manager
  });

  it("the old manager loses write access and the new manager continues with the remaining quantity", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    const first = await buy(b, ids.mgrA, "cement", 5);
    expect((await handover()).ok).toBe(true);
    expect(await buy(b, ids.mgrA, "cement", 1)).toMatchObject({ ok: false, status: 403 });
    if (first.ok) {
      const purchaseId = first.detail.items.find((i) => i.itemId === b.item.cement)!.purchases[0].id;
      expect(await voidPurchase(b.requestId, ids.mgrA, purchaseId, "x")).toMatchObject({ ok: false, status: 403 });
    }
    expect(await buy(b, ids.mgrA2, "cement", 16)).toMatchObject({ ok: false, status: 409 }); // only 15 remain
    expect((await buy(b, ids.mgrA2, "cement", 15)).ok).toBe(true);
    expect((await buy(b, ids.mgrA2, "bolt", 6)).ok).toBe(true);
    const detail = await listProcurement({ tab: "all", viewerId: ids.mgrA2, viewerRole: "MANAGER", page: 1, pageSize: 10, actionable: true });
    expect(detail.total).toBe(0);
  });

  it("is idempotent: the same clientRequestId is acknowledged without a second transfer, audit or notification", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    const k = key();
    expect(await handover({ clientRequestId: k })).toMatchObject({ ok: true, duplicate: false });
    expect(await handover({ clientRequestId: k })).toMatchObject({ ok: true, duplicate: true });
    expect(await prisma.auditLog.count({ where: { entityType: "ProcurementHandover", entityId: k } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "ProcurementItemAssignment", entityId: b.item.cement, action: "PROCUREMENT_REASSIGN" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ids.mgrA2, title: { contains: "шилжиж ирлээ" } } })).toBe(1);
    expect(await handover({ clientRequestId: k, newManagerId: ids.mgrC })).toMatchObject({ ok: false, status: 409 }); // key reused for something else
  });

  it("rejects an inactive, non-manager or double-holding replacement and changes nothing", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    await prisma.user.update({ where: { id: ids.mgrA2 }, data: { isActive: false } });
    expect(await handover()).toMatchObject({ ok: false, status: 400 });
    expect(await handover({ newManagerId: ids.emp })).toMatchObject({ ok: false, status: 400 });
    expect(await handover({ newManagerId: ids.mgrB })).toMatchObject({ ok: false, status: 409 });
    expect(await handover({ newManagerId: "ph-nobody" })).toMatchObject({ ok: false, status: 404 });
    expect(await assignee(b, "cement")).toBe(ids.mgrA);
    expect((await getProcurementManagers()).domestic?.id).toBe(ids.mgrA);
  });

  it("only an active ADMIN can hand over, and a reason is mandatory", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    expect(await handover({ actorId: ids.mgrA })).toMatchObject({ ok: false, status: 403 });
    expect(await handover({ actorId: ids.mgrC })).toMatchObject({ ok: false, status: 403 });
    expect(await handover({ actorId: ids.emp })).toMatchObject({ ok: false, status: 403 });
    expect(await handover({ reason: "  " })).toMatchObject({ ok: false, status: 400 });
    expect(await assignee(b, "cement")).toBe(ids.mgrA);
    await prisma.user.update({ where: { id: ids.admin2 }, data: { isActive: false } });
    try {
      expect(await handover({ actorId: ids.admin2 })).toMatchObject({ ok: false, status: 403 });
    } finally {
      await prisma.user.update({ where: { id: ids.admin2 }, data: { isActive: true } });
    }
  });

  it("refuses when the reviewed work changed (stale preview) and transfers nothing", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    expect(await handover({ expectedItems: 5 })).toMatchObject({ ok: false, status: 409, code: "WORK_CHANGED" });
    expect(await assignee(b, "cement")).toBe(ids.mgrA);
    expect((await getProcurementManagers()).domestic?.id).toBe(ids.mgrA); // the position change was rolled back too
  });

  it("does not transfer completed items, completed requests or requests already past procurement", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    await buy(b, ids.mgrA, "cement", 20); // item complete
    const old = await classifiedRequest();
    await prisma.materialRequest.update({ where: { id: old.requestId }, data: { status: "PENDING_ACCOUNTING" } });
    const preview = await previewHandover(DOMESTIC, ids.mgrA2);
    expect(preview.items.map((i) => i.itemId)).toEqual([b.item.bolt]);
    expect((await handover({ expectedItems: 1 })).ok).toBe(true);
    expect(await assignee(b, "cement")).toBe(ids.mgrA); // complete item keeps its manager
    expect(await assignee(old, "cement")).toBe(ids.mgrA);
    expect(await assignee(b, "bolt")).toBe(ids.mgrA2);
  });

  it("leaves historical purchases, approval steps and approval actions unchanged", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    await buy(b, ids.mgrA, "bolt", 6);
    const snapshot = async () => ({
      purchases: await prisma.procurementPurchase.findMany({ where: { requestItem: { requestId: b.requestId } }, orderBy: { id: "asc" } }),
      steps: await prisma.approvalStep.findMany({ where: { requestId: b.requestId }, orderBy: { id: "asc" } }),
      actions: await prisma.approvalAction.findMany({ where: { approvalStep: { requestId: b.requestId } }, orderBy: { id: "asc" } }),
      request: await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId }, select: { status: true, version: true } }),
    });
    const before = await snapshot();
    expect((await handover({ expectedItems: 1 })).ok).toBe(true); // bolt is bought: only cement is outstanding
    expect(await snapshot()).toEqual(before);
  });

  it("two admins handing over at once leave one consistent holder and one consistent assignee", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    const [one, two] = await Promise.all([
      handover({ actorId: ids.admin, newManagerId: ids.mgrA2 }),
      handover({ actorId: ids.admin2, newManagerId: ids.mgrC }),
    ]);
    expect(one.ok && two.ok).toBe(true); // serialised, both valid in turn
    const holder = (await getProcurementManagers()).domestic!.id;
    expect([ids.mgrA2, ids.mgrC]).toContain(holder);
    expect(await assignee(b, "cement")).toBe(holder);
    expect(await assignee(b, "bolt")).toBe(holder);
    const active = await prisma.approvalRoleAssignment.count({ where: { role: DOMESTIC, isActive: true } });
    expect(active).toBe(1);
  });

  it("a purchase racing a handover ends in exactly one consistent outcome", async () => {
    for (let round = 0; round < 3; round++) {
      await wipeRequests();
      await configure(ids.mgrA, ids.mgrB);
      const b = await classifiedRequest();
      // the purchase would finish cement (so the reviewed item count 2 would become 1)
      const [bought, moved] = await Promise.all([buy(b, ids.mgrA, "cement", 20), handover({ expectedItems: 2 })]);
      const purchases = await prisma.procurementPurchase.findMany({ where: { requestItemId: b.item.cement } });
      const owner = await assignee(b, "cement");
      const total = purchases.filter((p) => !p.voidedAt).reduce((s, p) => s + Number(p.quantity), 0);
      expect(total).toBeLessThanOrEqual(20);
      if (bought.ok) {
        // purchase committed first: the handover re-validated, saw the changed work and refused everything
        expect(moved).toMatchObject({ ok: false, status: 409, code: "WORK_CHANGED" });
        expect(owner).toBe(ids.mgrA);
        expect((await getProcurementManagers()).domestic?.id).toBe(ids.mgrA);
        expect(purchases).toHaveLength(1);
      } else {
        // handover committed first: the stale manager was refused and nothing was recorded
        expect(bought).toMatchObject({ ok: false, status: 403 });
        expect(moved.ok).toBe(true);
        expect(owner).toBe(ids.mgrA2);
        expect(purchases).toHaveLength(0);
      }
    }
  });

  it("recovers the classification queue after replacing an inactive international manager", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const base = await pendingBaseline();
    const b = await procurementRequest();
    await prisma.user.update({ where: { id: ids.mgrB }, data: { isActive: false } });
    expect(await classifyProcurement(b.requestId, ids.mgrB, [b.item.bearing])).toMatchObject({ ok: false, status: 403 });
    const preview = await previewHandover(INTERNATIONAL, ids.mgrC);
    expect(preview).toMatchObject({ previousManager: { id: ids.mgrB, isActive: false }, pendingClassificationRequests: base + 1, affectedItems: 0 });
    const r = await handover({ position: INTERNATIONAL, newManagerId: ids.mgrC, expectedItems: 0 });
    expect(r).toMatchObject({ ok: true, summary: { positionChanged: true, pendingClassificationRequests: base + 1 } });
    expect(await badge(ids.mgrC)).toBe(base + 1);
    expect(await prisma.notification.count({ where: { userId: ids.mgrC, title: { contains: "шилжиж ирлээ" } } })).toBe(1);
    expect((await classifyProcurement(b.requestId, ids.mgrC, [b.item.bearing])).ok).toBe(true);
  });

  it("recovers stranded items of an earlier un-handed-over replacement, even for the same holder", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const b = await classifiedRequest();
    await configure(ids.mgrA2, ids.mgrB); // replaced WITHOUT handover (e.g. directly in the database / legacy flow)
    expect(await badge(ids.mgrA2)).toBe(0);
    const preview = await previewHandover(DOMESTIC, ids.mgrA2);
    expect(preview.affectedItems).toBe(2);
    const r = await handover({ newManagerId: ids.mgrA2, expectedItems: 2 });
    expect(r).toMatchObject({ ok: true, summary: { positionChanged: false } });
    expect(await assignee(b, "cement")).toBe(ids.mgrA2);
    expect(await badge(ids.mgrA2)).toBe(1);
    expect(await handover({ newManagerId: ids.mgrA2, expectedItems: 0 })).toMatchObject({ ok: false, status: 409, code: "NOTHING_TO_TRANSFER" });
  });

  it("orphanableWork reports what deactivating a manager would strand", async () => {
    await configure(ids.mgrA, ids.mgrB);
    const base = await pendingBaseline();
    await classifiedRequest();
    await procurementRequest();
    expect(await orphanableWork(ids.mgrA)).toEqual({ items: 2, requests: 1, classification: 0 });
    expect(await orphanableWork(ids.mgrB)).toMatchObject({ items: 2, requests: 1, classification: base + 1 });
    expect(await orphanableWork(ids.mgrC)).toEqual({ items: 0, requests: 0, classification: 0 });
  });
});
