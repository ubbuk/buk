import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { classifyProcurement, completeProcurement, getProcurementManagers, recordPurchase } from "@/lib/procurement";
import { branchApprove, departmentApprove, executiveApprove, financeApprove, recordAccountingEntry, warehouseCheck } from "@/lib/workflow";
import { getPending } from "@/lib/monitoring/queries";
import { getProcurementList, getProcurementRequestDetail } from "@/lib/monitoring/procurement";
import { resolveRange } from "@/lib/monitoring/time";

// End-to-end pass over the real handlers (only the session lookup is replaced), on the isolated
// test database: Employee -> BOSS -> Warehouse -> Directors -> CEO -> Procurement (domestic /
// international, partial buying, handover) -> Accounting, with the sidebar badge and the Monitoring
// section checked after every step. Positions are configured here and restored afterwards.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as REQUESTS_LIST, POST as REQUESTS_CREATE } from "../requests/route";
import { GET as REQUEST_ONE } from "../requests/[id]/route";
import { POST as CLASSIFY } from "../requests/[id]/procurement/classify/route";
import { POST as PURCHASE } from "../requests/[id]/procurement/purchases/route";
import { POST as COMPLETE } from "../requests/[id]/procurement/complete/route";
import { GET as BADGE } from "./badge/route";
import { GET as PREVIEW, POST as HANDOVER } from "../admin/procurement-handover/route";
import { POST as ROLES_POST } from "../admin/approval-roles/route";
import { ADMIN_TEST_HASH, withStepUp } from "./step-up-support";
import { GET as MONITORING } from "../admin/monitoring/[section]/route";

const PIN = "1234";
const TAG = Date.now().toString(36);
const P = "e2e-";
const roster = {
  emp: "EMPLOYEE", emp2: "EMPLOYEE", head: "BOSS", store: "STOREKEEPER", eng: "ENGINEERING", fin: "DIRECTOR", exec: "DIRECTOR",
  acct: "CHIEF_ACCOUNTANT", mgrA: "MANAGER", mgrB: "MANAGER", mgrA2: "MANAGER", admin: "ADMIN",
} as const;
type Who = keyof typeof roster;
const uid = (w: Who) => `${P}${w}`;
const DEPT = `${P}dept-${TAG}`;
const WH = `${P}wh`;
const as = (w: Who | null) => {
  session.current = w ? { user: { id: uid(w), role: roster[w], departmentId: w === "emp" || w === "emp2" || w === "head" ? DEPT : null, name: uid(w), email: `${uid(w)}@t.local` } } : null;
};
const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(withStepUp(body as object)) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

const SINGLETONS = { ENGINEERING_CHIEF: "eng", FINANCE_DIRECTOR: "fin", EXECUTIVE_DIRECTOR: "exec", STOREKEEPER_LEAD: "store", CHIEF_ACCOUNTANT_LEAD: "acct" } as const;
const POSITIONS = ["ENGINEERING_CHIEF", "FINANCE_DIRECTOR", "EXECUTIVE_DIRECTOR", "STOREKEEPER_LEAD", "CHIEF_ACCOUNTANT_LEAD", "DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] as const;
let previouslyActive: { id: string }[] = [];

const MAT = { cement: `${P}mat-cement`, bearing: `${P}mat-bearing`, washer: `${P}mat-washer`, bolt: `${P}mat-bolt` };
const STOCK = { cement: 0, bearing: 0, washer: 10, bolt: 4 }; // washer fully covered, bolt 6 to buy

async function wipe() {
  const mine = { requestedBy: { id: { startsWith: P } } };
  await prisma.procurementPurchase.deleteMany({ where: { requestItem: { request: mine } } });
  await prisma.stockIssue.deleteMany({ where: { reservation: { requestItem: { request: mine } } } });
  await prisma.stockReservation.deleteMany({ where: { requestItem: { request: mine } } });
  await prisma.warehouseCheck.deleteMany({ where: { request: mine } });
  await prisma.approvalAction.deleteMany({ where: { approvalStep: { request: mine } } });
  await prisma.accountingRecord.deleteMany({ where: { request: mine } });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: mine });
}
async function cleanup() {
  await wipe();
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.inventoryBalance.deleteMany({ where: { warehouseId: WH } });
  await prisma.material.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.warehouse.deleteMany({ where: { id: WH } });
  await prisma.user.updateMany({ where: { id: { startsWith: P } }, data: { departmentId: null } });
  await prisma.department.updateMany({ where: { id: { startsWith: P } }, data: { headId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  previouslyActive = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: [...POSITIONS] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: false, endedAt: new Date() } });

  await prisma.department.create({ data: { id: DEPT, name: `E2E ${TAG} цех`, type: "FACTORY" } });
  const pinHash = await bcrypt.hash(PIN, 10);
  for (const w of Object.keys(roster) as Who[]) {
    await prisma.user.create({ data: { id: uid(w), email: `${uid(w)}@test.local`, name: uid(w), role: roster[w], passwordHash: w === "admin" ? ADMIN_TEST_HASH : "x", departmentId: ["emp", "emp2", "head"].includes(w) ? DEPT : null } });
  }
  for (const w of ["head", "store", "eng", "fin", "exec"] as const) await prisma.approvalPinCredential.create({ data: { userId: uid(w), pinHash } });
  await prisma.department.update({ where: { id: DEPT }, data: { headId: uid("head") } });
  for (const [role, who] of Object.entries(SINGLETONS)) await prisma.approvalRoleAssignment.create({ data: { role: role as never, userId: uid(who) } });

  await prisma.warehouse.create({ data: { id: WH, name: "E2E wh" } });
  for (const [k, id] of Object.entries(MAT)) {
    await prisma.material.create({ data: { id, code: `E2E-${TAG}-${k}`, name: `E2E${TAG} ${k}`, unit: "ш", defaultPrice: 100 } });
    await prisma.inventoryBalance.create({ data: { materialId: id, warehouseId: WH, quantityOnHand: STOCK[k as keyof typeof STOCK] } });
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: true, endedAt: null } });
});

const badge = async (w: Who) => {
  as(w);
  const res = await BADGE();
  return res.status === 200 ? ((await res.json()) as { count: number }).count : -res.status;
};
const monitor = async (section: string, qs = "") => {
  const res = await MONITORING(new Request(`http://localhost/api/admin/monitoring/${section}${qs}`), { params: Promise.resolve({ section }) });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
};
const row = async (requestId: string, scope = "active", range = "all") => {
  as("admin");
  const res = await monitor("procurement-requests", `?scope=${scope}&range=${range}&pageSize=100&q=E2E${TAG}`);
  return (res.body.rows as { requestId: string; stage: string; partiallyPurchased: boolean; items: { itemId: string; purchased: number; status: string; managerName: string | null }[] }[]).find((r) => r.requestId === requestId);
};

// Walks one request from creation (through the real POST /api/requests) to the CEO's approval.
async function toProcurement() {
  as("emp");
  const res = await REQUESTS_CREATE(
    json({
      departmentId: DEPT,
      items: [
        { materialId: MAT.cement, materialName: "cement", unit: "ш", requestedQuantity: 20, unitPrice: 100 },
        { materialId: MAT.bearing, materialName: "bearing", unit: "ш", requestedQuantity: 12, unitPrice: 100 },
        { materialId: MAT.washer, materialName: "washer", unit: "ш", requestedQuantity: 6, unitPrice: 100 },
        { materialId: MAT.bolt, materialName: "bolt", unit: "ш", requestedQuantity: 10, unitPrice: 100 },
      ],
    })
  );
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string; version: number };
  const items = await prisma.materialRequestItem.findMany({ where: { requestId: created.id }, orderBy: { lineNo: "asc" } });
  const a = await departmentApprove(created.id, uid("head"), PIN, created.version);
  if (!a.ok) throw new Error(`department: ${a.error}`);
  const w = await warehouseCheck(created.id, uid("store"), items.map((i) => ({ requestItemId: i.id, availableQuantity: STOCK[(Object.keys(MAT) as (keyof typeof MAT)[]).find((k) => MAT[k] === i.materialId)!] })), PIN, a.request.version);
  if (!w.ok) throw new Error(`warehouse: ${w.error}`);
  const b = await branchApprove(created.id, uid("eng"), PIN, w.request.version);
  if (!b.ok) throw new Error(`branch: ${b.error}`);
  const f = await financeApprove(created.id, uid("fin"), PIN, b.request.version);
  if (!f.ok) throw new Error(`finance: ${f.error}`);
  return { id: created.id, ceoVersion: f.request.version, item: { cement: items[0].id, bearing: items[1].id, washer: items[2].id, bolt: items[3].id } };
}

describe("workflow: Employee -> BOSS -> Warehouse -> Directors -> CEO -> Procurement -> Accounting", () => {
  let r: Awaited<ReturnType<typeof toProcurement>>;
  let base = { a: 0, b: 0, a2: 0 };
  let handoverKey = "";

  it("an ADMIN configures the domestic and the international manager through the admin route", async () => {
    as("admin");
    expect((await ROLES_POST(json({ role: "DOMESTIC_PROCUMENT_MANAGER", userId: uid("mgrA") }))).status).toBe(400); // typo'd position is rejected
    expect((await ROLES_POST(json({ role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid("mgrA") }))).status).toBe(200);
    expect((await ROLES_POST(json({ role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: uid("mgrB") }))).status).toBe(200);
    expect((await ROLES_POST(json({ role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: uid("mgrA") }))).status).toBe(409); // one person cannot hold both
    expect(await getProcurementManagers()).toMatchObject({ mode: "ASSIGNED", domestic: { id: uid("mgrA") }, international: { id: uid("mgrB") } });
    base = { a: await badge("mgrA"), b: await badge("mgrB"), a2: await badge("mgrA2") };
  });

  it("the Employee creates the request; the layout is Manager (6) then Accounting (7)", async () => {
    r = await toProcurement();
    const steps = await prisma.approvalStep.findMany({ where: { requestId: r.id }, orderBy: { sequence: "asc" } });
    expect(steps.map((s) => `${s.sequence}:${s.type}`)).toEqual(["1:DEPARTMENT_HEAD", "2:WAREHOUSE_CHECK", "3:BRANCH_APPROVAL", "4:FINANCE_APPROVAL", "5:EXECUTIVE_APPROVAL", "6:MANAGER_PROCUREMENT", "7:ACCOUNTING_RECORD"]);
  });

  it("EMPLOYEE sees only their own request: a colleague gets neither the list entry nor the detail", async () => {
    as("emp");
    const own = (await (await REQUESTS_LIST()).json()) as { id: string }[];
    expect(own.map((x) => x.id)).toContain(r.id);
    expect((await REQUEST_ONE(new Request("http://localhost/x"), ctx(r.id))).status).toBe(200);
    as("emp2");
    const other = (await (await REQUESTS_LIST()).json()) as { id: string }[];
    expect(other.map((x) => x.id)).not.toContain(r.id);
    expect((await REQUEST_ONE(new Request("http://localhost/x"), ctx(r.id))).status).toBe(404);
    expect((await badge("emp2")) < 0).toBe(true); // no procurement counter for them (403)
  });

  it("the CEO's approval hands the request to procurement, not to accounting", async () => {
    const ceo = await executiveApprove(r.id, uid("exec"), PIN, r.ceoVersion);
    expect(ceo.ok).toBe(true);
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING_PROCUREMENT");
    expect(await prisma.notification.count({ where: { userId: uid("acct"), relatedRequestId: r.id } })).toBe(0);
    // the international manager has to classify first: only they have it in the sidebar counter
    expect(await badge("mgrB")).toBe(base.b + 1);
    expect(await badge("mgrA")).toBe(base.a);
    expect((await row(r.id))?.stage).toBe("AWAITING_CLASSIFICATION");
  });

  it("purchases are blocked until the international manager classifies; only they can classify", async () => {
    as("mgrA");
    expect((await PURCHASE(json({ itemId: r.item.cement, quantity: 1, unitPrice: 10 }), ctx(r.id))).status).toBe(409);
    expect((await CLASSIFY(json({ internationalItemIds: [r.item.bearing] }), ctx(r.id))).status).toBe(403);
    as("mgrB");
    const res = await CLASSIFY(json({ internationalItemIds: [r.item.bearing] }), ctx(r.id));
    expect(res.status).toBe(201);
    const row_ = await row(r.id);
    expect(row_?.stage).toBe("IN_PROCUREMENT");
    // domestic: cement + bolt (6 to buy; washer is covered by the warehouse); international: bearing
    expect(row_?.items.find((i) => i.itemId === r.item.washer)).toMatchObject({ status: "NOT_REQUIRED", managerName: null }); // covered by the warehouse: never assigned
    expect(await badge("mgrA")).toBe(base.a + 1);
    expect(await badge("mgrB")).toBe(base.b + 1);
  });

  it("partial purchasing: each manager buys only their own material", async () => {
    as("mgrA");
    expect((await PURCHASE(json({ itemId: r.item.cement, quantity: 5, unitPrice: 111 }), ctx(r.id))).status).toBe(201);
    expect((await PURCHASE(json({ itemId: r.item.bearing, quantity: 1, unitPrice: 10 }), ctx(r.id))).status).toBe(403); // B's item
    as("mgrB");
    expect((await PURCHASE(json({ itemId: r.item.cement, quantity: 1, unitPrice: 10 }), ctx(r.id))).status).toBe(403); // A's item
    expect((await PURCHASE(json({ itemId: r.item.bearing, quantity: 4, unitPrice: 222 }), ctx(r.id))).status).toBe(201);
    const monitored = await row(r.id);
    expect(monitored).toMatchObject({ stage: "IN_PROCUREMENT", partiallyPurchased: true });
    expect(monitored?.items.find((i) => i.itemId === r.item.cement)).toMatchObject({ purchased: 5, status: "PARTIAL" });
  });

  it("ADMIN handover needs an explicit confirmation, keeps history, and moves only the remaining work", async () => {
    const before = await prisma.procurementPurchase.findMany({ where: { requestItem: { requestId: r.id } }, orderBy: { id: "asc" } });
    as("admin");
    const preview = await PREVIEW(new Request(`http://localhost/x?position=DOMESTIC_PROCUREMENT_MANAGER&newManagerId=${uid("mgrA2")}`));
    expect(await preview.json()).toMatchObject({ affectedRequests: 1, affectedItems: 2, partiallyPurchasedItems: 1, previousManager: { id: uid("mgrA") } });
    expect((await prisma.procurementItemAssignment.findUniqueOrThrow({ where: { requestItemId: r.item.cement } })).assignedManagerId).toBe(uid("mgrA")); // previewing moved nothing
    handoverKey = `e2e-handover-${TAG}`;
    const body = { position: "DOMESTIC_PROCUREMENT_MANAGER", newManagerId: uid("mgrA2"), clientRequestId: handoverKey, expectedItems: 2 };
    expect((await HANDOVER(json({ ...body, reason: "" }))).status).toBe(400); // no reason, no transfer
    expect((await prisma.procurementItemAssignment.findUniqueOrThrow({ where: { requestItemId: r.item.cement } })).assignedManagerId).toBe(uid("mgrA"));
    // a plain role change is refused while work would be left behind
    expect((await ROLES_POST(json({ role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid("mgrA2") }))).status).toBe(409);
    expect((await HANDOVER(json({ ...body, reason: "Ажлаас гарсан" }))).status).toBe(201);
    expect(await prisma.procurementPurchase.findMany({ where: { requestItem: { requestId: r.id } }, orderBy: { id: "asc" } })).toEqual(before);
    as("mgrA");
    expect((await PURCHASE(json({ itemId: r.item.cement, quantity: 1, unitPrice: 10 }), ctx(r.id))).status).toBe(403);
    expect(await badge("mgrA")).toBe(base.a);
    expect(await badge("mgrA2")).toBe(base.a2 + 1);
    const detail = await getProcurementRequestDetail(r.id, new Date(), 72);
    expect(detail?.handovers.length).toBe(2);
    expect(detail?.purchases.find((p) => p.itemId === r.item.cement)?.purchasedByName).toBe(uid("mgrA")); // original manager preserved
  });

  it("the new manager completes the remaining quantities; accounting cannot jump ahead of procurement", async () => {
    as("mgrA2");
    expect((await PURCHASE(json({ itemId: r.item.cement, quantity: 16, unitPrice: 10 }), ctx(r.id))).status).toBe(409); // only 15 remain
    expect((await PURCHASE(json({ itemId: r.item.cement, quantity: 15, unitPrice: 111 }), ctx(r.id))).status).toBe(201);
    expect((await PURCHASE(json({ itemId: r.item.bolt, quantity: 6, unitPrice: 50 }), ctx(r.id))).status).toBe(201);
    as("mgrB");
    expect((await PURCHASE(json({ itemId: r.item.bearing, quantity: 8, unitPrice: 222 }), ctx(r.id))).status).toBe(201);
    expect((await row(r.id))?.stage).toBe("READY_TO_COMPLETE");
    expect(await badge("mgrA2")).toBe(base.a2);
    expect(await badge("mgrB")).toBe(base.b);

    // the Chief Accountant is not able to register yet
    const version = (await prisma.materialRequest.findUniqueOrThrow({ where: { id: r.id } })).version;
    expect(await recordAccountingEntry(r.id, uid("acct"), { ledgerNumber: "EARLY", recordDate: new Date() }, version)).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.accountingRecord.count({ where: { requestId: r.id } })).toBe(0);

    as("mgrA2");
    expect((await COMPLETE(json({}), ctx(r.id))).status).toBe(200);
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING_ACCOUNTING");
    expect(await prisma.notification.count({ where: { userId: uid("acct"), relatedRequestId: r.id } })).toBe(1);
    expect((await row(r.id))).toBeUndefined(); // gone from the active list
    expect((await row(r.id, "accounting"))?.stage).toBe("AWAITING_ACCOUNTING");
  });

  it("accounting records it afterwards and Monitoring shows the request as completed", async () => {
    const version = (await prisma.materialRequest.findUniqueOrThrow({ where: { id: r.id } })).version;
    expect((await recordAccountingEntry(r.id, uid("acct"), { ledgerNumber: `L-${TAG}`, recordDate: new Date() }, version)).ok).toBe(true);
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("ACCOUNTING_COMPLETED");
    expect((await row(r.id, "completed"))?.stage).toBe("PROCUREMENT_COMPLETED");
    const list = await getProcurementList(new Date(), { scope: "completed", filter: "all", q: `E2E${TAG}`, page: 1, pageSize: 10, thresholdHours: 72, range: resolveRange("all", new Date()) });
    expect(list.rows.map((x) => x.requestId)).toContain(r.id);
  });

  it("Monitoring is ADMIN/DIRECTOR only and read-only: others get 403 with no data", async () => {
    for (const w of ["emp", "head", "mgrA", "mgrB", "store", "acct"] as const) {
      as(w);
      const res = await monitor("procurement");
      expect(res.status, w).toBe(403);
      expect((await monitor("procurement-detail", `?id=${r.id}`)).status, w).toBe(403);
    }
    as("admin");
    expect((await monitor("procurement")).status).toBe(200);
  });
});

describe("approval sequence of a request created before the procurement stage (Accounting 6, Manager 7)", () => {
  let id = "";
  const num = `E2E-${TAG}-legacy`;

  it("procurement still comes first in the effective workflow", async () => {
    // exactly what an old request looks like at the CEO: six steps, accounting stored at 6
    const created = await prisma.materialRequest.create({
      data: {
        requestNumber: num, year: 9999, sequence: 9000, departmentId: DEPT, requestedById: uid("emp"), status: "PENDING_EXECUTIVE_APPROVAL", version: 3, submittedAt: new Date(),
        items: { create: [{ lineNo: 1, unit: "ш", requestedQuantity: 5, unitPrice: 100, materialId: MAT.cement, manualMaterialName: "cement" }] },
        approvalSteps: {
          create: [
            { type: "DEPARTMENT_HEAD", sequence: 1, status: "APPROVED", assignedUserId: uid("head"), decidedAt: new Date(), decidedById: uid("head") },
            { type: "WAREHOUSE_CHECK", sequence: 2, status: "APPROVED", assignedUserId: uid("store"), decidedAt: new Date(), decidedById: uid("store") },
            { type: "BRANCH_APPROVAL", sequence: 3, status: "APPROVED", assignedUserId: uid("eng"), decidedAt: new Date(), decidedById: uid("eng") },
            { type: "FINANCE_APPROVAL", sequence: 4, status: "APPROVED", assignedUserId: uid("fin"), decidedAt: new Date(), decidedById: uid("fin") },
            { type: "EXECUTIVE_APPROVAL", sequence: 5, status: "PENDING", assignedUserId: uid("exec") },
            { type: "ACCOUNTING_RECORD", sequence: 6, status: "PENDING", assignedUserId: uid("acct") },
          ],
        },
      },
    });
    id = created.id;
    const decided = await prisma.approvalStep.findMany({ where: { requestId: id, status: "APPROVED" }, orderBy: { sequence: "asc" } });

    expect((await executiveApprove(id, uid("exec"), PIN, 3)).ok).toBe(true);

    // the stored layout is the odd one: the new Manager step lands after Accounting...
    const steps = await prisma.approvalStep.findMany({ where: { requestId: id }, orderBy: { sequence: "asc" } });
    expect(steps.map((s) => `${s.sequence}:${s.type}`).slice(-2)).toEqual(["6:ACCOUNTING_RECORD", "7:MANAGER_PROCUREMENT"]);
    // ...and the decided history was not touched
    expect(await prisma.approvalStep.findMany({ where: { requestId: id, id: { in: decided.map((s) => s.id) } }, orderBy: { sequence: "asc" } })).toEqual(decided);

    // ...but the effective order is by type everywhere that matters:
    as("admin");
    const detail = (await (await REQUEST_ONE(new Request("http://localhost/x"), ctx(id))).json()) as { approvalSteps: { type: string }[] };
    const order = detail.approvalSteps.map((s) => s.type);
    expect(order.indexOf("MANAGER_PROCUREMENT")).toBeLessThan(order.indexOf("ACCOUNTING_RECORD"));
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_PROCUREMENT");
  });

  it("Monitoring names the Manager stage (no assignee), not the accountant, as the current step", async () => {
    const asOf = new Date();
    const first = await getPending(asOf, 1, 100);
    const lastPage = Math.max(1, Math.ceil(first.list.total / 100));
    const page = lastPage === 1 ? first : await getPending(asOf, lastPage, 100);
    const mine = page.list.rows.find((x) => x.id === id);
    expect(mine).toBeDefined();
    expect(mine?.status).toBe("PENDING_PROCUREMENT");
    expect(mine?.assignee).toBeNull();
  });

  it("the accountant cannot register until procurement is completed, then can", async () => {
    const version = (await prisma.materialRequest.findUniqueOrThrow({ where: { id } })).version;
    expect(await recordAccountingEntry(id, uid("acct"), { ledgerNumber: "TOO-EARLY", recordDate: new Date() }, version)).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.notification.count({ where: { userId: uid("acct"), relatedRequestId: id } })).toBe(0);

    // Manager side: the two procurement positions are (re)configured here so this test stands alone
    await prisma.approvalRoleAssignment.updateMany({ where: { role: { in: ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] }, isActive: true }, data: { isActive: false, endedAt: new Date() } });
    await prisma.approvalRoleAssignment.create({ data: { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid("mgrA") } });
    await prisma.approvalRoleAssignment.create({ data: { role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: uid("mgrB") } });
    const items = await prisma.materialRequestItem.findMany({ where: { requestId: id } });
    expect((await classifyProcurement(id, uid("mgrB"), [])).ok).toBe(true); // everything domestic
    expect((await recordPurchase(id, uid("mgrB"), { itemId: items[0].id, quantity: 5, unitPrice: 10 })).ok).toBe(false); // not the domestic manager
    expect((await recordPurchase(id, uid("mgrA"), { itemId: items[0].id, quantity: 5, unitPrice: 10 })).ok).toBe(true);
    expect((await completeProcurement(id, uid("mgrA"))).ok).toBe(true);

    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_ACCOUNTING");
    expect(await prisma.notification.count({ where: { userId: uid("acct"), relatedRequestId: id } })).toBe(1);
    const after = (await prisma.materialRequest.findUniqueOrThrow({ where: { id } })).version;
    expect((await recordAccountingEntry(id, uid("acct"), { ledgerNumber: `LL-${TAG}`, recordDate: new Date() }, after)).ok).toBe(true);
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id } })).status).toBe("ACCOUNTING_COMPLETED");
  });
});
