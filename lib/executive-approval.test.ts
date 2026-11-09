import type { ApprovalStepType } from "@prisma/client";
import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { executeExecutiveHandover, previewExecutiveHandover } from "./executive-handover";

// Only the session lookup is replaced, so the route handlers' own authorisation runs for real.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));
import { POST as ASK_ROUTE } from "@/app/api/requests/[id]/deferred-requests/route";
import { POST as DECIDE_ROUTE } from "@/app/api/requests/[id]/executive-approval/decisions/route";
import { POST as HANDOVER_ROUTE, GET as HANDOVER_PREVIEW_ROUTE } from "@/app/api/admin/executive-handover/route";
import { POST as ROLES_ROUTE } from "@/app/api/admin/approval-roles/route";
import { branchApprove, departmentApprove, executiveApprove, financeApprove, warehouseCheck } from "./workflow";
import { completeProcurement, getProcurementDetail, recordPurchase, voidPurchase } from "./procurement";
import { createDeferredRequest, decideAdditionalApproval, getApprovalSummary } from "./executive-approval";

// Executive partial approval & deferred procurement against the isolated test
// database, driven through the real workflow (department head -> warehouse ->
// branch -> finance -> executive). Nothing is mocked. Every request carries a
// per-run tag; the cleanup removes this file's rows, temporarily disabling the
// immutability trigger of the decision tables (test database only -- the guard
// in vitest.setup.ts refuses any other database).
const PIN = "1234";
const PIN_NEW = "5678"; // the new executive's own PIN
const TAG = Date.now().toString(36);
const P = "ex-";
const ids = {
  dept: `${P}dept-${TAG}`,
  emp: `${P}emp`,
  head: `${P}head`,
  store: `${P}store`,
  branch: `${P}branch`,
  fin: `${P}fin`,
  exec: `${P}exec`,
  exec2: `${P}exec2`, // a DIRECTOR who is NOT this request's executive
  execOld: `${P}exec-old`, // an executive who gets replaced (handover tests)
  execNew: `${P}exec-new`, // the current EXECUTIVE_DIRECTOR position holder (handover tests)
  admin: `${P}admin`,
  mgr3: `${P}manager-3`, // a MANAGER who holds no procurement position
  acct: `${P}acct`,
  mgr1: `${P}manager-1`,
  mgr2: `${P}manager-2`,
  warehouse: `${P}wh`,
};
const MATERIALS = {
  cement: { id: `${P}mat-cement`, name: `EAX${TAG} Cement` },
  bearing: { id: `${P}mat-bearing`, name: `EAX${TAG} Bearing` },
  sand: { id: `${P}mat-sand`, name: `EAX${TAG} Sand` },
  washer: { id: `${P}mat-washer`, name: `EAX${TAG} Washer` },
  bolt: { id: `${P}mat-bolt`, name: `EAX${TAG} Bolt` },
};
type MatKey = keyof typeof MATERIALS;
let counter = 0;

async function cleanup() {
  const mine = { requestNumber: { startsWith: "EAX-" } };
  const ofRequest = { request: mine };
  // The immutability trigger is the point of the feature; the test database may drop it only here.
  await prisma.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalDecision" DISABLE TRIGGER USER`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalAllocation" DISABLE TRIGGER USER`);
  try {
    await prisma.executiveApprovalAllocation.deleteMany({ where: { decision: ofRequest } });
    await prisma.executiveApprovalDecision.deleteMany({ where: ofRequest });
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalDecision" ENABLE TRIGGER USER`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalAllocation" ENABLE TRIGGER USER`);
  }
  await prisma.deferredApprovalRequestItem.deleteMany({ where: { deferredRequest: ofRequest } });
  await prisma.deferredApprovalRequest.deleteMany({ where: ofRequest });
  await prisma.procurementPurchase.deleteMany({ where: { requestItem: ofRequest } });
  await prisma.stockIssue.deleteMany({ where: { reservation: { requestItem: ofRequest } } });
  await prisma.stockReservation.deleteMany({ where: { requestItem: ofRequest } });
  await prisma.warehouseCheck.deleteMany({ where: ofRequest });
  await prisma.approvalAction.deleteMany({ where: { approvalStep: ofRequest } });
  await prisma.accountingRecord.deleteMany({ where: ofRequest });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: mine });
  await prisma.user.updateMany({ where: { id: { startsWith: P } }, data: { departmentId: null } });
  await prisma.department.updateMany({ where: { id: { startsWith: P } }, data: { headId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
}

// The whole file runs in ASSIGNED mode (Domestic = mgr1, International = mgr2), the only mode in
// which a procurement officer may ask for more. The positions are global rows, so the ones that
// exist are parked here and restored afterwards.
const PROCUREMENT_ROLES = ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] as const;
let parkedPositions: string[] = [];

async function enableAssignedMode() {
  const existing = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: [...PROCUREMENT_ROLES] }, userId: { not: { startsWith: P } } } });
  parkedPositions = existing.map((e) => e.id);
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: parkedPositions } }, data: { isActive: false } });
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.approvalRoleAssignment.createMany({
    data: [
      { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: ids.mgr1, isActive: true },
      { role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: ids.mgr2, isActive: true },
    ],
  });
}
async function restoreModes() {
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: parkedPositions } }, data: { isActive: true, endedAt: null } });
}
/** LEGACY mode = no active procurement positions at all. */
async function withLegacyMode<T>(fn: () => Promise<T>): Promise<T> {
  await prisma.approvalRoleAssignment.updateMany({ where: { userId: { startsWith: P } }, data: { isActive: false } });
  try {
    return await fn();
  } finally {
    await prisma.approvalRoleAssignment.updateMany({ where: { userId: { startsWith: P } }, data: { isActive: true } });
  }
}
/** The International manager confirms the classification and every item that needs buying is assigned to the Domestic manager (mgr1). */
async function classifyAll(b: Built) {
  await prisma.procurementClassification.upsert({ where: { requestId: b.requestId }, update: {}, create: { requestId: b.requestId, confirmedById: ids.mgr2 } });
  for (const itemId of Object.values(b.itemIds)) {
    await prisma.procurementItemAssignment.upsert({
      where: { requestItemId: itemId! },
      update: { assignedManagerId: ids.mgr1 },
      create: { requestItemId: itemId!, kind: "DOMESTIC", assignedManagerId: ids.mgr1 },
    });
  }
}

afterAll(async () => {
  await cleanup();
  await restoreModes();
});

beforeAll(async () => {
  await cleanup();
  await restoreModes();
  await prisma.department.upsert({ where: { id: ids.dept }, update: {}, create: { id: ids.dept, name: `EAX${TAG} Dept`, type: "FACTORY" } });
  const users: [string, "EMPLOYEE" | "BOSS" | "STOREKEEPER" | "ENGINEERING" | "DIRECTOR" | "CHIEF_ACCOUNTANT" | "MANAGER" | "ADMIN", string | null][] = [
    [ids.emp, "EMPLOYEE", ids.dept],
    [ids.head, "BOSS", ids.dept],
    [ids.store, "STOREKEEPER", null],
    [ids.branch, "ENGINEERING", null],
    [ids.fin, "DIRECTOR", null],
    [ids.exec, "DIRECTOR", null],
    [ids.exec2, "DIRECTOR", null],
    [ids.acct, "CHIEF_ACCOUNTANT", null],
    [ids.mgr1, "MANAGER", null],
    [ids.mgr2, "MANAGER", null],
    [ids.mgr3, "MANAGER", null],
    [ids.execOld, "DIRECTOR", null],
    [ids.execNew, "DIRECTOR", null],
    [ids.admin, "ADMIN", null],
  ];
  const pinHash = await bcrypt.hash(PIN, 10);
  const pinHashNew = await bcrypt.hash(PIN_NEW, 10);
  for (const [id, role, departmentId] of users) {
    await prisma.user.upsert({
      where: { id },
      update: { role, isActive: true, departmentId },
      create: { id, email: `${id}@test.local`, name: id, role, departmentId, passwordHash: "unused" },
    });
  }
  await prisma.approvalPinCredential.upsert({ where: { userId: ids.execNew }, update: { pinHash: pinHashNew, failedAttempts: 0, lockedUntil: null }, create: { userId: ids.execNew, pinHash: pinHashNew } });
  for (const userId of [ids.head, ids.store, ids.branch, ids.fin, ids.exec, ids.exec2, ids.execOld]) {
    await prisma.approvalPinCredential.upsert({ where: { userId }, update: { pinHash, failedAttempts: 0, lockedUntil: null }, create: { userId, pinHash } });
  }
  await prisma.department.update({ where: { id: ids.dept }, data: { headId: ids.head } });
  await enableAssignedMode();
  await prisma.warehouse.upsert({ where: { id: ids.warehouse }, update: {}, create: { id: ids.warehouse, name: "EA wh" } });
  for (const [i, m] of Object.values(MATERIALS).entries()) {
    await prisma.material.upsert({
      where: { id: m.id },
      update: { name: m.name },
      create: { id: m.id, code: `EAX-${TAG}-${i}`, name: m.name, unit: "ш", defaultPrice: 1000 },
    });
  }
});

async function setStock(stock: Partial<Record<MatKey, number>>) {
  for (const key of Object.keys(MATERIALS) as MatKey[]) {
    const quantityOnHand = stock[key] ?? 0;
    await prisma.inventoryBalance.upsert({
      where: { materialId_warehouseId: { materialId: MATERIALS[key].id, warehouseId: ids.warehouse } },
      update: { quantityOnHand, quantityReserved: 0 },
      create: { materialId: MATERIALS[key].id, warehouseId: ids.warehouse, quantityOnHand },
    });
  }
}

interface Built {
  requestId: string;
  itemIds: Partial<Record<MatKey, string>>;
  requestNumber: string;
}
const item = (b: Built, key: MatKey) => b.itemIds[key]!;

async function createRequest(wanted: Partial<Record<MatKey, number>>, executive: string = ids.exec): Promise<Built> {
  counter += 1;
  const requestNumber = `EAX-${TAG}-${counter}`;
  const keys = Object.keys(wanted) as MatKey[];
  const types: ApprovalStepType[] = ["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL", "MANAGER_PROCUREMENT", "ACCOUNTING_RECORD"];
  const assignee: Record<string, string | null> = {
    DEPARTMENT_HEAD: ids.head, WAREHOUSE_CHECK: ids.store, BRANCH_APPROVAL: ids.branch, FINANCE_APPROVAL: ids.fin,
    EXECUTIVE_APPROVAL: executive, MANAGER_PROCUREMENT: null, ACCOUNTING_RECORD: ids.acct,
  };
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber,
      year: 9998,
      sequence: counter,
      departmentId: ids.dept,
      requestedById: ids.emp,
      status: "PENDING_DEPARTMENT_APPROVAL",
      submittedAt: new Date(),
      items: {
        create: keys.map((k, i) => ({
          lineNo: i + 1,
          materialId: MATERIALS[k].id,
          manualMaterialName: MATERIALS[k].name,
          unit: "ш",
          requestedQuantity: wanted[k]!,
          unitPrice: 1000,
          totalPrice: wanted[k]! * 1000,
        })),
      },
      approvalSteps: { create: types.map((type, i) => ({ type, sequence: i + 1, status: "PENDING" as const, assignedUserId: assignee[type] })) },
    },
    include: { items: true },
  });
  const itemIds: Built["itemIds"] = {};
  for (const it of created.items) itemIds[(Object.keys(MATERIALS) as MatKey[]).find((k) => MATERIALS[k].id === it.materialId)!] = it.id;
  return { requestId: created.id, itemIds, requestNumber };
}

/** Department head -> warehouse -> branch -> finance. Returns the version the executive must approve with. */
async function toExecutive(b: Built) {
  const items = await prisma.materialRequestItem.findMany({ where: { requestId: b.requestId } });
  const a = await departmentApprove(b.requestId, ids.head, PIN, 1);
  if (!a.ok) throw new Error(`department: ${a.error}`);
  const stock = new Map((await prisma.inventoryBalance.findMany({ where: { warehouseId: ids.warehouse } })).map((s) => [s.materialId, Number(s.quantityOnHand)]));
  const w = await warehouseCheck(b.requestId, ids.store, items.map((i) => ({ requestItemId: i.id, availableQuantity: stock.get(i.materialId!) ?? 0 })), PIN, a.request.version);
  if (!w.ok) throw new Error(`warehouse: ${w.error}`);
  const br = await branchApprove(b.requestId, ids.branch, PIN, w.request.version);
  if (!br.ok) throw new Error(`branch: ${br.error}`);
  const f = await financeApprove(b.requestId, ids.fin, PIN, br.request.version);
  if (!f.ok) throw new Error(`finance: ${f.error}`);
  return f.request.version;
}

/** Request at the executive step with nothing decided yet. */
async function atExecutive(wanted: Partial<Record<MatKey, number>>, stock: Partial<Record<MatKey, number>> = {}, executive: string = ids.exec) {
  await setStock(stock);
  const b = await createRequest(wanted, executive);
  const version = await toExecutive(b);
  return { ...b, version };
}

/** Executive partially approves `now` (item key -> quantity) and the request reaches procurement. */
async function partiallyApproved(wanted: Partial<Record<MatKey, number>>, now: Partial<Record<MatKey, number>>, stock: Partial<Record<MatKey, number>> = {}, comment = "Эхний хэсгийг одоо авна", executive: string = ids.exec) {
  const b = await atExecutive(wanted, stock, executive);
  const res = await executiveApprove(b.requestId, executive, PIN, b.version, {
    allocations: (Object.keys(now) as MatKey[]).map((k) => ({ itemId: item(b, k), quantity: now[k]! })),
    comment,
  });
  if (!res.ok) throw new Error(`executive: ${res.error}`);
  await classifyAll(b);
  return b;
}

let uid = 0;
const cid = () => `client-${TAG}-${++uid}-${Math.random().toString(36).slice(2, 8)}`;

const summaryOf = async (b: Built, who = ids.exec, role = "DIRECTOR") => (await getApprovalSummary(b.requestId, who, role))!;
const itemSummary = async (b: Built, key: MatKey) => (await summaryOf(b)).items.find((i) => i.itemId === item(b, key))!;
const statusOf = async (b: Built) => (await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } })).status;

/** Executive approves additional quantities (optionally resolving a procurement officer's request). */
async function approveMore(b: Built, items: Partial<Record<MatKey, number>> | undefined, extra: { deferredRequestId?: string; comment?: string; pin?: string; who?: string; revision?: number; clientRequestId?: string } = {}) {
  const current = await summaryOf(b);
  return decideAdditionalApproval(b.requestId, extra.who ?? ids.exec, {
    action: "APPROVE",
    pin: extra.pin ?? PIN,
    items: items ? (Object.keys(items) as MatKey[]).map((k) => ({ itemId: item(b, k), quantity: items[k]! })) : undefined,
    comment: extra.comment,
    deferredRequestId: extra.deferredRequestId,
    clientRequestId: extra.clientRequestId ?? cid(),
    expectedRevision: extra.revision ?? current.revision,
  });
}

const askMore = (b: Built, items: Partial<Record<MatKey, number>>, reason = "Нийлүүлэгчийн үнэ өөрчлөгдсөн", who = ids.mgr1, clientRequestId = cid()) =>
  createDeferredRequest(b.requestId, who, { items: (Object.keys(items) as MatKey[]).map((k) => ({ itemId: item(b, k), quantity: items[k]! })), reason, clientRequestId });

const buy = (b: Built, key: MatKey, quantity: number, who = ids.mgr1) => recordPurchase(b.requestId, who, { itemId: item(b, key), quantity, unitPrice: 1000, clientRequestId: cid() });

describe("1. initial executive decision: full and partial", () => {
  it("approves 50 of 100 and keeps the rest deferred, never touching the requested quantity", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
    const s = await summaryOf(b);
    expect(s.authorizationStatus).toBe("PARTIALLY_AUTHORIZED");
    expect(s.items[0]).toMatchObject({ requestedQuantity: 100, requiredQuantity: 100, authorizedQuantity: 50, deferredQuantity: 50, approvalPercentage: 50 });
    expect(s).toMatchObject({ requiredTotal: 100, authorizedTotal: 50, deferredTotal: 50, approvalPercentage: 50, revision: 1 });
    const stored = await prisma.materialRequestItem.findUniqueOrThrow({ where: { id: item(b, "cement") } });
    expect(Number(stored.requestedQuantity)).toBe(100);
    // the decision is a persisted event with who/when/comment
    expect(s.decisions).toHaveLength(1);
    expect(s.decisions[0]).toMatchObject({ sequence: 1, kind: "INITIAL_PARTIAL", decidedByName: ids.exec, comment: "Эхний хэсгийг одоо авна", approvedTotalAfter: 50 });
    expect(s.decisions[0].allocations).toEqual([expect.objectContaining({ quantity: 50, cumulativeAfter: 50 })]);
    expect(s.decisions[0].decidedAt).toBeTruthy();
  });

  it("a plain approval (no quantities) still approves everything and is recorded as INITIAL_FULL", async () => {
    const b = await atExecutive({ cement: 30, bearing: 5 });
    const res = await executiveApprove(b.requestId, ids.exec, PIN, b.version);
    expect(res.ok).toBe(true);
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
    const s = await summaryOf(b);
    expect(s.authorizationStatus).toBe("FULLY_AUTHORIZED");
    expect(s).toMatchObject({ deferredTotal: 0, approvalPercentage: 100, revision: 1 });
    expect(s.decisions[0].kind).toBe("INITIAL_FULL");
    expect((await getProcurementDetail(b.requestId))!.authorizationStatus).toBe("FULLY_AUTHORIZED");
  });

  it("rejects invalid initial quantities and leaves the request untouched at the executive step", async () => {
    const b = await atExecutive({ cement: 100, bearing: 10 });
    const bad = async (allocations: { itemId: string; quantity: number }[]) => {
      const r = await executiveApprove(b.requestId, ids.exec, PIN, b.version, { allocations });
      expect(r.ok).toBe(false);
      expect(await statusOf(b)).toBe("PENDING_EXECUTIVE_APPROVAL");
      expect(await prisma.executiveApprovalDecision.count({ where: { requestId: b.requestId } })).toBe(0);
      return r;
    };
    expect((await bad([{ itemId: item(b, "cement"), quantity: 100.5 }])).ok).toBe(false); // over the requirement
    await bad([{ itemId: item(b, "cement"), quantity: 0 }]); // zero
    await bad([{ itemId: item(b, "cement"), quantity: -1 }]); // negative
    await bad([{ itemId: item(b, "cement"), quantity: 1.2345 }]); // 4 decimals
    await bad([{ itemId: "no-such-item", quantity: 1 }]);
    await bad([{ itemId: item(b, "cement"), quantity: 5 }, { itemId: item(b, "cement"), quantity: 5 }]); // repeated item
    await bad([]); // nothing
    // and the same request is still approvable afterwards
    const ok = await executiveApprove(b.requestId, ids.exec, PIN, b.version, { allocations: [{ itemId: item(b, "cement"), quantity: 40 }] });
    expect(ok.ok).toBe(true);
  });
});

describe("2. sequential decisions", () => {
  it("50 -> +20 = 70 approved, 30 deferred, history keeps every step; up to full resolution", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const second = await approveMore(b, { cement: 20 }, { comment: "Ещё немного" });
    expect(second.ok).toBe(true);
    let s = await summaryOf(b);
    expect(s.items[0]).toMatchObject({ authorizedQuantity: 70, deferredQuantity: 30, approvalPercentage: 70 });
    expect(s.decisions.map((d) => [d.sequence, d.kind, d.allocations[0].quantity, d.allocations[0].cumulativeAfter])).toEqual([
      [1, "INITIAL_PARTIAL", 50, 50],
      [2, "SUBSEQUENT", 20, 70],
    ]);
    expect(s.revision).toBe(2);

    expect((await approveMore(b, { cement: 30.001 })).ok).toBe(false); // over what is left
    expect((await approveMore(b, { cement: 30 })).ok).toBe(true);
    s = await summaryOf(b);
    expect(s.authorizationStatus).toBe("FULLY_AUTHORIZED");
    expect(s.items[0].deferredQuantity).toBe(0);
    // nothing left to decide
    const none = await approveMore(b, { cement: 1 });
    expect(none.ok).toBe(false);
  });

  it("handles several materials and decimal quantities exactly", async () => {
    const b = await partiallyApproved({ cement: 12.5, bearing: 3.75, sand: 2 }, { cement: 5.125, bearing: 3.75 });
    let s = await summaryOf(b);
    expect(s.items.find((i) => i.itemId === item(b, "cement"))).toMatchObject({ authorizedQuantity: 5.125, deferredQuantity: 7.375 });
    expect(s.items.find((i) => i.itemId === item(b, "bearing"))).toMatchObject({ authorizedQuantity: 3.75, deferredQuantity: 0 });
    expect(s.items.find((i) => i.itemId === item(b, "sand"))).toMatchObject({ authorizedQuantity: 0, deferredQuantity: 2 });
    expect(s.authorizationStatus).toBe("PARTIALLY_AUTHORIZED");
    expect(s.requiredTotal).toBe(18.25);
    expect(s.authorizedTotal).toBe(8.875);

    expect((await approveMore(b, { cement: 7.3751 })).ok).toBe(false); // 4 decimals
    expect((await approveMore(b, { bearing: 0.001 })).ok).toBe(false); // nothing deferred on bearing
    expect((await approveMore(b, { cement: 7.375, sand: 2 })).ok).toBe(true);
    s = await summaryOf(b);
    expect(s.authorizationStatus).toBe("FULLY_AUTHORIZED");
    expect(s.items.find((i) => i.itemId === item(b, "cement"))!.authorizedQuantity).toBe(12.5);
  });

  it("an item with a partial requirement keeps its percentage per item and in total", async () => {
    const b = await partiallyApproved({ cement: 10, sand: 30 }, { cement: 10, sand: 10 });
    const s = await summaryOf(b);
    expect(s.items.map((i) => i.approvalPercentage)).toEqual([100, 33.33]);
    expect(s.approvalPercentage).toBe(50);
  });
});

describe("3. warehouse-issued stock", () => {
  it("authorises only the shortfall: stock-covered items cannot be allocated and the cap is the shortfall", async () => {
    // bolt: requested 10, 4 in stock -> 6 to buy; washer: requested 6, 10 in stock -> nothing to buy
    const b = await atExecutive({ bolt: 10, washer: 6, cement: 8 }, { bolt: 4, washer: 10 });
    const bolt0 = await executiveApprove(b.requestId, ids.exec, PIN, b.version, { allocations: [{ itemId: item(b, "bolt"), quantity: 7 }] });
    expect(bolt0.ok).toBe(false); // 7 > shortfall 6
    const washer = await executiveApprove(b.requestId, ids.exec, PIN, b.version, { allocations: [{ itemId: item(b, "washer"), quantity: 1 }] });
    expect(washer.ok).toBe(false);
    const ok = await executiveApprove(b.requestId, ids.exec, PIN, b.version, { allocations: [{ itemId: item(b, "bolt"), quantity: 2 }, { itemId: item(b, "cement"), quantity: 8 }] });
    expect(ok.ok).toBe(true);
    const s = await summaryOf(b);
    expect(s.items.find((i) => i.itemId === item(b, "bolt"))).toMatchObject({ requestedQuantity: 10, issuedQuantity: 4, requiredQuantity: 6, authorizedQuantity: 2, deferredQuantity: 4 });
    expect(s.items.find((i) => i.itemId === item(b, "washer"))).toMatchObject({ requiredQuantity: 0, authorizedQuantity: 0, deferredQuantity: 0, approvalPercentage: 100 });
    expect(s.requiredTotal).toBe(14); // 6 + 8
    // a full plain approval approves exactly the shortfall too
    const c = await atExecutive({ bolt: 10 }, { bolt: 4 });
    expect((await executiveApprove(c.requestId, ids.exec, PIN, c.version)).ok).toBe(true);
    expect((await itemSummary(c, "bolt")).authorizedQuantity).toBe(6);
  });
});

describe("4. procurement is capped by the authorised quantity (server-side)", () => {
  it("approved 50, committed 30, remaining 20: 21 is rejected, 20 accepted, then nothing more", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    expect((await buy(b, "cement", 30)).ok).toBe(true);
    const over = await buy(b, "cement", 21);
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.status).toBe(409);
      expect(over.error).toContain("20");
    }
    expect((await buy(b, "cement", 20)).ok).toBe(true);
    const more = await buy(b, "cement", 0.001);
    expect(more.ok).toBe(false);
    const view = (await getProcurementDetail(b.requestId))!.items[0];
    expect(view).toMatchObject({ requiredQuantity: 100, authorizedQuantity: 50, deferredQuantity: 50, purchasedQuantity: 50, remainingAuthorizedQuantity: 0 });
  });

  it("a later executive approval unlocks exactly the added quantity", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    expect((await buy(b, "cement", 50)).ok).toBe(true);
    expect((await buy(b, "cement", 1)).ok).toBe(false);
    expect((await approveMore(b, { cement: 20 })).ok).toBe(true);
    expect((await buy(b, "cement", 21)).ok).toBe(false);
    expect((await buy(b, "cement", 20)).ok).toBe(true);
    expect((await buy(b, "cement", 1)).ok).toBe(false);
  });

  it("voided purchases free their quantity; a replacement may not exceed the authorisation", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const first = await buy(b, "cement", 50);
    expect(first.ok).toBe(true);
    const purchase = (await getProcurementDetail(b.requestId))!.items[0].purchases[0];
    const tooBig = await voidPurchase(b.requestId, ids.mgr1, purchase.id, "Тоо буруу", { quantity: 60 });
    expect(tooBig.ok).toBe(false);
    expect((await voidPurchase(b.requestId, ids.mgr1, purchase.id, "Тоо буруу", { quantity: 45 })).ok).toBe(true);
    expect((await buy(b, "cement", 5)).ok).toBe(true);
    expect((await buy(b, "cement", 1)).ok).toBe(false);
  });

  it("the request cannot be completed while quantity is deferred, even if everything authorised is bought", async () => {
    const b = await partiallyApproved({ cement: 10 }, { cement: 6 });
    expect((await buy(b, "cement", 6)).ok).toBe(true);
    const done = await completeProcurement(b.requestId, ids.mgr1);
    expect(done.ok).toBe(false);
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
    expect((await approveMore(b, { cement: 4 })).ok).toBe(true);
    expect((await buy(b, "cement", 4)).ok).toBe(true);
    expect((await completeProcurement(b.requestId, ids.mgr1)).ok).toBe(true);
    expect(await statusOf(b)).toBe("PENDING_ACCOUNTING");
  });

  it("concurrent purchases cannot pass the authorised limit", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const results = await Promise.all([20, 20, 20, 20, 20].map((q) => buy(b, "cement", q)));
    expect(results.filter((r) => r.ok)).toHaveLength(2); // 20 + 20 = 40; the next 20 would make 60 > 50
    expect((await itemSummary(b, "cement")).purchasedQuantity).toBe(40);
    expect((await buy(b, "cement", 10)).ok).toBe(true);
  });
});

describe("5. authorization", () => {
  it("only this request's executive director can decide: other DIRECTORs, managers and employees are refused", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    for (const who of [ids.exec2, ids.fin, ids.mgr1, ids.emp, ids.head, ids.store]) {
      const r = await approveMore(b, { cement: 10 }, { who });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
    expect((await itemSummary(b, "cement")).authorizedQuantity).toBe(50);
    // the initial decision is refused the same way
    const c = await atExecutive({ cement: 10 });
    const refused = await executiveApprove(c.requestId, ids.exec2, PIN, c.version);
    expect(refused.ok).toBe(false);
    expect(await statusOf(c)).toBe("PENDING_EXECUTIVE_APPROVAL");
  });

  it("a deactivated executive cannot decide", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    await prisma.user.update({ where: { id: ids.exec }, data: { isActive: false } });
    try {
      const r = await approveMore(b, { cement: 10 });
      expect(r.ok).toBe(false);
    } finally {
      await prisma.user.update({ where: { id: ids.exec }, data: { isActive: true } });
    }
  });

  it("only an active MANAGER may ask for more; the executive and others may not", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    for (const who of [ids.exec, ids.exec2, ids.emp, ids.store, ids.fin]) {
      const r = await askMore(b, { cement: 10 }, "x", who);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
    expect(await prisma.deferredApprovalRequest.count({ where: { requestId: b.requestId } })).toBe(0);
    expect((await askMore(b, { cement: 10 })).ok).toBe(true);
  });

  it("the summary tells each viewer what they may do", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    expect(await summaryOf(b, ids.exec, "DIRECTOR")).toMatchObject({ viewerCanDecide: true, viewerCanRequest: false });
    expect(await summaryOf(b, ids.exec2, "DIRECTOR")).toMatchObject({ viewerCanDecide: false, viewerCanRequest: false });
    expect(await summaryOf(b, ids.mgr1, "MANAGER")).toMatchObject({ viewerCanDecide: false, viewerCanRequest: true });
    await askMore(b, { cement: 10 });
    expect(await summaryOf(b, ids.mgr1, "MANAGER")).toMatchObject({ viewerCanRequest: false }); // one pending at a time
  });

  it("decisions are refused at the wrong stage", async () => {
    const b = await atExecutive({ cement: 10 });
    const early = await decideAdditionalApproval(b.requestId, ids.exec, { action: "APPROVE", pin: PIN, items: [{ itemId: item(b, "cement"), quantity: 1 }], clientRequestId: cid(), expectedRevision: 0 });
    expect(early.ok).toBe(false);
    const earlyAsk = await askMore(b, { cement: 1 });
    expect(earlyAsk.ok).toBe(false);
  });
});

describe("6. PIN", () => {
  it("a wrong PIN records nothing; the right PIN then works", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const before = await prisma.auditLog.count({ where: { actorId: ids.exec, action: "PIN_FAILURE" } });
    const wrong = await approveMore(b, { cement: 10 }, { pin: "0000" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { actorId: ids.exec, action: "PIN_FAILURE" } })).toBe(before + 1);
    expect((await itemSummary(b, "cement")).authorizedQuantity).toBe(50);
    expect((await approveMore(b, { cement: 10 })).ok).toBe(true);
    expect((await prisma.approvalPinCredential.findUniqueOrThrow({ where: { userId: ids.exec } })).failedAttempts).toBe(0);
  });

  it("an initial partial approval with a wrong PIN changes nothing", async () => {
    const b = await atExecutive({ cement: 10 });
    const r = await executiveApprove(b.requestId, ids.exec, "9999", b.version, { allocations: [{ itemId: item(b, "cement"), quantity: 5 }] });
    expect(r.ok).toBe(false);
    expect(await statusOf(b)).toBe("PENDING_EXECUTIVE_APPROVAL");
    expect(await prisma.executiveApprovalDecision.count({ where: { requestId: b.requestId } })).toBe(0);
  });

  it("no PIN or PIN hash ever reaches the audit trail", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    await approveMore(b, { cement: 10 }, { pin: "0000" });
    await approveMore(b, { cement: 10 });
    const logs = await prisma.auditLog.findMany({ where: { actorId: ids.exec, entityType: "ExecutiveApprovalDecision" } });
    expect(logs.length).toBeGreaterThan(0);
    const hash = (await prisma.approvalPinCredential.findUniqueOrThrow({ where: { userId: ids.exec } })).pinHash;
    for (const l of logs) {
      expect(l.afterJson ?? "").not.toContain(PIN);
      expect(l.afterJson ?? "").not.toContain(hash);
      expect(l.beforeJson ?? "").not.toContain(hash);
    }
  });
});

describe("7. duplicates and concurrency", () => {
  it("a retried decision (same clientRequestId) is applied once", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const key = cid();
    const first = await approveMore(b, { cement: 20 }, { clientRequestId: key });
    expect(first.ok && !first.duplicate).toBe(true);
    const retry = await approveMore(b, { cement: 20 }, { clientRequestId: key, revision: 1 });
    expect(retry.ok && retry.duplicate).toBe(true);
    expect((await itemSummary(b, "cement")).authorizedQuantity).toBe(70);
    expect(await prisma.executiveApprovalDecision.count({ where: { requestId: b.requestId } })).toBe(2);
  });

  it("a stale page (old revision) is refused", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    expect((await approveMore(b, { cement: 10 })).ok).toBe(true);
    const stale = await approveMore(b, { cement: 10 }, { revision: 1 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);
    expect((await itemSummary(b, "cement")).authorizedQuantity).toBe(60);
  });

  it("two simultaneous decisions: exactly one wins and the limit holds", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const results = await Promise.all([approveMore(b, { cement: 40 }, { revision: 1 }), approveMore(b, { cement: 40 }, { revision: 1 }), approveMore(b, { cement: 40 }, { revision: 1 })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const s = await summaryOf(b);
    expect(s.items[0].authorizedQuantity).toBe(90);
    expect(s.revision).toBe(2);
    expect(await prisma.executiveApprovalDecision.count({ where: { requestId: b.requestId } })).toBe(2);
  });

  it("a retried procurement-officer request is acknowledged once; a second pending request is refused", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const key = cid();
    const first = await askMore(b, { cement: 10 }, "Нэмэлт", ids.mgr1, key);
    expect(first.ok && !first.duplicate).toBe(true);
    const retry = await askMore(b, { cement: 10 }, "Нэмэлт", ids.mgr1, key);
    expect(retry.ok && retry.duplicate).toBe(true);
    const second = await askMore(b, { cement: 5 }, "Өөр", ids.mgr1);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
    expect(await prisma.deferredApprovalRequest.count({ where: { requestId: b.requestId } })).toBe(1);
  });

  it("simultaneous requests from two officers: the database allows only one pending", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const results = await Promise.all([askMore(b, { cement: 10 }, "a", ids.mgr1), askMore(b, { cement: 10 }, "b", ids.mgr1), askMore(b, { cement: 10 }, "c", ids.mgr1)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.deferredApprovalRequest.count({ where: { requestId: b.requestId, status: "PENDING" } })).toBe(1);
  });

  it("an approval racing purchases never lets the total pass what was authorised at that moment", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const [, ...purchases] = await Promise.all([approveMore(b, { cement: 10 }, { revision: 1 }), ...[15, 15, 15, 15, 15].map((q) => buy(b, "cement", q))]);
    const bought = (await itemSummary(b, "cement")).purchasedQuantity;
    const authorized = (await itemSummary(b, "cement")).authorizedQuantity;
    expect(authorized).toBe(60);
    expect(bought).toBeLessThanOrEqual(authorized);
    expect(bought % 15).toBe(0);
    expect(purchases.some((r) => !r.ok)).toBe(true);
  });
});

describe("8. procurement officer's request for additional approval", () => {
  it("is validated against what is still deferred", async () => {
    const b = await partiallyApproved({ cement: 100, bearing: 10 }, { cement: 50, bearing: 10 });
    expect((await askMore(b, { cement: 51 })).ok).toBe(false); // only 50 deferred
    expect((await askMore(b, { bearing: 1 })).ok).toBe(false); // nothing deferred on bearing
    expect((await askMore(b, { cement: 0 })).ok).toBe(false);
    expect((await askMore(b, { cement: 1.2345 })).ok).toBe(false);
    expect((await askMore(b, {})).ok).toBe(false);
    expect((await createDeferredRequest(b.requestId, ids.mgr1, { items: [{ itemId: item(b, "cement"), quantity: 5 }], reason: "   ", clientRequestId: cid() })).ok).toBe(false);
    expect(await prisma.deferredApprovalRequest.count({ where: { requestId: b.requestId } })).toBe(0);
    const ok = await askMore(b, { cement: 50 }, "Нийлүүлэгч бэлэн болсон");
    expect(ok.ok).toBe(true);
  });

  it("notifies the executive, grants nothing by itself, and the officer cannot approve", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const made = await askMore(b, { cement: 30 }, "Яаралтай хэрэгтэй");
    expect(made.ok).toBe(true);
    expect(await prisma.notification.count({ where: { userId: ids.exec, relatedRequestId: b.requestId, type: "APPROVAL_REQUIRED", body: { contains: "Яаралтай хэрэгтэй" } } })).toBe(1);
    const s = await summaryOf(b);
    expect(s.items[0].authorizedQuantity).toBe(50); // unchanged
    expect(s.pendingRequest).toMatchObject({ status: "PENDING", reason: "Яаралтай хэрэгтэй", requestedByName: ids.mgr1 });
    expect(s.pendingRequest!.items).toEqual([expect.objectContaining({ requestedQuantity: 30, approvedQuantity: null })]);
    expect((await buy(b, "cement", 51)).ok).toBe(false);
    // the officer cannot decide, not even by pointing at their own request
    const own = await decideAdditionalApproval(b.requestId, ids.mgr1, { action: "APPROVE", pin: PIN, deferredRequestId: s.pendingRequest!.id, clientRequestId: cid(), expectedRevision: 1 });
    expect(own.ok).toBe(false);
    expect((await itemSummary(b, "cement")).authorizedQuantity).toBe(50);
    expect(await prisma.auditLog.count({ where: { actorId: ids.mgr1, entityType: "DeferredApprovalRequest", action: "CREATE" } })).toBeGreaterThan(0);
  });

  it("executive approves all of it: request APPROVED, officer notified, quantity unlocked", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    await askMore(b, { cement: 30 });
    const pending = (await summaryOf(b)).pendingRequest!;
    const res = await approveMore(b, undefined, { deferredRequestId: pending.id, comment: "Зөвшөөрлөө" });
    expect(res.ok).toBe(true);
    const s = await summaryOf(b);
    expect(s.pendingRequest).toBeNull();
    expect(s.deferredRequests[0]).toMatchObject({ status: "APPROVED", decidedByName: ids.exec, decisionComment: "Зөвшөөрлөө" });
    expect(s.deferredRequests[0].items[0]).toMatchObject({ requestedQuantity: 30, approvedQuantity: 30 });
    expect(s.items[0]).toMatchObject({ authorizedQuantity: 80, deferredQuantity: 20 });
    expect(s.decisions.at(-1)).toMatchObject({ kind: "SUBSEQUENT", deferredRequestId: pending.id });
    expect(await prisma.notification.count({ where: { userId: ids.mgr1, relatedRequestId: b.requestId, type: "REQUEST_APPROVED" } })).toBe(1);
    expect((await buy(b, "cement", 80)).ok).toBe(true);
    // a new request is possible again
    expect((await askMore(b, { cement: 20 })).ok).toBe(true);
  });

  it("executive approves part of it: PARTIALLY_APPROVED, never more than proposed", async () => {
    const b = await partiallyApproved({ cement: 100, sand: 10 }, { cement: 50, sand: 5 });
    await askMore(b, { cement: 30, sand: 5 });
    const pending = (await summaryOf(b)).pendingRequest!;
    expect((await approveMore(b, { cement: 31 }, { deferredRequestId: pending.id })).ok).toBe(false); // above the proposal
    expect((await approveMore(b, { bearing: 1 } as never, { deferredRequestId: pending.id })).ok).toBe(false);
    const res = await approveMore(b, { cement: 10 }, { deferredRequestId: pending.id });
    expect(res.ok).toBe(true);
    const s = await summaryOf(b);
    expect(s.deferredRequests[0].status).toBe("PARTIALLY_APPROVED");
    expect(s.deferredRequests[0].items.map((i) => [i.requestedQuantity, i.approvedQuantity])).toEqual([[30, 10], [5, 0]]);
    expect(s.items.map((i) => i.authorizedQuantity)).toEqual([60, 5]);
    // already resolved
    expect((await approveMore(b, { cement: 5 }, { deferredRequestId: pending.id })).ok).toBe(false);
  });

  it("returning a request needs a reason, notifies the officer and keeps every approved quantity", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    await approveMore(b, { cement: 10 });
    await askMore(b, { cement: 30 });
    const pending = (await summaryOf(b)).pendingRequest!;
    const decide = (comment: string | undefined) =>
      decideAdditionalApproval(b.requestId, ids.exec, { action: "RETURN", comment, deferredRequestId: pending.id, clientRequestId: cid(), expectedRevision: 2 });
    expect((await decide(undefined)).ok).toBe(false);
    expect((await decide("   ")).ok).toBe(false);
    expect((await decide("Бюджет хүрэлцэхгүй")).ok).toBe(true);
    const s = await summaryOf(b);
    expect(s.items[0]).toMatchObject({ authorizedQuantity: 60, deferredQuantity: 40 }); // previously approved quantities stay
    expect(s.deferredRequests[0]).toMatchObject({ status: "RETURNED", decisionComment: "Бюджет хүрэлцэхгүй" });
    expect(s.decisions.at(-1)).toMatchObject({ kind: "DEFERRED_RETURN", comment: "Бюджет хүрэлцэхгүй", allocations: [] });
    expect(await prisma.notification.count({ where: { userId: ids.mgr1, relatedRequestId: b.requestId, type: "REQUEST_RETURNED", body: { contains: "Бюджет хүрэлцэхгүй" } } })).toBe(1);
    expect((await buy(b, "cement", 60)).ok).toBe(true); // can still buy what was approved
    expect((await buy(b, "cement", 1)).ok).toBe(false);
    expect((await askMore(b, { cement: 40 })).ok).toBe(true); // and ask again
  });

  it("a direct executive approval (no request from the officer) notifies the procurement officers", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    expect((await approveMore(b, { cement: 10 })).ok).toBe(true);
    for (const m of [ids.mgr1, ids.mgr2]) {
      expect(await prisma.notification.count({ where: { userId: m, relatedRequestId: b.requestId, type: "REQUEST_APPROVED" } })).toBe(1);
    }
  });
});

describe("9. persistence and audit", () => {
  it("decision rows are immutable in the database", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const decision = await prisma.executiveApprovalDecision.findFirstOrThrow({ where: { requestId: b.requestId }, include: { allocations: true } });
    await expect(prisma.executiveApprovalDecision.update({ where: { id: decision.id }, data: { comment: "changed" } })).rejects.toThrow();
    await expect(prisma.executiveApprovalDecision.delete({ where: { id: decision.id } })).rejects.toThrow();
    await expect(prisma.executiveApprovalAllocation.update({ where: { id: decision.allocations[0].id }, data: { quantity: 99 } })).rejects.toThrow();
    await expect(prisma.executiveApprovalAllocation.delete({ where: { id: decision.allocations[0].id } })).rejects.toThrow();
    const again = await prisma.executiveApprovalDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(again.comment).toBe("Эхний хэсгийг одоо авна");
  });

  it("the database refuses a second pending request and an allocation above the requirement", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    await prisma.deferredApprovalRequest.create({ data: { requestId: b.requestId, reason: "a", requestedById: ids.mgr1 } });
    await expect(prisma.deferredApprovalRequest.create({ data: { requestId: b.requestId, reason: "b", requestedById: ids.mgr2 } })).rejects.toThrow();
    const decision = await prisma.executiveApprovalDecision.findFirstOrThrow({ where: { requestId: b.requestId } });
    await expect(
      prisma.executiveApprovalAllocation.create({ data: { decisionId: decision.id, requestItemId: item(b, "cement"), quantity: 1, requiredQuantity: 100, cumulativeAfter: 101 } })
    ).rejects.toThrow();
    await expect(
      prisma.executiveApprovalDecision.create({ data: { requestId: b.requestId, sequence: 1, kind: "SUBSEQUENT", decidedById: ids.exec, requiredTotal: 1, approvedTotalAfter: 1 } })
    ).rejects.toThrow(); // (requestId, sequence) is unique
  });

  it("every decision writes an audit entry with the approver and the quantities", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    await approveMore(b, { cement: 20 });
    const decisions = await prisma.executiveApprovalDecision.findMany({ where: { requestId: b.requestId }, orderBy: { sequence: "asc" } });
    for (const d of decisions) {
      const log = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "ExecutiveApprovalDecision", entityId: d.id } });
      expect(log.actorId).toBe(ids.exec);
      expect(log.action).toBe("APPROVE");
      expect(JSON.parse(log.afterJson!)).toMatchObject({ requestId: b.requestId, sequence: d.sequence });
    }
  });
});

describe("10. legacy requests", () => {
  /** A request approved before this feature: approved, in procurement, and no decision rows. */
  async function legacy() {
    const b = await atExecutive({ cement: 20, bolt: 10 }, { bolt: 4 });
    expect((await executiveApprove(b.requestId, ids.exec, PIN, b.version)).ok).toBe(true);
    await classifyAll(b);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalDecision" DISABLE TRIGGER USER`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalAllocation" DISABLE TRIGGER USER`);
    try {
      await prisma.executiveApprovalAllocation.deleteMany({ where: { decision: { requestId: b.requestId } } });
      await prisma.executiveApprovalDecision.deleteMany({ where: { requestId: b.requestId } });
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalDecision" ENABLE TRIGGER USER`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalAllocation" ENABLE TRIGGER USER`);
    }
    return b;
  }

  it("reads as fully authorised, exactly the warehouse shortfall, no more", async () => {
    const b = await legacy();
    const s = await summaryOf(b);
    expect(s).toMatchObject({ legacy: true, authorizationStatus: "FULLY_AUTHORIZED", deferredTotal: 0, revision: 0, decisions: [] });
    expect(s.items.map((i) => [i.requiredQuantity, i.authorizedQuantity])).toEqual([[20, 20], [6, 6]]);
    expect((await buy(b, "cement", 20)).ok).toBe(true);
    expect((await buy(b, "cement", 1)).ok).toBe(false);
    expect((await buy(b, "bolt", 7)).ok).toBe(false); // shortfall is 6
    expect((await buy(b, "bolt", 6)).ok).toBe(true);
    expect((await completeProcurement(b.requestId, ids.mgr1)).ok).toBe(true);
  });

  it("gains no extra rights: nothing can be added or requested", async () => {
    const b = await legacy();
    const more = await approveMore(b, { cement: 1 });
    expect(more.ok).toBe(false);
    expect((await askMore(b, { cement: 1 })).ok).toBe(false);
    expect(await prisma.executiveApprovalDecision.count({ where: { requestId: b.requestId } })).toBe(0);
  });
});

// --- permission regression + executive handover -----------------------------------------------------------

const sessionAs = (id: string | null, role = "DIRECTOR") => {
  session.current = id ? { user: { id, role, name: id, email: `${id}@t.local`, departmentId: null } } : null;
};
const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const jsonReq = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const askBody = (b: Built, key: MatKey, quantity: number) => ({ items: [{ itemId: item(b, key), quantity }], reason: "Нэмэлт хэрэгтэй", clientRequestId: cid() });

describe("11. who may ask for more (permission regression)", () => {
  it("ASSIGNED: only a position holder who owns the item may ask; everyone else gets 403", async () => {
    const b = await partiallyApproved({ cement: 100, sand: 10 }, { cement: 50, sand: 5 });
    // sand belongs to the International manager (mgr2), cement to the Domestic manager (mgr1)
    await prisma.procurementItemAssignment.update({ where: { requestItemId: item(b, "sand") }, data: { kind: "INTERNATIONAL", assignedManagerId: ids.mgr2 } });

    const own = async (who: string, key: MatKey) => askMore(b, { [key]: 1 }, "x", who);
    for (const [who, key] of [[ids.mgr1, "sand"], [ids.mgr2, "cement"], [ids.mgr3, "cement"], [ids.mgr3, "sand"]] as const) {
      const r = await own(who, key);
      expect(r.ok, `${who} → ${key}`).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
    // a mixed request containing one foreign item is refused as a whole
    const mixed = await askMore(b, { cement: 1, sand: 1 }, "x", ids.mgr1);
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.status).toBe(403);
    expect(await prisma.deferredApprovalRequest.count({ where: { requestId: b.requestId } })).toBe(0);

    // the summary mirrors it: the item flags and who may ask (before anything is pending)
    const s1 = await summaryOf(b, ids.mgr1, "MANAGER");
    expect(s1).toMatchObject({ viewerCanRequest: true });
    expect(s1.items.map((i) => i.viewerMayRequest)).toEqual([true, false]);
    expect(await summaryOf(b, ids.mgr2, "MANAGER")).toMatchObject({ viewerCanRequest: true });
    expect(await summaryOf(b, ids.mgr3, "MANAGER")).toMatchObject({ viewerCanRequest: false });
    expect((await summaryOf(b, ids.mgr3, "MANAGER")).items.every((i) => !i.viewerMayRequest)).toBe(true);

    expect((await own(ids.mgr1, "cement")).ok).toBe(true);
  });

  it("ASSIGNED: a manager who lost the position, an inactive manager and unassigned items are all refused", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    // still the item's assignee, but no longer a position holder
    await prisma.approvalRoleAssignment.updateMany({ where: { userId: ids.mgr1 }, data: { isActive: false } });
    try {
      const r = await askMore(b, { cement: 1 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
      expect(await summaryOf(b, ids.mgr1, "MANAGER")).toMatchObject({ viewerCanRequest: false });
    } finally {
      await prisma.approvalRoleAssignment.updateMany({ where: { userId: ids.mgr1 }, data: { isActive: true } });
    }
    await prisma.user.update({ where: { id: ids.mgr1 }, data: { isActive: false } });
    try {
      const r = await askMore(b, { cement: 1 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    } finally {
      await prisma.user.update({ where: { id: ids.mgr1 }, data: { isActive: true } });
    }
    // not classified yet: nothing is assigned to anybody
    const c = await atExecutive({ cement: 100 });
    expect((await executiveApprove(c.requestId, ids.exec, PIN, c.version, { allocations: [{ itemId: item(c, "cement"), quantity: 50 }] })).ok).toBe(true);
    const unassigned = await askMore(c, { cement: 1 });
    expect(unassigned.ok).toBe(false);
    if (!unassigned.ok) expect(unassigned.status).toBe(403);
    expect(await prisma.deferredApprovalRequest.count({ where: { requestId: { in: [b.requestId, c.requestId] } } })).toBe(0);
  });

  it("LEGACY: with no procurement positions no MANAGER may ask, while buying is unchanged", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    await withLegacyMode(async () => {
      for (const who of [ids.mgr1, ids.mgr2, ids.mgr3]) {
        const r = await askMore(b, { cement: 1 }, "x", who);
        expect(r.ok, who).toBe(false);
        if (!r.ok) {
          expect(r.status).toBe(403);
          expect(r.error).toContain("тохируулагдаагүй");
        }
        expect(await summaryOf(b, who, "MANAGER")).toMatchObject({ viewerCanRequest: false });
      }
      expect(await prisma.deferredApprovalRequest.count({ where: { requestId: b.requestId } })).toBe(0);
      // the unrelated procurement workflow still behaves as it did in LEGACY mode (any MANAGER buys, capped by the approval)
      expect((await buy(b, "cement", 30, ids.mgr3)).ok).toBe(true);
      expect((await buy(b, "cement", 21, ids.mgr3)).ok).toBe(false);
    });
    // and the same officer can ask again as soon as the positions are back
    expect((await askMore(b, { cement: 1 })).ok).toBe(true);
  });

  it("the route answers 401 without a session and 403 for every unauthorised caller; the authorised officer gets 201", async () => {
    const b = await partiallyApproved({ cement: 100 }, { cement: 50 });
    const body = askBody(b, "cement", 10);
    sessionAs(null);
    expect((await ASK_ROUTE(jsonReq(body), routeCtx(b.requestId))).status).toBe(401);
    for (const [who, role] of [[ids.emp, "EMPLOYEE"], [ids.exec, "DIRECTOR"], [ids.admin, "ADMIN"], [ids.mgr3, "MANAGER"], [ids.mgr2, "MANAGER"]] as const) {
      sessionAs(who, role);
      expect((await ASK_ROUTE(jsonReq({ ...body, clientRequestId: cid() }), routeCtx(b.requestId))).status, who).toBe(403);
    }
    expect(await prisma.deferredApprovalRequest.count({ where: { requestId: b.requestId } })).toBe(0);
    sessionAs(ids.mgr1, "MANAGER");
    expect((await ASK_ROUTE(jsonReq(body), routeCtx(b.requestId))).status).toBe(201);
    // LEGACY: the same officer is refused at the route
    await prisma.deferredApprovalRequest.updateMany({ where: { requestId: b.requestId }, data: { status: "RETURNED" } });
    await withLegacyMode(async () => {
      expect((await ASK_ROUTE(jsonReq({ ...body, clientRequestId: cid() }), routeCtx(b.requestId))).status).toBe(403);
    });
  });
});

describe("12. executive handover (ADMIN-controlled reassignment)", () => {
  let parkedExecutive: string[] = [];
  beforeAll(async () => {
    const existing = await prisma.approvalRoleAssignment.findMany({ where: { role: "EXECUTIVE_DIRECTOR", isActive: true, userId: { not: { startsWith: P } } } });
    parkedExecutive = existing.map((e) => e.id);
    await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: parkedExecutive } }, data: { isActive: false } });
    await prisma.approvalRoleAssignment.deleteMany({ where: { role: "EXECUTIVE_DIRECTOR", userId: { startsWith: P } } });
    await prisma.approvalRoleAssignment.create({ data: { role: "EXECUTIVE_DIRECTOR", userId: ids.execNew, isActive: true } });
  });
  afterAll(async () => {
    await prisma.approvalRoleAssignment.deleteMany({ where: { role: "EXECUTIVE_DIRECTOR", userId: { startsWith: P } } });
    await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: parkedExecutive } }, data: { isActive: true, endedAt: null } });
  });

  const handover = (over: Partial<Parameters<typeof executeExecutiveHandover>[0]> = {}) =>
    executeExecutiveHandover({ fromUserId: ids.execOld, toUserId: ids.execNew, actorId: ids.admin, reason: "Захирал солигдсон", clientRequestId: cid(), expectedRequests: 0, ...over });
  const pending = async (from = ids.execOld) => (await previewExecutiveHandover(from, ids.execNew)).affectedRequests;
  const stepOf = (b: Built) => prisma.approvalStep.findFirstOrThrow({ where: { requestId: b.requestId, type: "EXECUTIVE_APPROVAL" } });
  const decide = async (b: Built, who: string, pin: string, key: MatKey = "cement", quantity = 10) =>
    decideAdditionalApproval(b.requestId, who, { action: "APPROVE", pin, items: [{ itemId: item(b, key), quantity }], clientRequestId: cid(), expectedRevision: (await summaryOf(b)).revision });

  it("refuses an ineligible recipient, a non-ADMIN caller and a missing reason; nothing moves", async () => {
    const b = await atExecutive({ cement: 10 }, {}, ids.execOld);
    const refused = async (over: Partial<Parameters<typeof executeExecutiveHandover>[0]>, status: number, code?: string) => {
      const r = await handover({ expectedRequests: 1, ...over });
      expect(r.ok, JSON.stringify(over)).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(status);
        if (code) expect(r.code).toBe(code);
      }
      expect((await stepOf(b)).assignedUserId).toBe(ids.execOld);
    };
    await refused({ actorId: ids.exec }, 403); // a DIRECTOR is not an administrator
    await refused({ actorId: ids.mgr1 }, 403);
    await refused({ actorId: ids.execNew }, 403);
    await refused({ reason: "ab" }, 400);
    await refused({ toUserId: ids.execOld }, 400); // from == to
    await refused({ toUserId: ids.exec2 }, 409, "NOT_POSITION_HOLDER"); // an arbitrary DIRECTOR
    await refused({ toUserId: ids.exec }, 409, "NOT_POSITION_HOLDER");
    await refused({ toUserId: ids.admin }, 400); // not a DIRECTOR
    await refused({ fromUserId: "no-such-user" }, 404);

    await prisma.user.update({ where: { id: ids.execNew }, data: { isActive: false } });
    try {
      await refused({}, 400);
    } finally {
      await prisma.user.update({ where: { id: ids.execNew }, data: { isActive: true } });
    }
    await prisma.user.update({ where: { id: ids.execNew }, data: { role: "MANAGER" } });
    try {
      await refused({}, 400);
    } finally {
      await prisma.user.update({ where: { id: ids.execNew }, data: { role: "DIRECTOR" } });
    }
    const credential = await prisma.approvalPinCredential.findUniqueOrThrow({ where: { userId: ids.execNew } });
    await prisma.approvalPinCredential.delete({ where: { userId: ids.execNew } });
    try {
      await refused({}, 409, "NO_PIN"); // could not act on it without a PIN
    } finally {
      await prisma.approvalPinCredential.create({ data: { userId: ids.execNew, pinHash: credential.pinHash } });
    }
    expect(await prisma.executiveApprovalReassignment.count({ where: { requestId: b.requestId } })).toBe(0);
    // with everything valid it does move (and leaves no leftover for the next test)
    expect((await handover({ expectedRequests: await pending() })).ok).toBe(true);
    expect((await stepOf(b)).assignedUserId).toBe(ids.execNew);
  });

  it("moves initial and deferred work only, records who/what/why, and leaves every earlier decision untouched", async () => {
    const initial = await atExecutive({ cement: 20 }, {}, ids.execOld);
    const deferred = await partiallyApproved({ cement: 100 }, { cement: 50 }, {}, "Эхний шийдвэр", ids.execOld);
    const foreign = await partiallyApproved({ cement: 10 }, { cement: 5 }); // another executive's request: must not move
    const preview = await previewExecutiveHandover(ids.execOld, ids.execNew);
    expect(preview).toMatchObject({ affectedRequests: 2, initialPending: 1, deferredOpen: 1, newExecutiveProblem: null });

    const decisionBefore = await prisma.executiveApprovalDecision.findFirstOrThrow({ where: { requestId: deferred.requestId }, include: { allocations: true } });
    const stepBefore = await stepOf(deferred);
    const key = cid();
    const r = await handover({ clientRequestId: key, expectedRequests: 2, reason: "Захирал өөрчлөгдсөн" });
    expect(r.ok && r.summary).toMatchObject({ initialPending: 1, deferredOpen: 1 });

    expect((await stepOf(initial)).assignedUserId).toBe(ids.execNew);
    expect((await stepOf(deferred)).assignedUserId).toBe(ids.execNew);
    expect((await stepOf(foreign)).assignedUserId).toBe(ids.exec);

    const rows = await prisma.executiveApprovalReassignment.findMany({ where: { handoverKey: key }, orderBy: { requestId: "asc" } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ fromUserId: ids.execOld, toUserId: ids.execNew, reassignedById: ids.admin, reason: "Захирал өөрчлөгдсөн" });
      expect(row.createdAt).toBeInstanceOf(Date);
    }
    const byRequest = new Map(rows.map((x) => [x.requestId, x]));
    expect(byRequest.get(initial.requestId)).toMatchObject({ stepStatusBefore: "PENDING", requestStatusBefore: "PENDING_EXECUTIVE_APPROVAL" });
    expect(byRequest.get(deferred.requestId)).toMatchObject({ stepStatusBefore: "APPROVED", requestStatusBefore: "PENDING_PROCUREMENT" });
    expect(await prisma.auditLog.count({ where: { entityType: "ExecutiveApprovalReassignment", actorId: ids.admin, entityId: { in: rows.map((x) => x.id) } } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: ids.execNew, type: "APPROVAL_REQUIRED", body: { contains: "Захирал өөрчлөгдсөн" } } })).toBeGreaterThan(0);

    // history: the earlier decision, its allocations and who decided the step are exactly as before
    const decisionAfter = await prisma.executiveApprovalDecision.findFirstOrThrow({ where: { requestId: deferred.requestId }, include: { allocations: true } });
    expect(decisionAfter).toEqual(decisionBefore);
    expect(decisionAfter.decidedById).toBe(ids.execOld);
    expect((await stepOf(deferred)).decidedById).toBe(stepBefore.decidedById);
    expect((await stepOf(deferred)).decidedAt).toEqual(stepBefore.decidedAt);
  });

  it("afterwards only the new executive can act, with their own PIN; the old executive and an ADMIN cannot", async () => {
    const initial = await atExecutive({ cement: 20 }, {}, ids.execOld);
    const deferred = await partiallyApproved({ cement: 100 }, { cement: 50 }, {}, "x", ids.execOld);
    expect((await handover({ expectedRequests: await pending() })).ok).toBe(true);

    // the replaced executive is refused everywhere
    const oldInitial = await executiveApprove(initial.requestId, ids.execOld, PIN, initial.version);
    expect(oldInitial.ok).toBe(false);
    if (!oldInitial.ok) expect(oldInitial.status).toBe(403);
    expect((await approveMore(deferred, { cement: 10 }, { who: ids.execOld })).ok).toBe(false);
    // an ADMIN gains no approval authority, in the service or at the route
    const adminDecide = await approveMore(deferred, { cement: 10 }, { who: ids.admin });
    expect(adminDecide.ok).toBe(false);
    if (!adminDecide.ok) expect(adminDecide.status).toBe(403);
    expect((await executiveApprove(initial.requestId, ids.admin, PIN, initial.version)).ok).toBe(false);
    sessionAs(ids.admin, "ADMIN");
    const adminRoute = await DECIDE_ROUTE(jsonReq({ action: "APPROVE", pin: PIN, items: [{ itemId: item(deferred, "cement"), quantity: 10 }], clientRequestId: cid(), expectedRevision: 1 }), routeCtx(deferred.requestId));
    expect(adminRoute.status).toBe(403);
    expect((await prisma.executiveApprovalDecision.count({ where: { requestId: deferred.requestId } }))).toBe(1);

    // the new executive must use their OWN PIN (the old executive's PIN does not work for them)
    const wrongPin = await executiveApprove(initial.requestId, ids.execNew, PIN, initial.version);
    expect(wrongPin.ok).toBe(false);
    if (!wrongPin.ok) expect(wrongPin.status).toBe(401);
    expect((await approveMore(deferred, { cement: 10 }, { who: ids.execNew, pin: PIN })).ok).toBe(false);
    expect((await executiveApprove(initial.requestId, ids.execNew, PIN_NEW, initial.version)).ok).toBe(true);
    expect((await approveMore(deferred, { cement: 10 }, { who: ids.execNew, pin: PIN_NEW })).ok).toBe(true);

    expect((await stepOf(initial)).decidedById).toBe(ids.execNew);
    const s = await summaryOf(deferred, ids.execNew);
    expect(s.decisions.map((d) => [d.sequence, d.decidedByName])).toEqual([[1, ids.execOld], [2, ids.execNew]]);
    expect(s.items[0].authorizedQuantity).toBe(60);
    expect(await summaryOf(deferred, ids.execNew, "DIRECTOR")).toMatchObject({ viewerCanDecide: true });
    expect(await summaryOf(deferred, ids.execOld, "DIRECTOR")).toMatchObject({ viewerCanDecide: false });
    // the new executive also sees and resolves the officer's request
    expect((await askMore(deferred, { cement: 5 })).ok).toBe(true);
    expect(await prisma.notification.count({ where: { userId: ids.execNew, relatedRequestId: deferred.requestId, type: "APPROVAL_REQUIRED" } })).toBeGreaterThan(0);
  });

  it("a deactivated executive cannot decide (initial or additional); the handover makes the work actionable again", async () => {
    const initial = await atExecutive({ cement: 20 }, {}, ids.execOld);
    const deferred = await partiallyApproved({ cement: 100 }, { cement: 50 }, {}, "x", ids.execOld);
    await prisma.user.update({ where: { id: ids.execOld }, data: { isActive: false } });
    try {
      const a = await executiveApprove(initial.requestId, ids.execOld, PIN, initial.version);
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.status).toBe(403);
      expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: initial.requestId } })).status).toBe("PENDING_EXECUTIVE_APPROVAL");
      expect((await approveMore(deferred, { cement: 10 }, { who: ids.execOld })).ok).toBe(false);
      // a deactivated executive is exactly the case an ADMIN hands over
      expect((await handover({ expectedRequests: await pending() })).ok).toBe(true);
    } finally {
      await prisma.user.update({ where: { id: ids.execOld }, data: { isActive: true } });
    }
    expect((await executiveApprove(initial.requestId, ids.execNew, PIN_NEW, initial.version, { allocations: [{ itemId: item(initial, "cement"), quantity: 7 }] })).ok).toBe(true);
    expect((await approveMore(deferred, { cement: 10 }, { who: ids.execNew, pin: PIN_NEW })).ok).toBe(true);
  });

  it("is idempotent and refuses a stale review", async () => {
    const b = await atExecutive({ cement: 10 }, {}, ids.execOld);
    const key = cid();
    expect((await handover({ clientRequestId: key, expectedRequests: 5 })).ok).toBe(false); // reviewed 5, now 1
    expect((await stepOf(b)).assignedUserId).toBe(ids.execOld);
    const first = await handover({ clientRequestId: key, expectedRequests: 1 });
    expect(first.ok && !first.duplicate).toBe(true);
    const retry = await handover({ clientRequestId: key, expectedRequests: 1 });
    expect(retry.ok && retry.duplicate).toBe(true);
    expect(await prisma.executiveApprovalReassignment.count({ where: { handoverKey: key } })).toBe(1);
    // the same key for a different move is refused, and with nothing left there is nothing to transfer
    expect((await handover({ clientRequestId: key, fromUserId: ids.exec, expectedRequests: 0 })).ok).toBe(false);
    const empty = await handover({ expectedRequests: 0 });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe("NOTHING_TO_TRANSFER");
  });

  it("races: the replaced executive can never decide after the move (initial approval vs handover)", async () => {
    let approvedFirst = 0;
    let movedFirst = 0;
    for (let i = 0; i < 10; i++) {
      const b = await atExecutive({ cement: 10 }, {}, ids.execOld);
      const key = cid();
      const [approval, result] = await Promise.all([executiveApprove(b.requestId, ids.execOld, PIN, b.version), handover({ clientRequestId: key, expectedRequests: 1 })]);
      expect(result.ok, `handover #${i}`).toBe(true);
      const row = await prisma.executiveApprovalReassignment.findFirstOrThrow({ where: { handoverKey: key } });
      const step = await stepOf(b);
      expect(step.assignedUserId).toBe(ids.execNew);
      if (approval.ok) {
        // the approval landed first; the work then moved on already approved
        approvedFirst++;
        expect(row.stepStatusBefore).toBe("APPROVED");
        expect(step.status).toBe("APPROVED");
        expect(step.decidedById).toBe(ids.execOld);
      } else {
        // the handover landed first; the replaced executive was refused and nothing was decided
        movedFirst++;
        expect(row.stepStatusBefore).toBe("PENDING");
        expect(step.status).toBe("PENDING");
        expect(step.decidedById).toBeNull();
        expect(await prisma.executiveApprovalDecision.count({ where: { requestId: b.requestId } })).toBe(0);
      }
    }
    expect(approvedFirst + movedFirst).toBe(10);
  });

  it("races: an additional decision vs the handover is serialised and the loser is refused", async () => {
    for (let i = 0; i < 6; i++) {
      const b = await partiallyApproved({ cement: 100 }, { cement: 50 }, {}, "x", ids.execOld);
      const [decision, result] = await Promise.all([
        decideAdditionalApproval(b.requestId, ids.execOld, { action: "APPROVE", pin: PIN, items: [{ itemId: item(b, "cement"), quantity: 10 }], clientRequestId: cid(), expectedRevision: 1 }),
        handover({ expectedRequests: 1 }),
      ]);
      expect(result.ok, `handover #${i}`).toBe(true);
      const decisions = await prisma.executiveApprovalDecision.findMany({ where: { requestId: b.requestId }, orderBy: { sequence: "asc" } });
      expect(decisions.map((d) => d.decidedById)).toEqual(decision.ok ? [ids.execOld, ids.execOld] : [ids.execOld]);
      expect((await stepOf(b)).assignedUserId).toBe(ids.execNew);
      // whatever happened, the old executive is out now
      expect((await decide(b, ids.execOld, PIN)).ok).toBe(false);
    }
  });

  it("the position route validates the executive server-side; the handover endpoints are ADMIN-only", async () => {
    for (const [userId, label] of [[ids.mgr1, "a MANAGER"], [ids.admin, "an ADMIN"]] as const) {
      sessionAs(ids.admin, "ADMIN");
      const res = await ROLES_ROUTE(jsonReq({ role: "EXECUTIVE_DIRECTOR", userId }));
      expect(res.status, label).toBe(400);
    }
    await prisma.user.update({ where: { id: ids.exec2 }, data: { isActive: false } });
    try {
      sessionAs(ids.admin, "ADMIN");
      expect((await ROLES_ROUTE(jsonReq({ role: "EXECUTIVE_DIRECTOR", userId: ids.exec2 }))).status).toBe(400);
    } finally {
      await prisma.user.update({ where: { id: ids.exec2 }, data: { isActive: true } });
    }
    expect((await prisma.approvalRoleAssignment.findFirstOrThrow({ where: { role: "EXECUTIVE_DIRECTOR", isActive: true } })).userId).toBe(ids.execNew);

    const body = { fromUserId: ids.execOld, toUserId: ids.execNew, reason: "Захирал солигдсон", clientRequestId: cid(), expectedRequests: 0 };
    for (const [who, role] of [[ids.exec, "DIRECTOR"], [ids.execNew, "DIRECTOR"], [ids.mgr1, "MANAGER"], [ids.emp, "EMPLOYEE"]] as const) {
      sessionAs(who, role);
      expect((await HANDOVER_ROUTE(jsonReq(body))).status, who).toBe(403);
      expect((await HANDOVER_PREVIEW_ROUTE(new Request(`http://localhost/x?fromUserId=${ids.execOld}`))).status, who).toBe(403);
    }
    sessionAs(null);
    expect((await HANDOVER_ROUTE(jsonReq(body))).status).toBe(403);
    // an ADMIN gets the preview and, with nothing pending, a clear 409
    sessionAs(ids.admin, "ADMIN");
    expect((await HANDOVER_PREVIEW_ROUTE(new Request(`http://localhost/x?fromUserId=${ids.execOld}&toUserId=${ids.execNew}`))).status).toBe(200);
    expect((await HANDOVER_ROUTE(jsonReq(body))).status).toBe(409);
    expect((await HANDOVER_ROUTE(jsonReq({ ...body, reason: "x" }))).status).toBe(400);
  });

  it("reassignment rows are immutable in the database", async () => {
    const b = await atExecutive({ cement: 10 }, {}, ids.execOld);
    const key = cid();
    expect((await handover({ clientRequestId: key, expectedRequests: 1 })).ok).toBe(true);
    const row = await prisma.executiveApprovalReassignment.findFirstOrThrow({ where: { handoverKey: key } });
    await expect(prisma.executiveApprovalReassignment.update({ where: { id: row.id }, data: { reason: "changed" } })).rejects.toThrow();
    await expect(prisma.executiveApprovalReassignment.delete({ where: { id: row.id } })).rejects.toThrow();
    expect((await prisma.executiveApprovalReassignment.findUniqueOrThrow({ where: { id: row.id } })).reason).toBe("Захирал солигдсон");
    expect(row.requestId).toBe(b.requestId);
  });
});
