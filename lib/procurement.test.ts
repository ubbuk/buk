import type { ApprovalStepType } from "@prisma/client";
import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import {
  branchApprove,
  departmentApprove,
  executiveApprove,
  financeApprove,
  managerUpdateItemPrice,
  recordAccountingEntry,
  warehouseCheck,
} from "./workflow";
import {
  completeProcurement,
  getProcurementDetail,
  listProcurement,
  parseSearchNumber,
  procurementCounts,
  recordPurchase,
  voidPurchase,
} from "./procurement";

// Manager procurement (Stage 7) against the isolated test database, driven
// through the real workflow: a request is taken from the department head, past
// the warehouse, branch, finance and CEO, and only then handed to the Manager.
// Nothing is mocked and nothing is cleaned up (same convention as
// workflow.test.ts); every request/material carries a per-run tag, and the
// searches are scoped by it, so earlier runs can't change an assertion.
const PIN = "1234";
const TAG = Date.now().toString(36);
const P = "pr-";
const ids = {
  // departments are per run: a department-name search must not see earlier runs' requests
  beton: `${P}beton-${TAG}`,
  mech: `${P}mech-${TAG}`,
  empA: `${P}emp-a`,
  empB: `${P}emp-b`,
  betonHead: `${P}beton-head`,
  mechHead: `${P}mech-head`,
  store: `${P}store`,
  branch: `${P}branch`,
  fin: `${P}fin`,
  exec: `${P}exec`,
  acct: `${P}acct`,
  mgr1: `${P}manager-1`,
  mgr2: `${P}manager-2`,
  warehouse: `${P}wh`,
};

const MATERIALS = {
  cement: { id: `${P}mat-cement`, name: `PRX${TAG} Cement` },
  bearing: { id: `${P}mat-bearing`, name: `PRX${TAG} Bearing` },
  nozzle: { id: `${P}mat-nozzle`, name: `PRX${TAG} Laser nozzle` },
  washer: { id: `${P}mat-washer`, name: `PRX${TAG} Washer` },
  bolt: { id: `${P}mat-bolt`, name: `PRX${TAG} Bolt` },
};
type MatKey = keyof typeof MATERIALS;

let counter = 0;

// Removes everything this file creates (this and earlier runs): the shared test
// database is scanned whole by other suites, so leftovers would only slow them down.
async function cleanup() {
  const mine = { requestNumber: { startsWith: "PRX-" } };
  const ofRequest = { request: mine };
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

afterAll(cleanup);

beforeAll(async () => {
  await cleanup();
  await prisma.department.upsert({ where: { id: ids.beton }, update: { name: `PRX${TAG} Beton` }, create: { id: ids.beton, name: `PRX${TAG} Beton`, type: "FACTORY" } });
  await prisma.department.upsert({ where: { id: ids.mech }, update: { name: `PRX${TAG} Mechanic` }, create: { id: ids.mech, name: `PRX${TAG} Mechanic`, type: "FACTORY" } });
  const users: [string, "EMPLOYEE" | "BOSS" | "STOREKEEPER" | "ENGINEERING" | "DIRECTOR" | "CHIEF_ACCOUNTANT" | "MANAGER", string | null][] = [
    [ids.empA, "EMPLOYEE", ids.beton],
    [ids.empB, "EMPLOYEE", ids.beton],
    [ids.betonHead, "BOSS", ids.beton],
    [ids.mechHead, "BOSS", ids.mech],
    [ids.store, "STOREKEEPER", null],
    [ids.branch, "ENGINEERING", null],
    [ids.fin, "DIRECTOR", null],
    [ids.exec, "DIRECTOR", null],
    [ids.acct, "CHIEF_ACCOUNTANT", null],
    [ids.mgr1, "MANAGER", null],
    [ids.mgr2, "MANAGER", null],
  ];
  const pinHash = await bcrypt.hash(PIN, 10);
  for (const [id, role, departmentId] of users) {
    await prisma.user.upsert({
      where: { id },
      update: { role, isActive: true, departmentId },
      create: { id, email: `${id}@test.local`, name: id, role, departmentId, passwordHash: "unused" },
    });
  }
  for (const userId of [ids.betonHead, ids.mechHead, ids.store, ids.branch, ids.fin, ids.exec]) {
    await prisma.approvalPinCredential.upsert({ where: { userId }, update: { pinHash, failedAttempts: 0, lockedUntil: null }, create: { userId, pinHash } });
  }
  await prisma.department.update({ where: { id: ids.beton }, data: { headId: ids.betonHead } });
  await prisma.department.update({ where: { id: ids.mech }, data: { headId: ids.mechHead } });
  await prisma.warehouse.upsert({ where: { id: ids.warehouse }, update: {}, create: { id: ids.warehouse, name: "PR wh" } });
  for (const [i, m] of Object.values(MATERIALS).entries()) {
    await prisma.material.upsert({
      where: { id: m.id },
      update: { name: m.name },
      create: { id: m.id, code: `PRX-${TAG}-${i}`, name: m.name, unit: "ш", defaultPrice: 1000 },
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

type Wanted = Partial<Record<MatKey, number>>;
interface Built {
  requestId: string;
  itemIds: Record<MatKey, string>;
  requestNumber: string;
}

/** `legacy`: a request created before Stage 7 existed (six steps, none for the Manager). */
async function createRequest(wanted: Wanted, opts: { dept?: "beton" | "mech"; by?: string; legacy?: boolean } = {}) {
  const dept = opts.dept ?? "beton";
  counter += 1;
  const requestNumber = `PRX-${TAG}-${counter}`;
  const head = dept === "beton" ? ids.betonHead : ids.mechHead;
  const keys = Object.keys(wanted) as MatKey[];
  const types: ApprovalStepType[] = ["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL", ...(opts.legacy ? [] : (["MANAGER_PROCUREMENT"] as const)), "ACCOUNTING_RECORD"];
  const assignee: Record<string, string | null> = {
    DEPARTMENT_HEAD: head, WAREHOUSE_CHECK: ids.store, BRANCH_APPROVAL: ids.branch, FINANCE_APPROVAL: ids.fin,
    EXECUTIVE_APPROVAL: ids.exec, MANAGER_PROCUREMENT: null, ACCOUNTING_RECORD: ids.acct,
  };
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber,
      year: 9999,
      sequence: counter,
      departmentId: dept === "beton" ? ids.beton : ids.mech,
      requestedById: opts.by ?? ids.empA,
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
  const itemIds = {} as Record<MatKey, string>;
  for (const item of created.items) itemIds[(Object.keys(MATERIALS) as MatKey[]).find((k) => MATERIALS[k].id === item.materialId)!] = item.id;
  return { requestId: created.id, itemIds, requestNumber } satisfies Built;
}

/** Department head -> warehouse -> branch -> finance. Returns the version the CEO must approve with. */
async function toCeo(built: Built, dept: "beton" | "mech" = "beton") {
  const head = dept === "beton" ? ids.betonHead : ids.mechHead;
  const items = await prisma.materialRequestItem.findMany({ where: { requestId: built.requestId } });
  const a = await departmentApprove(built.requestId, head, PIN, 1);
  if (!a.ok) throw new Error(`department: ${a.error}`);
  const stock = new Map((await prisma.inventoryBalance.findMany({ where: { warehouseId: ids.warehouse } })).map((b) => [b.materialId, Number(b.quantityOnHand)]));
  const w = await warehouseCheck(built.requestId, ids.store, items.map((i) => ({ requestItemId: i.id, availableQuantity: stock.get(i.materialId!) ?? 0 })), PIN, a.request.version);
  if (!w.ok) throw new Error(`warehouse: ${w.error}`);
  const b = await branchApprove(built.requestId, ids.branch, PIN, w.request.version);
  if (!b.ok) throw new Error(`branch: ${b.error}`);
  const f = await financeApprove(built.requestId, ids.fin, PIN, b.request.version);
  if (!f.ok) throw new Error(`finance: ${f.error}`);
  return f.request.version;
}

/** The standard scenario: cement 20, bearing 12, nozzle 4 (all bought), washer 6 (stock covers it) and bolt 10 (4 in stock, 6 to buy). */
async function inProcurement(opts: { dept?: "beton" | "mech"; by?: string; legacy?: boolean } = {}) {
  await setStock({ washer: 10, bolt: 4 });
  const built = await createRequest({ cement: 20, bearing: 12, nozzle: 4, washer: 6, bolt: 10 }, opts);
  const version = await toCeo(built, opts.dept);
  const ceo = await executiveApprove(built.requestId, ids.exec, PIN, version);
  if (!ceo.ok) throw new Error(`executive: ${ceo.error}`);
  return { ...built, ceoVersion: ceo.request.version };
}

const buy = (b: Built, who: string, item: MatKey, quantity: number, unitPrice = 1250.5, clientRequestId?: string) =>
  recordPurchase(b.requestId, who, { itemId: b.itemIds[item], quantity, unitPrice, clientRequestId });

const itemOf = async (b: Built, key: MatKey) => (await getProcurementDetail(b.requestId))!.items.find((i) => i.itemId === b.itemIds[key])!;
const statusOf = async (b: Built) => (await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } })).status;

async function buyEverything(b: Built, who = ids.mgr1) {
  for (const [key, qty] of [["cement", 20], ["bearing", 12], ["nozzle", 4], ["bolt", 6]] as const) {
    const r = await buy(b, who, key, qty);
    if (!r.ok) throw new Error(r.error);
  }
}

describe("1. CEO approval hands over to the Manager", () => {
  it("moves to PENDING_PROCUREMENT (not accounting), opens the Manager step and notifies every manager", async () => {
    const b = await inProcurement();
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
    const steps = await prisma.approvalStep.findMany({ where: { requestId: b.requestId }, orderBy: { sequence: "asc" } });
    expect(steps.map((s) => `${s.type}:${s.status}`)).toEqual([
      "DEPARTMENT_HEAD:APPROVED", "WAREHOUSE_CHECK:APPROVED", "BRANCH_APPROVAL:APPROVED", "FINANCE_APPROVAL:APPROVED",
      "EXECUTIVE_APPROVAL:APPROVED", "MANAGER_PROCUREMENT:PENDING", "ACCOUNTING_RECORD:PENDING",
    ]);
    for (const manager of [ids.mgr1, ids.mgr2]) {
      expect(await prisma.notification.count({ where: { userId: manager, relatedRequestId: b.requestId, type: "PROCUREMENT_REQUIRED" } })).toBe(1);
    }
    // the accountant is not told yet
    expect(await prisma.notification.count({ where: { userId: ids.acct, relatedRequestId: b.requestId } })).toBe(0);
  });

  it("also covers a request created before the stage existed: the Manager step is added at CEO approval", async () => {
    const b = await inProcurement({ legacy: true });
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
    const steps = await prisma.approvalStep.findMany({ where: { requestId: b.requestId }, orderBy: { sequence: "asc" } });
    expect(steps.filter((s) => s.type === "MANAGER_PROCUREMENT")).toHaveLength(1);
    expect(steps.find((s) => s.type === "MANAGER_PROCUREMENT")?.status).toBe("PENDING");
    expect(steps.find((s) => s.type === "ACCOUNTING_RECORD")?.status).toBe("PENDING");
  });
});

describe("2. the Manager sees requests waiting for purchase", () => {
  it("lists it under 'awaiting' with its outstanding items, not under 'in progress'", async () => {
    const b = await inProcurement();
    const awaiting = await listProcurement({ tab: "awaiting", q: b.requestNumber, page: 1, pageSize: 10 });
    expect(awaiting.rows.map((r) => r.requestNumber)).toEqual([b.requestNumber]);
    expect(awaiting.rows[0]).toMatchObject({ department: `PRX${TAG} Beton`, requiredItemCount: 4, completedItemCount: 0 });
    expect(awaiting.rows[0].approvedAt).not.toBeNull();
    expect((await listProcurement({ tab: "in_progress", q: b.requestNumber, page: 1, pageSize: 10 })).total).toBe(0);
    expect((await procurementCounts()).awaiting).toBeGreaterThan(0);
  });
});

describe("3. warehouse-issued quantities are not purchased again", () => {
  it("requires only the shortfall and gives fully-stocked items no checkbox", async () => {
    const b = await inProcurement();
    const detail = (await getProcurementDetail(b.requestId))!;
    const washer = detail.items.find((i) => i.itemId === b.itemIds.washer)!;
    const bolt = detail.items.find((i) => i.itemId === b.itemIds.bolt)!;
    expect(washer).toMatchObject({ requestedQuantity: 6, issuedQuantity: 6, requiredQuantity: 0, checked: false });
    expect(bolt).toMatchObject({ requestedQuantity: 10, issuedQuantity: 4, requiredQuantity: 6, remainingQuantity: 6, status: "NOT_STARTED" });
    expect(detail.requiredItemCount).toBe(4); // cement, bearing, nozzle, bolt

    const row = (await listProcurement({ tab: "awaiting", q: b.requestNumber, page: 1, pageSize: 10 })).rows[0];
    expect(row.items.map((i) => i.materialName)).not.toContain(MATERIALS.washer.name);

    const attempt = await buy(b, ids.mgr1, "washer", 1);
    expect(attempt).toMatchObject({ ok: false, status: 409 });
    // buying the shortfall of a partly-issued item is capped at the shortfall, not the requested quantity
    expect(await buy(b, ids.mgr1, "bolt", 7)).toMatchObject({ ok: false, status: 409 });
    expect((await buy(b, ids.mgr1, "bolt", 6)).ok).toBe(true);
  });
});

describe("4-5. partial purchases and the item checkbox", () => {
  it("a partial purchase leaves the item unchecked and the request in procurement; the rest checks it", async () => {
    const b = await inProcurement();
    expect((await buy(b, ids.mgr1, "cement", 20)).ok).toBe(true);
    expect((await buy(b, ids.mgr1, "nozzle", 4)).ok).toBe(true);
    expect((await buy(b, ids.mgr1, "bearing", 5)).ok).toBe(true);

    expect(await itemOf(b, "cement")).toMatchObject({ purchasedQuantity: 20, remainingQuantity: 0, status: "COMPLETE", checked: true });
    expect(await itemOf(b, "nozzle")).toMatchObject({ checked: true });
    expect(await itemOf(b, "bearing")).toMatchObject({ purchasedQuantity: 5, requiredQuantity: 12, remainingQuantity: 7, status: "PARTIAL", checked: false });
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
    expect((await listProcurement({ tab: "in_progress", q: b.requestNumber, page: 1, pageSize: 10 })).total).toBe(1);
    expect((await listProcurement({ tab: "awaiting", q: b.requestNumber, page: 1, pageSize: 10 })).total).toBe(0);

    expect((await buy(b, ids.mgr2, "bearing", 7)).ok).toBe(true);
    expect(await itemOf(b, "bearing")).toMatchObject({ purchasedQuantity: 12, remainingQuantity: 0, status: "COMPLETE", checked: true });
  });

  it("rejects buying more than is outstanding, zero/negative/over-precise numbers", async () => {
    const b = await inProcurement();
    expect(await buy(b, ids.mgr1, "bearing", 13)).toMatchObject({ ok: false, status: 409 });
    expect(await buy(b, ids.mgr1, "bearing", 0)).toMatchObject({ ok: false, status: 400 });
    expect(await buy(b, ids.mgr1, "bearing", -1)).toMatchObject({ ok: false, status: 400 });
    expect(await buy(b, ids.mgr1, "bearing", 1.0005)).toMatchObject({ ok: false, status: 400 });
    expect(await buy(b, ids.mgr1, "bearing", 1, 0)).toMatchObject({ ok: false, status: 400 });
    expect(await buy(b, ids.mgr1, "bearing", 1, 10.005)).toMatchObject({ ok: false, status: 400 });
    expect((await itemOf(b, "bearing")).purchasedQuantity).toBe(0);
  });
});

describe("6-7. completion and the hand-over to accounting", () => {
  it("an incomplete request cannot be completed or registered", async () => {
    const b = await inProcurement();
    await buy(b, ids.mgr1, "cement", 20);
    await buy(b, ids.mgr1, "bearing", 5);

    const done = await completeProcurement(b.requestId, ids.mgr1);
    expect(done).toMatchObject({ ok: false, status: 409 });
    if (!done.ok) expect(done.error).toContain(MATERIALS.bearing.name);
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
    expect((await getProcurementDetail(b.requestId))!.canComplete).toBe(false);

    const early = await recordAccountingEntry(b.requestId, ids.acct, { ledgerNumber: "EARLY", recordDate: new Date() }, b.ceoVersion);
    expect(early.ok).toBe(false);
    expect(await prisma.accountingRecord.count({ where: { requestId: b.requestId } })).toBe(0);
  });

  it("completes atomically once every item is bought, notifies the accountant and writes the audit trail", async () => {
    const b = await inProcurement();
    await buyEverything(b);
    expect((await getProcurementDetail(b.requestId))!.canComplete).toBe(true);

    const done = await completeProcurement(b.requestId, ids.mgr2);
    expect(done.ok).toBe(true);
    expect(await statusOf(b)).toBe("PENDING_ACCOUNTING");
    const step = await prisma.approvalStep.findFirstOrThrow({ where: { requestId: b.requestId, type: "MANAGER_PROCUREMENT" } });
    expect(step).toMatchObject({ status: "APPROVED", decidedById: ids.mgr2 });
    expect(await prisma.notification.count({ where: { userId: ids.acct, relatedRequestId: b.requestId, type: "APPROVAL_REQUIRED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "MaterialRequest", entityId: b.requestId, action: "PROCUREMENT_COMPLETE" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "ProcurementPurchase", action: "PROCUREMENT_PURCHASE", actorId: ids.mgr1 } })).toBeGreaterThan(0);

    // no PIN anywhere on the way to registration, and the accountant can now register
    const version = (await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } })).version;
    const recorded = await recordAccountingEntry(b.requestId, ids.acct, { ledgerNumber: `L-${TAG}`, recordDate: new Date() }, version);
    expect(recorded.ok).toBe(true);
    expect(await statusOf(b)).toBe("ACCOUNTING_COMPLETED");
  });

  it("cannot be completed twice, and cannot take purchases afterwards", async () => {
    const b = await inProcurement();
    await buyEverything(b);
    const results = await Promise.all([completeProcurement(b.requestId, ids.mgr1), completeProcurement(b.requestId, ids.mgr2)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: ids.acct, relatedRequestId: b.requestId } })).toBe(1);
    expect(await completeProcurement(b.requestId, ids.mgr1)).toMatchObject({ ok: false, status: 409 });
    expect(await buy(b, ids.mgr1, "cement", 1)).toMatchObject({ ok: false, status: 409 });
  });

  it("a request that needs no purchase at all still has to be completed by the Manager", async () => {
    await setStock({ washer: 10 });
    const b = await createRequest({ washer: 6 });
    // all stock -> the warehouse completes it outright; Stage 7 never applies
    const a = await departmentApprove(b.requestId, ids.betonHead, PIN, 1);
    if (!a.ok) throw new Error(a.error);
    const w = await warehouseCheck(b.requestId, ids.store, [{ requestItemId: (await prisma.materialRequestItem.findFirstOrThrow({ where: { requestId: b.requestId } })).id, availableQuantity: 10 }], PIN, a.request.version);
    expect(w.ok && w.request.status).toBe("COMPLETED");
    const steps = await prisma.approvalStep.findMany({ where: { requestId: b.requestId, type: "MANAGER_PROCUREMENT" } });
    expect(steps.map((s) => s.status)).toEqual(["SKIPPED"]);
    expect((await listProcurement({ tab: "all", q: b.requestNumber, page: 1, pageSize: 10 })).total).toBe(1); // visible, but not in any open tab
    expect((await listProcurement({ tab: "awaiting", q: b.requestNumber, page: 1, pageSize: 10 })).total).toBe(0);
  });
});

describe("8-9. duplicates and concurrency never double count", () => {
  it("a retried submission with the same key is acknowledged once and counted once", async () => {
    const b = await inProcurement();
    const key = `retry-${TAG}-1`;
    const first = await buy(b, ids.mgr1, "bearing", 5, 1250.5, key);
    const second = await buy(b, ids.mgr1, "bearing", 5, 1250.5, key);
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    expect((await itemOf(b, "bearing")).purchasedQuantity).toBe(5);
    expect(await prisma.procurementPurchase.count({ where: { requestItemId: b.itemIds.bearing } })).toBe(1);
  });

  it("concurrent purchases by two managers add up exactly to the shortfall and never past it", async () => {
    const b = await inProcurement();
    // 12 bearings needed, ten simultaneous attempts of 3 from two managers: exactly four can fit.
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => buy(b, i % 2 ? ids.mgr1 : ids.mgr2, "bearing", 3, 1250.5, `c-${TAG}-${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.status === 409)).toBe(true);
    expect(await itemOf(b, "bearing")).toMatchObject({ purchasedQuantity: 12, remainingQuantity: 0, checked: true });
  });

  it("concurrent identical retries (same key) are counted once", async () => {
    const b = await inProcurement();
    const results = await Promise.all(Array.from({ length: 6 }, () => buy(b, ids.mgr1, "nozzle", 2, 99, `same-${TAG}`)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await itemOf(b, "nozzle")).purchasedQuantity).toBe(2);
  });
});

describe("corrections keep the history", () => {
  it("voiding un-checks the item; the row survives with who, when and why", async () => {
    const b = await inProcurement();
    const bought = await buy(b, ids.mgr1, "nozzle", 4);
    if (!bought.ok) throw new Error(bought.error);
    const purchase = bought.detail.items.find((i) => i.itemId === b.itemIds.nozzle)!.purchases[0];

    const voided = await voidPurchase(b.requestId, ids.mgr2, purchase.id, "wrong supplier");
    expect(voided.ok).toBe(true);
    expect(await itemOf(b, "nozzle")).toMatchObject({ purchasedQuantity: 0, checked: false, status: "NOT_STARTED" });
    const row = await prisma.procurementPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(row).toMatchObject({ voidedById: ids.mgr2, voidReason: "wrong supplier" });
    expect(row.voidedAt).not.toBeNull();
    expect((await itemOf(b, "nozzle")).purchases).toHaveLength(1); // still listed, flagged voided
    expect(await voidPurchase(b.requestId, ids.mgr1, purchase.id, "again")).toMatchObject({ ok: false, status: 409 });
    expect(await voidPurchase(b.requestId, ids.mgr1, purchase.id, "  ")).toMatchObject({ ok: false, status: 400 });
    expect(await prisma.auditLog.count({ where: { entityType: "ProcurementPurchase", entityId: purchase.id, action: "PROCUREMENT_VOID" } })).toBe(1);
  });

  it("editing the actual unit price voids the old row and records a replacement that points back", async () => {
    const b = await inProcurement();
    const bought = await buy(b, ids.mgr1, "cement", 20, 100);
    if (!bought.ok) throw new Error(bought.error);
    const original = bought.detail.items.find((i) => i.itemId === b.itemIds.cement)!.purchases[0];

    const fixed = await voidPurchase(b.requestId, ids.mgr1, original.id, "invoice price", { unitPrice: 110.25 });
    expect(fixed.ok).toBe(true);
    const cement = await itemOf(b, "cement");
    expect(cement).toMatchObject({ purchasedQuantity: 20, checked: true, actualUnitPrice: 110.25, actualTotal: 2205 });
    expect(cement.purchases.map((p) => [p.voided, p.unitPrice, p.replacesId === original.id])).toEqual([[true, 100, false], [false, 110.25, true]]);
    // a correction can't push the item past what is required either
    const replacement = cement.purchases[1];
    expect(await voidPurchase(b.requestId, ids.mgr1, replacement.id, "too many", { quantity: 21 })).toMatchObject({ ok: false, status: 409 });
    expect((await itemOf(b, "cement")).purchasedQuantity).toBe(20);
  });

  it("the average price weighs each purchase by its quantity", async () => {
    const b = await inProcurement();
    await buy(b, ids.mgr1, "cement", 10, 100);
    await buy(b, ids.mgr1, "cement", 10, 200);
    expect(await itemOf(b, "cement")).toMatchObject({ actualUnitPrice: 150, actualTotal: 3000 });
  });
});

describe("10. original quantities are never touched", () => {
  it("purchases, voids and price edits leave requested and issued quantities alone", async () => {
    const b = await inProcurement();
    const before = await prisma.materialRequestItem.findMany({ where: { requestId: b.requestId }, orderBy: { lineNo: "asc" } });
    const checkBefore = await prisma.warehouseCheckItem.findMany({ where: { requestItem: { requestId: b.requestId } }, orderBy: { id: "asc" } });

    const bought = await buy(b, ids.mgr1, "bearing", 12);
    if (!bought.ok) throw new Error(bought.error);
    await voidPurchase(b.requestId, ids.mgr1, bought.detail.items.find((i) => i.itemId === b.itemIds.bearing)!.purchases[0].id, "x");
    const version = (await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } })).version;
    expect((await managerUpdateItemPrice(b.requestId, b.itemIds.bearing, ids.mgr1, 4200, version)).ok).toBe(true);

    const after = await prisma.materialRequestItem.findMany({ where: { requestId: b.requestId }, orderBy: { lineNo: "asc" } });
    expect(after.map((i) => Number(i.requestedQuantity))).toEqual(before.map((i) => Number(i.requestedQuantity)));
    const checkAfter = await prisma.warehouseCheckItem.findMany({ where: { requestItem: { requestId: b.requestId } }, orderBy: { id: "asc" } });
    expect(checkAfter).toEqual(checkBefore);
  });
});

describe("13. backend search finds current and historical purchases", () => {
  it("matches material name, request number, department, requested/purchased quantity, unit price, total and filters", async () => {
    const done = await inProcurement();
    await buyEverything(done); // cement 20, bearing 12, nozzle 4, bolt 6 @ 1250.5
    expect((await completeProcurement(done.requestId, ids.mgr1)).ok).toBe(true);

    const open = await inProcurement({ dept: "mech", by: ids.empB });
    await buy(open, ids.mgr1, "bearing", 5, 77.25);
    const search = (q: string, extra: Partial<Parameters<typeof listProcurement>[0]> = {}) =>
      listProcurement({ tab: "all", q, page: 1, pageSize: 50, ...extra }).then((r) => r.rows.map((x) => x.requestNumber).sort());
    const both = [done.requestNumber, open.requestNumber].sort();

    // text
    expect(await search(MATERIALS.bearing.name)).toEqual(expect.arrayContaining(both));
    expect(await search(open.requestNumber)).toEqual([open.requestNumber]);
    expect(await search(`PRX${TAG} Mechanic`)).toEqual([open.requestNumber]);
    expect(await search(`${TAG} zzz-no-such-material`)).toEqual([]);
    expect(await search(`PRX${TAG} Laser nozzle`)).toEqual(expect.arrayContaining(both));
    // numbers are exact: requested quantity, purchased quantity, unit price, total
    expect(await search("20")).toEqual(expect.arrayContaining([done.requestNumber])); // cement requested 20
    expect(await search("5", { q: "5" })).toEqual(expect.arrayContaining([open.requestNumber])); // bearing purchased 5 (partial)
    expect(await search("77.25")).toEqual(expect.arrayContaining([open.requestNumber])); // actual unit price
    expect(await search("386.25")).toEqual(expect.arrayContaining([open.requestNumber])); // 5 * 77.25 purchased total
    expect(await search("1,250.5")).toEqual(expect.arrayContaining([done.requestNumber])); // thousands separator tolerated
    expect(await search("1250.51")).not.toContain(done.requestNumber); // exact, not "starts with"
    expect(await search("7777777")).toEqual([]);
    // state, range and dates (scoped by the per-run tag in the query)
    const partial = await listProcurement({ tab: "all", q: TAG, itemStatus: "PARTIAL", page: 1, pageSize: 50 });
    // (other tests of this run also leave partial items, so assert membership, not equality)
    expect(partial.rows.map((r) => r.requestNumber)).toContain(open.requestNumber);
    expect(partial.rows.map((r) => r.requestNumber)).not.toContain(done.requestNumber); // every item of `done` is complete
    const range = await listProcurement({ tab: "all", q: TAG, priceMin: 1000, priceMax: 1300, qtyMin: 12, qtyMax: 12, page: 1, pageSize: 50 });
    expect(range.rows.map((r) => r.requestNumber)).toContain(done.requestNumber);
    expect(range.rows.map((r) => r.requestNumber)).not.toContain(open.requestNumber);
    const future = await listProcurement({ tab: "all", q: TAG, dateFrom: new Date(Date.now() + 86_400_000), page: 1, pageSize: 50 });
    expect(future.total).toBe(0);
  });

  it("finds a purchase after its request moved on to accounting, under 'completed'", async () => {
    const b = await inProcurement();
    await buyEverything(b);
    await completeProcurement(b.requestId, ids.mgr1);
    const completed = await listProcurement({ tab: "completed", q: b.requestNumber, page: 1, pageSize: 10 });
    expect(completed.rows).toHaveLength(1);
    expect(completed.rows[0]).toMatchObject({ requestStatus: "PENDING_ACCOUNTING", requiredItemCount: 4, completedItemCount: 4 });
    expect(completed.rows[0].completedAt).not.toBeNull();
    expect((await listProcurement({ tab: "awaiting", q: b.requestNumber, page: 1, pageSize: 10 })).total).toBe(0);
    expect((await listProcurement({ tab: "completed", q: MATERIALS.bolt.name + " " + TAG + "-no-such", page: 1, pageSize: 10 })).total).toBe(0);
  });

  it("paginates on the server and reports the total", async () => {
    const a = await inProcurement();
    const b = await inProcurement();
    const c = await inProcurement();
    const page1 = await listProcurement({ tab: "awaiting", q: TAG, page: 1, pageSize: 2 });
    const page2 = await listProcurement({ tab: "awaiting", q: TAG, page: 2, pageSize: 2 });
    expect(page1.total).toBe(page2.total);
    expect(page1.total).toBeGreaterThanOrEqual(3);
    expect(page1.rows).toHaveLength(2);
    expect(new Set([...page1.rows, ...page2.rows].map((r) => r.requestId)).size).toBe(Math.min(4, page1.total));
    expect([a, b, c].every((x) => typeof x.requestId === "string")).toBe(true);
  });

  it("does not expose private user details", async () => {
    const b = await inProcurement();
    const row = (await listProcurement({ tab: "awaiting", q: b.requestNumber, page: 1, pageSize: 5 })).rows[0];
    expect(JSON.stringify(row)).not.toContain("@test.local");
    expect(Object.keys(row)).not.toContain("email");
  });

  it("parses the numeric search syntax", () => {
    expect(parseSearchNumber("12")).toBe(12);
    expect(parseSearchNumber(" 1,250.5 ")).toBe(1250.5);
    expect(parseSearchNumber("12₮")).toBe(12);
    expect(parseSearchNumber("12 tons")).toBeNull();
    expect(parseSearchNumber("-5")).toBeNull();
    expect(parseSearchNumber("")).toBeNull();
  });
});

describe("15-16. existing workflows and historical requests are intact", () => {
  it("a Mechanic request goes through the same stages and is isolated from Beton", async () => {
    const b = await inProcurement({ dept: "mech", by: ids.empB });
    expect(await statusOf(b)).toBe("PENDING_PROCUREMENT");
    await buyEverything(b);
    expect((await completeProcurement(b.requestId, ids.mgr1)).ok).toBe(true);
    // the Beton head can't have decided it, and the Mechanic head still heads only Mechanic
    const dept = await prisma.approvalStep.findFirstOrThrow({ where: { requestId: b.requestId, type: "DEPARTMENT_HEAD" } });
    expect(dept.decidedById).toBe(ids.mechHead);
  });

  it("a request already waiting for accounting (no Manager step) is registered exactly as before", async () => {
    const created = await createRequest({ bolt: 3 }, { legacy: true });
    await prisma.approvalStep.updateMany({ where: { requestId: created.requestId, type: { not: "ACCOUNTING_RECORD" } }, data: { status: "APPROVED" } });
    const request = await prisma.materialRequest.update({ where: { id: created.requestId }, data: { status: "PENDING_ACCOUNTING" } });
    expect(await prisma.approvalStep.count({ where: { requestId: created.requestId, type: "MANAGER_PROCUREMENT" } })).toBe(0);

    const recorded = await recordAccountingEntry(created.requestId, ids.acct, { ledgerNumber: `OLD-${TAG}`, recordDate: new Date() }, request.version);
    expect(recorded.ok).toBe(true);
    expect(await statusOf(created)).toBe("ACCOUNTING_COMPLETED");
    // and it never shows up in the Manager's dashboard
    expect((await listProcurement({ tab: "all", q: created.requestNumber, page: 1, pageSize: 10 })).total).toBe(0);
  });

  it("listing and reading procurement data never modifies a request or its approval history", async () => {
    const created = await createRequest({ bolt: 3 }, { legacy: true });
    await prisma.materialRequest.update({ where: { id: created.requestId }, data: { status: "ACCOUNTING_COMPLETED" } });
    const snapshot = async () => ({
      request: await prisma.materialRequest.findUniqueOrThrow({ where: { id: created.requestId } }),
      steps: await prisma.approvalStep.findMany({ where: { requestId: created.requestId }, orderBy: { sequence: "asc" } }),
      actions: await prisma.approvalAction.count({ where: { approvalStep: { requestId: created.requestId } } }),
    });
    const before = await snapshot();
    await listProcurement({ tab: "all", q: created.requestNumber, page: 1, pageSize: 10 });
    const detail = await getProcurementDetail(created.requestId);
    expect(detail?.open).toBe(false);
    expect(await buy(created, ids.mgr1, "bolt", 1)).toMatchObject({ ok: false, status: 409 });
    expect(await snapshot()).toEqual(before);
  });
});
