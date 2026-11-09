import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { classifyProcurement, recordPurchase } from "@/lib/procurement";

// Manager workload badge and safe handover as seen through the route handlers (only the
// session lookup is replaced), on the isolated test database. The two procurement
// positions are configured here and restored afterwards.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as BADGE } from "./badge/route";
import { GET as PREVIEW, POST as HANDOVER } from "../admin/procurement-handover/route";
import { POST as ROLES_POST } from "../admin/approval-roles/route";
import { ADMIN_TEST_HASH, withStepUp } from "./step-up-support";
import { PATCH as USER_PATCH } from "../admin/users/[id]/route";

const P = "hr-";
const TAG = Date.now().toString(36);
const DEPT = `${P}dept-${TAG}`;
const OTHER_DEPT = `${P}other-${TAG}`;
const roster = {
  emp: { role: "EMPLOYEE", dept: DEPT },
  boss: { role: "BOSS", dept: OTHER_DEPT },
  mgrA: { role: "MANAGER", dept: null }, // domestic
  mgrB: { role: "MANAGER", dept: null }, // international
  mgrA2: { role: "MANAGER", dept: null },
  mgrC: { role: "MANAGER", dept: null },
  admin: { role: "ADMIN", dept: null },
  director: { role: "DIRECTOR", dept: null },
  store: { role: "STOREKEEPER", dept: null },
  acct: { role: "CHIEF_ACCOUNTANT", dept: null },
} as const;
type Who = keyof typeof roster;
const uid = (w: Who) => `${P}${w}`;
const as = (w: Who | null) => {
  session.current = w ? { user: { id: uid(w), role: roster[w].role, departmentId: roster[w].dept, name: uid(w), email: `${uid(w)}@t.local` } } : null;
};
const POSITIONS = ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] as const;
let previouslyActive: { id: string }[] = [];
let counter = 0;
let keyCounter = 0;
const key = () => `hr-key-${TAG}-${(keyCounter += 1)}`;

// the admin routes that grant authority need the admin own password, a reason and a confirmation (lib/authority-grant.ts)
const json = (method: string, body?: unknown) => new Request("http://localhost/x", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(method === "GET" ? body : withStepUp(body as object)) });
const handoverBody = (over: Record<string, unknown> = {}) => ({
  position: "DOMESTIC_PROCUREMENT_MANAGER",
  newManagerId: uid("mgrA2"),
  reason: "Ажлаас гарсан",
  clientRequestId: key(),
  expectedItems: 2,
  ...over,
});
const userCtx = (w: Who) => ({ params: Promise.resolve({ id: uid(w) }) }) as never;

async function wipeRequests() {
  const mine = { requestNumber: { startsWith: "HR-" } };
  await prisma.procurementPurchase.deleteMany({ where: { requestItem: { request: mine } } });
  await prisma.warehouseCheck.deleteMany({ where: { request: mine } });
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
async function configure(domestic: Who | null, international: Who | null) {
  await prisma.approvalRoleAssignment.updateMany({ where: { role: { in: [...POSITIONS] }, isActive: true }, data: { isActive: false, endedAt: new Date() } });
  if (domestic) await prisma.approvalRoleAssignment.create({ data: { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid(domestic) } });
  if (international) await prisma.approvalRoleAssignment.create({ data: { role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: uid(international) } });
}

beforeAll(async () => {
  await cleanup();
  previouslyActive = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: [...POSITIONS] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: false, endedAt: new Date() } });
  await prisma.department.createMany({ data: [{ id: DEPT, name: `HR ${TAG} dept`, type: "FACTORY" }, { id: OTHER_DEPT, name: `HR ${TAG} other`, type: "FACTORY" }] });
  await prisma.user.createMany({
    data: (Object.keys(roster) as Who[]).map((w) => ({ id: uid(w), email: `${uid(w)}@test.local`, name: uid(w), passwordHash: w === "admin" ? ADMIN_TEST_HASH : "x", role: roster[w].role as never, departmentId: roster[w].dept })),
  });
});
beforeEach(async () => {
  await prisma.loginThrottle.deleteMany(); // each test starts with a fresh grant / password budget
  await wipeRequests();
  await prisma.user.updateMany({ where: { id: { startsWith: P } }, data: { isActive: true } });
});
afterAll(async () => {
  await cleanup();
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: true, endedAt: null } });
});

/** Domestic: cement 20 + bolt 6 to buy. International: bearing 12 (nozzle none here). */
async function classifiedRequest() {
  counter += 1;
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber: `HR-${TAG}-${counter}`,
      year: 9999,
      sequence: counter,
      departmentId: DEPT,
      requestedById: uid("emp"),
      status: "PENDING_PROCUREMENT",
      version: 5,
      items: { create: [
        { lineNo: 1, unit: "ш", requestedQuantity: 20, manualMaterialName: `HR ${TAG} cement` },
        { lineNo: 2, unit: "ш", requestedQuantity: 6, manualMaterialName: `HR ${TAG} bolt` },
        { lineNo: 3, unit: "ш", requestedQuantity: 12, manualMaterialName: `HR ${TAG} bearing` },
      ] },
      approvalSteps: { create: [
        ...(["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL"] as const).map((type, i) => ({ type, sequence: i + 1, status: "APPROVED" as const, assignedUserId: uid("store") })),
        { type: "MANAGER_PROCUREMENT" as const, sequence: 6, status: "PENDING" as const, assignedUserId: null },
        { type: "ACCOUNTING_RECORD" as const, sequence: 7, status: "PENDING" as const, assignedUserId: uid("acct") },
      ] },
    },
    include: { items: { orderBy: { lineNo: "asc" } } },
  });
  const check = await prisma.warehouseCheck.create({ data: { requestId: created.id, checkedById: uid("store") } });
  for (const i of created.items) {
    await prisma.warehouseCheckItem.create({ data: { warehouseCheckId: check.id, requestItemId: i.id, availableQuantity: 0, allocatedQuantity: 0, missingQuantity: i.requestedQuantity } });
  }
  const [cement, bolt, bearing] = created.items.map((i) => i.id);
  const r = await classifyProcurement(created.id, uid("mgrB"), [bearing]);
  if (!r.ok) throw new Error(r.error);
  return { id: created.id, cement, bolt, bearing };
}

const badge = async (w: Who | null) => {
  as(w);
  const res = await BADGE();
  return { status: res.status, count: res.status === 200 ? ((await res.json()) as { count: number }).count : null };
};

describe("GET /api/procurement/badge", () => {
  it("returns the manager-specific distinct request count", async () => {
    await configure("mgrA", "mgrB");
    await classifiedRequest();
    await classifiedRequest();
    expect(await badge("mgrA")).toEqual({ status: 200, count: 2 });
    expect(await badge("mgrC")).toEqual({ status: 200, count: 0 });
  });

  it("is limited to MANAGER and ADMIN: nobody else gets request data through the counter", async () => {
    await configure("mgrA", "mgrB");
    await classifiedRequest();
    for (const w of ["emp", "boss", "director", "store", "acct"] as const) expect((await badge(w)).status, w).toBe(403);
    expect((await badge(null)).status).toBe(401);
    expect((await badge("admin")).status).toBe(200);
  });

  it("follows a handover: the old manager's number drops, the new manager's rises", async () => {
    await configure("mgrA", "mgrB");
    await classifiedRequest();
    expect((await badge("mgrA2")).count).toBe(0);
    as("admin");
    expect((await HANDOVER(json("POST", handoverBody()))).status).toBe(201);
    expect((await badge("mgrA")).count).toBe(0);
    expect((await badge("mgrA2")).count).toBe(1);
  });
});

describe("/api/admin/procurement-handover", () => {
  it("previews for ADMIN only", async () => {
    await configure("mgrA", "mgrB");
    await classifiedRequest();
    const url = `http://localhost/x?position=DOMESTIC_PROCUREMENT_MANAGER&newManagerId=${uid("mgrA2")}`;
    as("admin");
    const ok = await PREVIEW(new Request(url));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ affectedRequests: 1, affectedItems: 2, previousManager: { id: uid("mgrA") }, newManager: { id: uid("mgrA2") }, newManagerProblem: null });
    expect((await PREVIEW(new Request("http://localhost/x?position=NOPE"))).status).toBe(400);
    for (const w of ["mgrA", "mgrB", "emp", "boss", "director"] as const) {
      as(w);
      expect((await PREVIEW(new Request(url))).status, w).toBe(403);
    }
    as(null);
    expect((await PREVIEW(new Request(url))).status).toBe(403);
  });

  it("forbids non-admins from handing over and changes nothing", async () => {
    await configure("mgrA", "mgrB");
    const r = await classifiedRequest();
    for (const w of ["mgrA", "mgrA2", "mgrB", "emp", "boss"] as const) {
      as(w);
      expect((await HANDOVER(json("POST", handoverBody()))).status, w).toBe(403);
    }
    expect((await prisma.procurementItemAssignment.findUniqueOrThrow({ where: { requestItemId: r.cement } })).assignedManagerId).toBe(uid("mgrA"));
  });

  it("transfers on confirmation (201), acknowledges a duplicate (200), and rejects bad input", async () => {
    await configure("mgrA", "mgrB");
    const r = await classifiedRequest();
    as("admin");
    const body = handoverBody();
    const first = await HANDOVER(json("POST", body));
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false, summary: { newManagerId: uid("mgrA2"), affectedItemIds: expect.arrayContaining([r.cement, r.bolt]) } });
    const again = await HANDOVER(json("POST", body));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(await prisma.auditLog.count({ where: { entityType: "ProcurementHandover", entityId: body.clientRequestId } })).toBe(1);

    expect((await HANDOVER(json("POST", handoverBody({ reason: "" })))).status).toBe(400);
    expect((await HANDOVER(json("POST", handoverBody({ position: "DOMESTIC_MANAGER" })))).status).toBe(400);
    expect((await HANDOVER(json("POST", handoverBody({ newManagerId: uid("emp") })))).status).toBe(400);
    expect((await HANDOVER(json("POST", handoverBody({ newManagerId: uid("mgrB") })))).status).toBe(409);
    await prisma.user.update({ where: { id: uid("mgrC") }, data: { isActive: false } });
    expect((await HANDOVER(json("POST", handoverBody({ newManagerId: uid("mgrC") })))).status).toBe(400);
    const stale = await HANDOVER(json("POST", handoverBody({ newManagerId: uid("mgrA"), expectedItems: 9 })));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "WORK_CHANGED" });
  });

  it("lets the new manager continue and refuses the old one over the purchase routes' domain rules", async () => {
    await configure("mgrA", "mgrB");
    const r = await classifiedRequest();
    expect((await recordPurchase(r.id, uid("mgrA"), { itemId: r.cement, quantity: 5, unitPrice: 10 })).ok).toBe(true);
    as("admin");
    expect((await HANDOVER(json("POST", handoverBody()))).status).toBe(201);
    expect(await recordPurchase(r.id, uid("mgrA"), { itemId: r.cement, quantity: 1, unitPrice: 10 })).toMatchObject({ ok: false, status: 403 });
    expect((await recordPurchase(r.id, uid("mgrA2"), { itemId: r.cement, quantity: 15, unitPrice: 10 })).ok).toBe(true);
  });
});

describe("manager changes cannot silently orphan unfinished work", () => {
  it("approval-roles refuses to replace a holder who still has unfinished items (HANDOVER_REQUIRED) and changes nothing", async () => {
    await configure("mgrA", "mgrB");
    const r = await classifiedRequest();
    as("admin");
    const res = await ROLES_POST(json("POST", { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid("mgrA2") }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "HANDOVER_REQUIRED", affectedRequests: 1, affectedItems: 2 });
    expect((await prisma.approvalRoleAssignment.findFirstOrThrow({ where: { role: "DOMESTIC_PROCUREMENT_MANAGER", isActive: true } })).userId).toBe(uid("mgrA"));
    expect((await prisma.procurementItemAssignment.findUniqueOrThrow({ where: { requestItemId: r.cement } })).assignedManagerId).toBe(uid("mgrA"));
  });

  it("approval-roles still replaces a holder with nothing unfinished, and keeps its other validations", async () => {
    await configure("mgrA", "mgrB");
    as("admin");
    expect((await ROLES_POST(json("POST", { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid("mgrA2") }))).status).toBe(200);
    expect((await ROLES_POST(json("POST", { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid("emp") }))).status).toBe(400);
    expect((await ROLES_POST(json("POST", { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid("mgrB") }))).status).toBe(409);
    as("mgrA");
    expect((await ROLES_POST(json("POST", { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid("mgrC") }))).status).toBe(403);
  });

  it("approval-roles replacing the international holder keeps the classification queue and tells the new holder", async () => {
    await configure("mgrA", "mgrB");
    as("admin");
    // a request still waiting for classification
    counter += 1;
    await prisma.materialRequest.create({
      data: {
        requestNumber: `HR-${TAG}-${counter}`, year: 9999, sequence: counter, departmentId: DEPT, requestedById: uid("emp"), status: "PENDING_PROCUREMENT", version: 5,
        items: { create: [{ lineNo: 1, unit: "ш", requestedQuantity: 3, manualMaterialName: `HR ${TAG} pending` }] },
        approvalSteps: { create: [{ type: "MANAGER_PROCUREMENT", sequence: 6, status: "PENDING", assignedUserId: null }] },
      },
    });
    expect((await ROLES_POST(json("POST", { role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: uid("mgrC") }))).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: uid("mgrC"), title: { contains: "Ангилах" } } })).toBe(1);
    expect((await badge("mgrC")).count).toBeGreaterThanOrEqual(1);
  });

  it("deactivating, or removing the MANAGER role of, a manager with unfinished work needs an explicit acknowledgement", async () => {
    await configure("mgrA", "mgrB");
    await classifiedRequest();
    as("admin");
    const refused = await USER_PATCH(json("PATCH", { isActive: false }), userCtx("mgrA"));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "HANDOVER_REQUIRED", affectedItems: 2 });
    expect((await USER_PATCH(json("PATCH", { role: "EMPLOYEE" }), userCtx("mgrA"))).status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: uid("mgrA") } })).isActive).toBe(true);

    // a manager without work is unaffected
    expect((await USER_PATCH(json("PATCH", { isActive: false }), userCtx("mgrC"))).status).toBe(200);

    // the deliberate override still works and is audited
    const ok = await USER_PATCH(json("PATCH", { isActive: false, acknowledgeUnfinishedProcurement: true }), userCtx("mgrA"));
    expect(ok.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: uid("mgrA") } })).isActive).toBe(false);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "User", entityId: uid("mgrA"), action: "UPDATE_USER", actorId: uid("admin") }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(log.afterJson!)).toMatchObject({ acknowledgedUnfinishedProcurement: { items: 2, requests: 1 } });
  });

  it("recovery after the override: handover to a replacement works with the previous manager already inactive", async () => {
    await configure("mgrA", "mgrB");
    const r = await classifiedRequest();
    await prisma.user.update({ where: { id: uid("mgrA") }, data: { isActive: false } });
    as("admin");
    expect((await HANDOVER(json("POST", handoverBody()))).status).toBe(201);
    expect((await prisma.procurementItemAssignment.findUniqueOrThrow({ where: { requestItemId: r.bolt } })).assignedManagerId).toBe(uid("mgrA2"));
    expect((await badge("mgrA2")).count).toBe(1);
  });
});
