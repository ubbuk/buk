import bcrypt from "bcrypt";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { assignDepartmentHead } from "./department-head";
import { departmentApprove, departmentReturn, resubmitDepartmentReturn } from "./workflow";

// Beton vs Mechanic isolation at the data layer. Runs against the isolated
// test database only (see vitest.setup.ts). Every test builds its own pair of
// departments so leftover rows from earlier runs can't change the counts.
const PIN = "1234";
const ids = {
  betonHead: "iso-beton-head",
  mechHead: "iso-mech-head",
  mechHead2: "iso-mech-head2",
  betonEmp: "iso-beton-emp",
  mechEmp: "iso-mech-emp",
  store: "iso-store",
  clerk: "iso-clerk", // EMPLOYEE role -- not a valid head
  inactiveBoss: "iso-inactive-boss",
  admin: "iso-admin",
};

let counter = 0;
const unique = () => `${Date.now()}-${++counter}`;

beforeAll(async () => {
  const users: { id: string; role: "BOSS" | "EMPLOYEE" | "STOREKEEPER" | "ADMIN"; isActive?: boolean }[] = [
    { id: ids.betonHead, role: "BOSS" },
    { id: ids.mechHead, role: "BOSS" },
    { id: ids.mechHead2, role: "BOSS" },
    { id: ids.betonEmp, role: "EMPLOYEE" },
    { id: ids.mechEmp, role: "EMPLOYEE" },
    { id: ids.store, role: "STOREKEEPER" },
    { id: ids.clerk, role: "EMPLOYEE" },
    { id: ids.inactiveBoss, role: "BOSS", isActive: false },
    { id: ids.admin, role: "ADMIN" },
  ];
  const pinHash = await bcrypt.hash(PIN, 10);
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { role: u.role, isActive: u.isActive ?? true },
      create: { id: u.id, email: `${u.id}@test.local`, name: u.id, role: u.role, isActive: u.isActive ?? true, passwordHash: "unused" },
    });
  }
  for (const userId of [ids.betonHead, ids.mechHead, ids.mechHead2]) {
    await prisma.approvalPinCredential.upsert({
      where: { userId },
      update: { pinHash, failedAttempts: 0, lockedUntil: null },
      create: { userId, pinHash },
    });
  }
});

async function newDepartment(label: string, headId: string | null) {
  return prisma.department.create({ data: { name: `iso ${label} ${unique()}`, type: "FACTORY", headId } });
}

async function newRequest(
  departmentId: string,
  headId: string,
  opts: { requestedById?: string; status?: "PENDING_DEPARTMENT_APPROVAL" | "RETURNED_BY_DEPARTMENT" } = {}
) {
  const status = opts.status ?? "PENDING_DEPARTMENT_APPROVAL";
  const returned = status === "RETURNED_BY_DEPARTMENT";
  return prisma.materialRequest.create({
    data: {
      requestNumber: `ISO-${unique()}`,
      year: 9999,
      sequence: counter,
      departmentId,
      requestedById: opts.requestedById ?? ids.mechEmp,
      status,
      submittedAt: new Date(),
      items: { create: [{ lineNo: 1, unit: "ш", requestedQuantity: 1, unitPrice: 100, totalPrice: 100, manualMaterialName: "iso material" }] },
      approvalSteps: {
        create: [
          { type: "DEPARTMENT_HEAD", sequence: 1, status: returned ? "REJECTED" : "PENDING", assignedUserId: headId, decidedById: returned ? headId : null },
          { type: "WAREHOUSE_CHECK", sequence: 2, status: returned ? "SKIPPED" : "PENDING", assignedUserId: ids.store },
        ],
      },
    },
    include: { approvalSteps: true },
  });
}

const headStep = (requestId: string) =>
  prisma.approvalStep.findFirstOrThrow({ where: { requestId, type: "DEPARTMENT_HEAD" } });

describe("Stage 2 routing isolation", () => {
  it("the Beton head can neither approve nor return a Mechanic request; the Mechanic head can", async () => {
    const mechanic = await newDepartment("mechanic", ids.mechHead);
    const beton = await newDepartment("beton", ids.betonHead);
    const mechRequest = await newRequest(mechanic.id, ids.mechHead);
    const betonRequest = await newRequest(beton.id, ids.betonHead, { requestedById: ids.betonEmp });

    const approve = await departmentApprove(mechRequest.id, ids.betonHead, PIN, 1);
    const ret = await departmentReturn(mechRequest.id, ids.betonHead, "no", 1);
    expect(approve).toMatchObject({ ok: false, status: 403 });
    expect(ret).toMatchObject({ ok: false, status: 403 });
    expect((await headStep(mechRequest.id)).status).toBe("PENDING");

    const ok = await departmentApprove(mechRequest.id, ids.mechHead, PIN, 1);
    expect(ok.ok).toBe(true);
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: mechRequest.id } })).status).toBe("PENDING_WAREHOUSE_CHECK");

    // The Beton workflow is unaffected by anything above.
    const betonOk = await departmentApprove(betonRequest.id, ids.betonHead, PIN, 1);
    expect(betonOk.ok).toBe(true);
    const mechOnBeton = await departmentApprove(betonRequest.id, ids.mechHead, PIN, 2);
    expect(mechOnBeton).toMatchObject({ ok: false });
  });
});

describe("assignDepartmentHead validation", () => {
  it.each([
    ["a non-BOSS user", ids.clerk],
    ["an inactive BOSS", ids.inactiveBoss],
    ["a user that does not exist", "iso-no-such-user"],
  ])("rejects %s and leaves the head unchanged", async (_label, candidate) => {
    const dept = await newDepartment("validate", ids.mechHead);
    const result = await assignDepartmentHead(dept.id, candidate, ids.admin);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept.id } })).headId).toBe(ids.mechHead);
  });

  it("accepts an active BOSS and answers 404 for an unknown department", async () => {
    const dept = await newDepartment("accept", null);
    expect(await assignDepartmentHead(dept.id, ids.mechHead, ids.admin)).toMatchObject({ ok: true, headId: ids.mechHead, changed: true });
    expect(await assignDepartmentHead("iso-no-such-dept", ids.mechHead, ids.admin)).toMatchObject({ ok: false, status: 404 });
  });

  it("is a no-op (no audit entry) when the head does not change", async () => {
    const dept = await newDepartment("noop", ids.mechHead);
    const result = await assignDepartmentHead(dept.id, ids.mechHead, ids.admin);
    expect(result).toMatchObject({ ok: true, changed: false, reassignedRequests: 0 });
    expect(await prisma.auditLog.count({ where: { entityType: "Department", entityId: dept.id } })).toBe(0);
  });
});

describe("head reassignment with pending approvals", () => {
  it("re-points pending steps, notifies the new head and locks out the old one", async () => {
    const dept = await newDepartment("reassign", ids.mechHead);
    const pending = await newRequest(dept.id, ids.mechHead);

    const result = await assignDepartmentHead(dept.id, ids.mechHead2, ids.admin);
    expect(result).toMatchObject({ ok: true, reassignedRequests: 1 });

    expect((await headStep(pending.id)).assignedUserId).toBe(ids.mechHead2);
    expect(await prisma.notification.count({ where: { userId: ids.mechHead2, relatedRequestId: pending.id, type: "APPROVAL_REQUIRED" } })).toBe(1);

    expect(await departmentApprove(pending.id, ids.mechHead, PIN, 1)).toMatchObject({ ok: false, status: 403 });
    expect((await departmentApprove(pending.id, ids.mechHead2, PIN, 1)).ok).toBe(true);
  });

  it("writes a before/after audit record", async () => {
    const dept = await newDepartment("audit", ids.mechHead);
    await newRequest(dept.id, ids.mechHead);
    await assignDepartmentHead(dept.id, ids.mechHead2, ids.admin);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Department", entityId: dept.id } });
    expect(log.actorId).toBe(ids.admin);
    expect(JSON.parse(log.beforeJson!)).toEqual({ headId: ids.mechHead });
    expect(JSON.parse(log.afterJson!)).toEqual({ headId: ids.mechHead2, reassignedPendingRequests: 1 });
  });

  it("preserves already-decided approvals and their actions", async () => {
    const dept = await newDepartment("history", ids.mechHead);
    const decided = await newRequest(dept.id, ids.mechHead);
    expect((await departmentApprove(decided.id, ids.mechHead, PIN, 1)).ok).toBe(true);
    const before = await headStep(decided.id);
    const actionsBefore = await prisma.approvalAction.findMany({ where: { approvalStepId: before.id } });

    await assignDepartmentHead(dept.id, ids.mechHead2, ids.admin);

    const after = await headStep(decided.id);
    expect(after).toMatchObject({ status: "APPROVED", assignedUserId: ids.mechHead, decidedById: ids.mechHead });
    expect(await prisma.approvalAction.findMany({ where: { approvalStepId: before.id } })).toEqual(actionsBefore);
  });

  it("does not touch another department's pending requests", async () => {
    const mechanic = await newDepartment("mech", ids.mechHead);
    const beton = await newDepartment("beton", ids.betonHead);
    const betonRequest = await newRequest(beton.id, ids.betonHead, { requestedById: ids.betonEmp });
    await newRequest(mechanic.id, ids.mechHead);

    await assignDepartmentHead(mechanic.id, ids.mechHead2, ids.admin);

    expect((await headStep(betonRequest.id)).assignedUserId).toBe(ids.betonHead);
    expect((await departmentApprove(betonRequest.id, ids.betonHead, PIN, 1)).ok).toBe(true);
  });

  it("refuses to clear the head while requests are waiting on it, and allows it otherwise", async () => {
    const busy = await newDepartment("busy", ids.mechHead);
    await newRequest(busy.id, ids.mechHead);
    expect(await assignDepartmentHead(busy.id, null, ids.admin)).toMatchObject({ ok: false, status: 409 });
    expect((await prisma.department.findUniqueOrThrow({ where: { id: busy.id } })).headId).toBe(ids.mechHead);

    const idle = await newDepartment("idle", ids.mechHead);
    expect(await assignDepartmentHead(idle.id, null, ids.admin)).toMatchObject({ ok: true, headId: null });
  });

  it("sends a returned request to the current head when it is resubmitted", async () => {
    const dept = await newDepartment("returned", ids.mechHead);
    const returned = await newRequest(dept.id, ids.mechHead, { status: "RETURNED_BY_DEPARTMENT" });

    // Nothing is pending, so nothing is re-pointed yet...
    expect(await assignDepartmentHead(dept.id, ids.mechHead2, ids.admin)).toMatchObject({ ok: true, reassignedRequests: 0 });

    const resubmitted = await resubmitDepartmentReturn(returned.id, ids.mechEmp, 1, [
      { materialId: null, materialName: "iso material", unit: "ш", requestedQuantity: 2, unitPrice: 100 },
    ]);
    expect(resubmitted.ok).toBe(true);

    // ...but the reopened step and its notification go to the new head.
    expect((await headStep(returned.id)).assignedUserId).toBe(ids.mechHead2);
    expect(await prisma.notification.count({ where: { userId: ids.mechHead2, relatedRequestId: returned.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ids.mechHead, relatedRequestId: returned.id } })).toBe(0);
    expect(await departmentApprove(returned.id, ids.mechHead, PIN, 2)).toMatchObject({ ok: false, status: 403 });
  });
});
