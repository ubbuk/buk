import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { ADMIN_TEST_HASH, ADMIN_TEST_PASSWORD } from "@/app/api/procurement/step-up-support";

// Admin -> delete a user, end to end at the API level on the isolated test database: what the person is responsible for,
// the explicit answers (who takes over / leave empty), the waiting approvals, the administrator's password, and the two outcomes
// (no history: erased; history: marked deleted, hidden, cannot sign in, e-mail released, records kept).
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as USERS_GET, POST as USERS_POST } from "./route";
import { DELETE as USER_DELETE, PATCH as USER_PATCH } from "./[id]/route";
import { GET as REMOVAL_GET } from "./[id]/removal/route";

const P = "udel-";
const TAG = Date.now().toString(36);
const id = (n: string) => `${P}${TAG}-${n}`;
const ADMIN = id("admin");
let ipN = 0;
const ip = () => `10.88.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/x", { method, headers: { "Content-Type": "application/json", "x-forwarded-for": ip() }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (uid: string) => ({ params: Promise.resolve({ id: uid }) });
const del = (uid: string, body: Record<string, unknown> = {}) => USER_DELETE(req("DELETE", { adminPassword: ADMIN_TEST_PASSWORD, transfers: {}, ...body }), ctx(uid));
const mk = (n: string, role: "EMPLOYEE" | "BOSS" | "DIRECTOR" | "STOREKEEPER" | "MANAGER" = "EMPLOYEE", extra: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { id: id(n), email: `${id(n)}@test.local`, name: `${P}${n}`, role, passwordHash: "x", ...extra } });
const exists = async (uid: string) => prisma.user.findUnique({ where: { id: uid } });
let reqSeq = 0;
const mkRequest = async (deptId: string, requester: string, status: "PENDING_DEPARTMENT_APPROVAL" | "PENDING_EXECUTIVE_APPROVAL" | "CANCELLED", step: { type: "DEPARTMENT_HEAD" | "EXECUTIVE_APPROVAL"; to: string }) => {
  const n = ++reqSeq;
  const r = await prisma.materialRequest.create({ data: { requestNumber: `UDEL-${TAG}-${n}`, year: 2097, sequence: 900_000 + n, departmentId: deptId, requestedById: requester, status } });
  await prisma.approvalStep.create({ data: { requestId: r.id, type: step.type, sequence: 1, status: "PENDING", assignedUserId: step.to } });
  return r;
};
let restore: { id: string }[] = [];
const POSITION = "FINANCE_DIRECTOR" as const;

beforeAll(async () => {
  await prisma.user.create({ data: { id: ADMIN, email: `${ADMIN}@test.local`, name: ADMIN, role: "ADMIN", passwordHash: ADMIN_TEST_HASH } });
  session.current = { user: { id: ADMIN, role: "ADMIN", name: "a", email: `${ADMIN}@test.local`, departmentId: null } };
  restore = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: [POSITION, "EXECUTIVE_DIRECTOR"] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: restore.map((r) => r.id) } }, data: { isActive: false, endedAt: new Date() } });
});
afterAll(async () => {
  const users = (await prisma.user.findMany({ where: { OR: [{ name: { startsWith: P } }, { id: { startsWith: P } }] }, select: { id: true } })).map((u) => u.id);
  const ids = [...users, ADMIN];
  await prisma.materialRequest.deleteMany({ where: { requestNumber: { startsWith: `UDEL-${TAG}` } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }, { entityType: "AuthorityGrant", entityId: { in: ids } }] } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { in: ids } } });
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: restore.map((r) => r.id) } }, data: { isActive: true, endedAt: null } });
  await prisma.department.updateMany({ where: { headId: { in: ids } }, data: { headId: null } });
  await prisma.warehouse.updateMany({ where: { keeperId: { in: ids } }, data: { keeperId: null } });
  await prisma.department.deleteMany({ where: { name: { startsWith: P } } });
  await prisma.warehouse.deleteMany({ where: { name: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("password, self, answers", () => {
  it("no password: 400; wrong password: 401 and nothing is removed; the administrator themselves: 400", async () => {
    await mk("pw");
    expect((await USER_DELETE(req("DELETE", { transfers: {} }), ctx(id("pw")))).status).toBe(400);
    const wrong = await del(id("pw"), { adminPassword: "not-the-password" });
    expect(wrong.status).toBe(401);
    expect(await exists(id("pw"))).not.toBeNull();
    const self = await del(ADMIN);
    expect(self.status).toBe(400);
    expect((await self.json()).code).toBe("SELF_DELETE");
    expect((await REMOVAL_GET(req("GET"), ctx(ADMIN))).status).toBe(400);
  });

  it("an ADMIN account can never be removed through this", async () => {
    await prisma.user.create({ data: { id: id("admin2"), email: `${id("admin2")}@test.local`, name: `${P}admin2`, role: "ADMIN", passwordHash: "x" } });
    expect((await del(id("admin2"))).status).toBe(409);
  });
});

describe("no history: erased for good", () => {
  it("a plain user disappears and the e-mail is free again", async () => {
    await mk("plain");
    const r = await del(id("plain"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await exists(id("plain"))).toBeNull();
    const created = await USERS_POST(req("POST", { email: `${id("plain")}@test.local`, name: `${P}plain-again`, role: "EMPLOYEE" }));
    expect(created.status).toBe(201);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "User", entityId: id("plain"), actorId: ADMIN, action: "UPDATE_USER" } });
    expect(JSON.parse(audit!.afterJson!)).toMatchObject({ kind: "USER_DELETE", mode: "HARD" });
    expect(audit!.afterJson).not.toContain(ADMIN_TEST_PASSWORD);
  });
});

describe("with history: marked deleted, records kept", () => {
  it("hidden from the list, cannot sign in, e-mail released and reusable, history and name kept, 'deleted' only", async () => {
    const u = await mk("hist", "EMPLOYEE", { canViewPayroll: true });
    await prisma.auditLog.create({ data: { entityType: "Test", entityId: "x", action: "CREATE", actorId: u.id } });
    await prisma.notification.create({ data: { userId: u.id, type: "GENERIC", title: "t", body: "b" } });
    const r = await del(u.id);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true }); // the screen cannot tell the two outcomes apart

    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row).toMatchObject({ isActive: false, canViewPayroll: false, name: `${P}hist` });
    expect(row.email).not.toBe(`${id("hist")}@test.local`);
    expect(await bcrypt.compare("x", row.passwordHash)).toBe(false);
    expect(row.sessionVersion).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { actorId: u.id, entityType: "Test" } })).toBe(1); // who did what survives
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0);

    const list = (await (await USERS_GET()).json()) as { id: string }[];
    expect(list.some((x) => x.id === u.id)).toBe(false);
    expect((await USER_PATCH(req("PATCH", { isActive: true }), ctx(u.id))).status).toBe(404); // cannot be brought back by id
    expect((await REMOVAL_GET(req("GET"), ctx(u.id))).status).toBe(404);
    expect((await del(u.id)).status).toBe(404); // already gone for the admin

    const again = await USERS_POST(req("POST", { email: `${id("hist")}@test.local`, name: `${P}hist-again`, role: "EMPLOYEE" }));
    expect(again.status).toBe(201); // the address is reusable
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "User", entityId: u.id, action: "UPDATE_USER", actorId: ADMIN } });
    expect(JSON.parse(audit!.afterJson!)).toMatchObject({ kind: "USER_DELETE", mode: "SOFT" });
  });
});

describe("positions", () => {
  it("the dialog lists the position with eligible people; every responsibility needs an explicit answer", async () => {
    await mk("dir1", "DIRECTOR");
    await mk("dir2", "DIRECTOR");
    await prisma.approvalRoleAssignment.create({ data: { role: POSITION, userId: id("dir1") } });
    const info = await (await REMOVAL_GET(req("GET"), ctx(id("dir1")))).json();
    expect(info.responsibilities).toHaveLength(1);
    expect(info.responsibilities[0]).toMatchObject({ key: `position:${POSITION}`, kind: "POSITION" });
    expect(info.responsibilities[0].candidates.map((c: { id: string }) => c.id)).toContain(id("dir2"));
    expect(info.responsibilities[0].candidates.map((c: { id: string }) => c.id)).not.toContain(id("dir1"));

    const missing = await del(id("dir1"));
    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBe("ANSWER_MISSING");
    expect(await exists(id("dir1"))).not.toBeNull();
  });

  it("an ineligible person (wrong role) is refused and nothing changes", async () => {
    await mk("emp-x");
    const r = await del(id("dir1"), { transfers: { [`position:${POSITION}`]: id("emp-x") } });
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("RECEIVER_INELIGIBLE");
    expect(await exists(id("dir1"))).not.toBeNull();
    expect(await prisma.approvalRoleAssignment.count({ where: { userId: id("dir1"), isActive: true } })).toBe(1);
  });

  it("the position goes to the chosen person, who is told; the old holder is removed", async () => {
    const r = await del(id("dir1"), { transfers: { [`position:${POSITION}`]: id("dir2") } });
    expect(r.status).toBe(200);
    const holders = await prisma.approvalRoleAssignment.findMany({ where: { role: POSITION, isActive: true } });
    expect(holders.map((h) => h.userId)).toEqual([id("dir2")]);
    expect(await prisma.notification.count({ where: { userId: id("dir2") } })).toBeGreaterThan(0);
    expect(await exists(id("dir1"))).toBeNull(); // no history besides the position record
  });

  it("'leave empty' is allowed on purpose: the position ends up with nobody", async () => {
    await mk("dir3", "DIRECTOR");
    await prisma.approvalRoleAssignment.updateMany({ where: { role: POSITION, isActive: true }, data: { isActive: false } });
    await prisma.approvalRoleAssignment.create({ data: { role: POSITION, userId: id("dir3") } });
    const r = await del(id("dir3"), { transfers: { [`position:${POSITION}`]: null } });
    expect(r.status).toBe(200);
    expect(await prisma.approvalRoleAssignment.count({ where: { role: POSITION, isActive: true } })).toBe(0);
  });
});

describe("department head and waiting orders", () => {
  it("head and the order waiting on them move to the new head (notified); without a receiver the removal is refused whole", async () => {
    const dept = await prisma.department.create({ data: { name: `${P}${TAG}-dept`, type: "FACTORY" } });
    await mk("boss1", "BOSS", { departmentId: dept.id });
    await mk("boss2", "BOSS");
    await mk("worker", "EMPLOYEE", { departmentId: dept.id });
    await prisma.department.update({ where: { id: dept.id }, data: { headId: id("boss1") } });
    const waiting = await mkRequest(dept.id, id("worker"), "PENDING_DEPARTMENT_APPROVAL", { type: "DEPARTMENT_HEAD", to: id("boss1") });
    const done = await mkRequest(dept.id, id("worker"), "CANCELLED", { type: "DEPARTMENT_HEAD", to: id("boss1") });

    const info = await (await REMOVAL_GET(req("GET"), ctx(id("boss1")))).json();
    expect(info.pending.requests).toBe(1); // a cancelled request is nothing to hand over
    const key = `head:${dept.id}`;

    const noReceiverForHead = await del(id("boss1"), { transfers: { [key]: null } });
    expect(noReceiverForHead.status).toBe(400); // the waiting order has nobody to go to
    expect((await noReceiverForHead.json()).code).toBe("PENDING_RECEIVER_REQUIRED");
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept.id } })).headId).toBe(id("boss1")); // all or nothing

    const ok = await del(id("boss1"), { transfers: { [key]: id("boss2") } });
    expect(ok.status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept.id } })).headId).toBe(id("boss2"));
    expect((await prisma.approvalStep.findFirstOrThrow({ where: { requestId: waiting.id } })).assignedUserId).toBe(id("boss2"));
    expect((await prisma.approvalStep.findFirstOrThrow({ where: { requestId: done.id } })).assignedUserId).toBe(id("boss1")); // history untouched
    expect(await prisma.notification.count({ where: { userId: id("boss2"), relatedRequestId: waiting.id } })).toBe(1);
    // the person stays in the records (the cancelled request is theirs): soft-deleted
    expect((await exists(id("boss1")))?.deletedAt).toBeInstanceOf(Date);
  });

  it("waiting orders go to the receiver the admin picked; a receiver of another role is refused", async () => {
    const dept = await prisma.department.create({ data: { name: `${P}${TAG}-dept2`, type: "FACTORY" } });
    await mk("boss3", "BOSS");
    await mk("boss4", "BOSS");
    await mk("emp3", "EMPLOYEE", { departmentId: dept.id });
    const r1 = await mkRequest(dept.id, id("emp3"), "PENDING_DEPARTMENT_APPROVAL", { type: "DEPARTMENT_HEAD", to: id("boss3") });
    const bad = await del(id("boss3"), { pendingReceiverId: id("emp3") });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("RECEIVER_INELIGIBLE");
    const ok = await del(id("boss3"), { pendingReceiverId: id("boss4") });
    expect(ok.status).toBe(200);
    expect((await prisma.approvalStep.findFirstOrThrow({ where: { requestId: r1.id } })).assignedUserId).toBe(id("boss4"));
  });
});

describe("warehouse keeper", () => {
  it("the warehouse goes to the chosen keeper", async () => {
    await mk("keep1", "STOREKEEPER");
    await mk("keep2", "STOREKEEPER");
    const w = await prisma.warehouse.create({ data: { name: `${P}${TAG}-wh`, keeperId: id("keep1") } });
    const key = `keeper:${w.id}`;
    expect((await del(id("keep1"))).status).toBe(400); // an answer is required
    expect((await del(id("keep1"), { transfers: { [key]: id("keep2") } })).status).toBe(200);
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: w.id } })).keeperId).toBe(id("keep2"));
  });
});

describe("executive approvals", () => {
  it("the executive's waiting approval follows the Executive Director position to its new holder, with the immutable record", async () => {
    const dept = await prisma.department.create({ data: { name: `${P}${TAG}-dept3`, type: "OFFICE" } });
    await mk("ex1", "DIRECTOR");
    await mk("ex2", "DIRECTOR");
    await mk("emp4", "EMPLOYEE", { departmentId: dept.id });
    await prisma.approvalRoleAssignment.create({ data: { role: "EXECUTIVE_DIRECTOR", userId: id("ex1") } });
    const r = await mkRequest(dept.id, id("emp4"), "PENDING_EXECUTIVE_APPROVAL", { type: "EXECUTIVE_APPROVAL", to: id("ex1") });
    const key = "position:EXECUTIVE_DIRECTOR";

    // the new executive has no approval PIN yet: refused, nothing moves
    const noPin = await del(id("ex1"), { transfers: { [key]: id("ex2") } });
    expect(noPin.status).toBe(409);
    expect((await noPin.json()).code).toBe("NO_PIN");
    expect((await exists(id("ex1")))?.deletedAt).toBeNull();

    await prisma.approvalPinCredential.create({ data: { userId: id("ex2"), pinHash: "x" } });
    // leaving the position empty would strand the executive's order: refused
    const empty = await del(id("ex1"), { transfers: { [key]: null } });
    expect(empty.status).toBe(400);
    expect((await empty.json()).code).toBe("EXECUTIVE_RECEIVER_REQUIRED");

    const ok = await del(id("ex1"), { transfers: { [key]: id("ex2") } });
    expect(ok.status).toBe(200);
    expect((await prisma.approvalStep.findFirstOrThrow({ where: { requestId: r.id } })).assignedUserId).toBe(id("ex2"));
    expect(await prisma.executiveApprovalReassignment.count({ where: { requestId: r.id, fromUserId: id("ex1"), toUserId: id("ex2"), reassignedById: ADMIN } })).toBe(1);
  });
});

describe("waiting orders: cancel them instead of handing over", () => {
  it("with nobody to hand over to, the orders are cancelled (reason, audit, requester told), open steps skipped, and the person can be removed", async () => {
    const dept = await prisma.department.create({ data: { name: `${P}${TAG}-dept4`, type: "FACTORY" } });
    await mk("boss5", "BOSS");
    await mk("emp5", "EMPLOYEE", { departmentId: dept.id });
    await prisma.department.update({ where: { id: dept.id }, data: { headId: id("boss5") } });
    const waiting = await mkRequest(dept.id, id("emp5"), "PENDING_DEPARTMENT_APPROVAL", { type: "DEPARTMENT_HEAD", to: id("boss5") });
    const key = `head:${dept.id}`;

    const info = await (await REMOVAL_GET(req("GET"), ctx(id("boss5")))).json();
    expect(info.pending).toMatchObject({ requests: 1, cancellable: 1 });

    const noAnswer = await del(id("boss5"), { transfers: { [key]: null } });
    expect(noAnswer.status).toBe(400); // still needs an explicit answer for the orders

    const ok = await del(id("boss5"), { transfers: { [key]: null }, cancelPending: true });
    expect(ok.status).toBe(200);
    const r = await prisma.materialRequest.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(r).toMatchObject({ status: "CANCELLED", cancelReason: "Хэрэглэгч устгагдсан (админ)" });
    expect(r.cancelledAt).toBeInstanceOf(Date);
    expect((await prisma.approvalStep.findFirstOrThrow({ where: { requestId: waiting.id } })).status).toBe("SKIPPED");
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "MaterialRequest", entityId: waiting.id, action: "CANCEL", actorId: ADMIN } });
    expect(JSON.parse(audit!.afterJson!)).toMatchObject({ status: "CANCELLED", reason: "Хэрэглэгч устгагдсан (админ)" });
    expect(await prisma.notification.count({ where: { userId: id("emp5"), relatedRequestId: waiting.id } })).toBe(1);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept.id } })).headId).toBeNull();
  });

  it("an executive's pending order can be cancelled even with the position left empty", async () => {
    const dept = await prisma.department.create({ data: { name: `${P}${TAG}-dept5`, type: "OFFICE" } });
    await mk("ex3", "DIRECTOR");
    await mk("emp6", "EMPLOYEE", { departmentId: dept.id });
    await prisma.approvalRoleAssignment.create({ data: { role: "EXECUTIVE_DIRECTOR", userId: id("ex3") } });
    const r = await mkRequest(dept.id, id("emp6"), "PENDING_EXECUTIVE_APPROVAL", { type: "EXECUTIVE_APPROVAL", to: id("ex3") });
    const ok = await del(id("ex3"), { transfers: { "position:EXECUTIVE_DIRECTOR": null }, cancelPending: true });
    expect(ok.status).toBe(200);
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
    expect(await prisma.approvalRoleAssignment.count({ where: { role: "EXECUTIVE_DIRECTOR", isActive: true } })).toBe(0);
  });
});
