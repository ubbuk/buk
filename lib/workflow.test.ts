import bcrypt from "bcrypt";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import {
  branchApprove,
  branchReturn,
  departmentApprove,
  departmentReturn,
  executiveApprove,
  financeApprove,
  managerPricingApprove,
  managerPricingReturn,
  managerUpdateItemPrice,
  recordAccountingEntry,
  resubmitDepartmentReturn,
  resubmitPositionStepReturn,
  warehouseCheck,
} from "./workflow";
import { completeProcurement, getProcurementDetail, recordPurchase } from "./procurement";

const DEPT_ID = "vitest-dept"; // FACTORY -> branch goes to ENGINEERING
const OFFICE_DEPT_ID = "vitest-office-dept"; // OFFICE -> branch goes to OPERATIONS_DIRECTOR (a DIRECTOR)
const HEAD_ID = "vitest-head";
const OFFICE_HEAD_ID = "vitest-office-head";
const WRONG_HEAD_ID = "vitest-wrong-head";
const EMPLOYEE_ID = "vitest-employee";
const WAREHOUSE_ID = "vitest-wh";
const MATERIAL_ID = "vitest-material";
const PIN = "1234";

// Reuse the real seeded position-holders (prisma/seed.ts) rather than
// vitest-only fixtures, matching the existing "no mocking" convention.
const STOREKEEPER_ID = "u-sarnai";
const ENGINEERING_CHIEF_ID = "u-narmandakh";
const OPERATIONS_DIRECTOR_ID = "u-khuntsengel";
const FINANCE_DIRECTOR_ID = "u-magomed";
const EXECUTIVE_DIRECTOR_ID = "u-ganbold";
const CHIEF_ACCOUNTANT_ID = "u-bayarmaa";
const MANAGER_ID = "u-tuvshin";

let requestCounter = 0;

beforeAll(async () => {
  await prisma.department.upsert({
    where: { id: DEPT_ID },
    update: {},
    create: { id: DEPT_ID, name: "Vitest тест цех", type: "FACTORY" },
  });
  await prisma.department.upsert({
    where: { id: OFFICE_DEPT_ID },
    update: {},
    create: { id: OFFICE_DEPT_ID, name: "Vitest оффис тасаг", type: "OFFICE" },
  });
  await prisma.user.upsert({
    where: { id: HEAD_ID },
    update: {},
    create: { id: HEAD_ID, email: "vitest-head@test.local", name: "Vitest Дарга", role: "BOSS", departmentId: DEPT_ID, passwordHash: "unused" },
  });
  await prisma.user.upsert({
    where: { id: OFFICE_HEAD_ID },
    update: {},
    create: { id: OFFICE_HEAD_ID, email: "vitest-office-head@test.local", name: "Vitest Оффис дарга", role: "BOSS", departmentId: OFFICE_DEPT_ID, passwordHash: "unused" },
  });
  await prisma.user.upsert({
    where: { id: WRONG_HEAD_ID },
    update: {},
    create: { id: WRONG_HEAD_ID, email: "vitest-wrong-head@test.local", name: "Vitest Буруу дарга", role: "BOSS", passwordHash: "unused" },
  });
  await prisma.user.upsert({
    where: { id: EMPLOYEE_ID },
    update: {},
    create: { id: EMPLOYEE_ID, email: "vitest-employee@test.local", name: "Vitest Ажилтан", role: "EMPLOYEE", departmentId: DEPT_ID, passwordHash: "unused" },
  });
  await prisma.department.update({ where: { id: DEPT_ID }, data: { headId: HEAD_ID } });
  await prisma.department.update({ where: { id: OFFICE_DEPT_ID }, data: { headId: OFFICE_HEAD_ID } });

  await prisma.warehouse.upsert({
    where: { id: WAREHOUSE_ID },
    update: {},
    create: { id: WAREHOUSE_ID, name: "Vitest агуулах" },
  });
  await prisma.material.upsert({
    where: { id: MATERIAL_ID },
    update: {},
    create: { id: MATERIAL_ID, code: "VITEST-MAT", name: "Тест материал", unit: "ш", defaultPrice: 1000 },
  });

  const pinHash = await bcrypt.hash(PIN, 10);
  for (const userId of [HEAD_ID, OFFICE_HEAD_ID, STOREKEEPER_ID, ENGINEERING_CHIEF_ID, OPERATIONS_DIRECTOR_ID, FINANCE_DIRECTOR_ID, EXECUTIVE_DIRECTOR_ID, MANAGER_ID]) {
    await prisma.approvalPinCredential.upsert({
      where: { userId },
      update: { pinHash, failedAttempts: 0, lockedUntil: null },
      create: { userId, pinHash },
    });
  }
});

// Stage 7: the Manager buys whatever the warehouse could not supply, then completes
// procurement. Returns the request version for the Chief Accountant's registration.
async function finishProcurement(requestId: string): Promise<number> {
  const detail = await getProcurementDetail(requestId);
  for (const item of detail!.items.filter((i) => i.remainingQuantity > 0)) {
    const bought = await recordPurchase(requestId, MANAGER_ID, { itemId: item.itemId, quantity: item.remainingQuantity, unitPrice: 1200 });
    if (!bought.ok) throw new Error(`setup failed: ${bought.error}`);
  }
  const done = await completeProcurement(requestId, MANAGER_ID);
  if (!done.ok) throw new Error(`setup failed: ${done.error}`);
  return (await prisma.materialRequest.findUniqueOrThrow({ where: { id: requestId } })).version;
}

async function setBalance(quantityOnHand: number) {
  await prisma.inventoryBalance.upsert({
    where: { materialId_warehouseId: { materialId: MATERIAL_ID, warehouseId: WAREHOUSE_ID } },
    update: { quantityOnHand, quantityReserved: 0 },
    create: { materialId: MATERIAL_ID, warehouseId: WAREHOUSE_ID, quantityOnHand },
  });
}

// branchAssigneeId lets a test exercise the OFFICE department (-> OPERATIONS_DIRECTOR) path.
async function createTestRequest(
  requestedQuantity: number,
  unitPrice: number | null = 1000,
  departmentId: string = DEPT_ID,
  branchAssigneeId: string = ENGINEERING_CHIEF_ID,
  withPricing = false // the Manager's price-review step exists only on requests created after it was introduced
) {
  requestCounter += 1;
  const requestNumber = `VITEST-${Date.now()}-${requestCounter}`;
  return prisma.materialRequest.create({
    data: {
      requestNumber,
      year: 9999,
      sequence: requestCounter,
      departmentId,
      requestedById: EMPLOYEE_ID,
      status: "PENDING_DEPARTMENT_APPROVAL",
      submittedAt: new Date(),
      items: {
        create: [
          {
            lineNo: 1,
            materialId: MATERIAL_ID,
            unit: "ш",
            requestedQuantity,
            unitPrice,
            totalPrice: unitPrice === null ? null : requestedQuantity * unitPrice,
          },
        ],
      },
      approvalSteps: {
        create: [
          { type: "DEPARTMENT_HEAD", sequence: 1, status: "PENDING", assignedUserId: departmentId === OFFICE_DEPT_ID ? OFFICE_HEAD_ID : HEAD_ID },
          { type: "WAREHOUSE_CHECK", sequence: 2, status: "PENDING", assignedUserId: STOREKEEPER_ID },
          { type: "BRANCH_APPROVAL", sequence: 3, status: "PENDING", assignedUserId: branchAssigneeId },
          ...(withPricing ? [{ type: "MANAGER_PRICING" as const, sequence: 4, status: "PENDING" as const, assignedUserId: null }] : []),
          { type: "FINANCE_APPROVAL", sequence: withPricing ? 5 : 4, status: "PENDING", assignedUserId: FINANCE_DIRECTOR_ID },
          { type: "EXECUTIVE_APPROVAL", sequence: withPricing ? 6 : 5, status: "PENDING", assignedUserId: EXECUTIVE_DIRECTOR_ID },
          { type: "ACCOUNTING_RECORD", sequence: withPricing ? 7 : 6, status: "PENDING", assignedUserId: CHIEF_ACCOUNTANT_ID },
        ],
      },
    },
    include: { items: true },
  });
}

describe("departmentApprove / departmentReturn (Stage 2 — Boss)", () => {
  it("rejects an actor who isn't the department's real head", async () => {
    const request = await createTestRequest(5);
    const result = await departmentApprove(request.id, WRONG_HEAD_ID, PIN, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("lets exactly one of two concurrent approvals win, the other gets 409", async () => {
    const request = await createTestRequest(5);
    const [a, b] = await Promise.all([
      departmentApprove(request.id, HEAD_ID, PIN, 1),
      departmentApprove(request.id, HEAD_ID, PIN, 1),
    ]);
    const statuses = [a, b].map((r) => (r.ok ? 200 : r.status)).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("rejects a stale expectedVersion even with a correct PIN", async () => {
    const request = await createTestRequest(5);
    const result = await departmentApprove(request.id, HEAD_ID, PIN, 999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);

    const stillPending = await prisma.approvalStep.findFirst({ where: { requestId: request.id, type: "DEPARTMENT_HEAD" } });
    expect(stillPending?.status).toBe("PENDING");
  });

  it("rejects a wrong PIN (401) and locks out after 5 wrong attempts (423)", async () => {
    const userId = "vitest-pin-lockout-user";
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: "vitest-pin-lockout@test.local", name: "Vitest PIN", role: "BOSS", passwordHash: "unused" },
    });
    await prisma.approvalPinCredential.upsert({
      where: { userId },
      update: { pinHash: await bcrypt.hash(PIN, 10), failedAttempts: 0, lockedUntil: null },
      create: { userId, pinHash: await bcrypt.hash(PIN, 10) },
    });
    const dept = await prisma.department.upsert({
      where: { id: "vitest-pin-lockout-dept" },
      update: { headId: userId },
      create: { id: "vitest-pin-lockout-dept", name: "Vitest PIN цех", type: "FACTORY", headId: userId },
    });

    for (let i = 0; i < 4; i++) {
      requestCounter += 1;
      const request = await prisma.materialRequest.create({
        data: {
          requestNumber: `VITEST-PIN-${Date.now()}-${requestCounter}`,
          year: 9999,
          sequence: requestCounter,
          departmentId: dept.id,
          requestedById: EMPLOYEE_ID,
          status: "PENDING_DEPARTMENT_APPROVAL",
          approvalSteps: { create: [{ type: "DEPARTMENT_HEAD", sequence: 1, status: "PENDING", assignedUserId: userId }] },
        },
      });
      const result = await departmentApprove(request.id, userId, "0000", 1);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(401);
    }

    requestCounter += 1;
    const fifthRequest = await prisma.materialRequest.create({
      data: {
        requestNumber: `VITEST-PIN-${Date.now()}-${requestCounter}`,
        year: 9999,
        sequence: requestCounter,
        departmentId: dept.id,
        requestedById: EMPLOYEE_ID,
        status: "PENDING_DEPARTMENT_APPROVAL",
        approvalSteps: { create: [{ type: "DEPARTMENT_HEAD", sequence: 1, status: "PENDING", assignedUserId: userId }] },
      },
    });
    const lockoutResult = await departmentApprove(fifthRequest.id, userId, "0000", 1);
    expect(lockoutResult.ok).toBe(false);
    if (!lockoutResult.ok) expect(lockoutResult.status).toBe(423);

    // Locked out even with the *correct* PIN now.
    const stillLocked = await departmentApprove(fifthRequest.id, userId, PIN, 1);
    expect(stillLocked.ok).toBe(false);
    if (!stillLocked.ok) expect(stillLocked.status).toBe(423);
  });

  it("department-return skips every downstream step and notifies the requester", async () => {
    const request = await createTestRequest(5);
    const result = await departmentReturn(request.id, HEAD_ID, "Тоо хэмжээг тодруулна уу", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.status).toBe("RETURNED_BY_DEPARTMENT");
    const skipped = result.request.approvalSteps.filter((s) => s.status === "SKIPPED");
    expect(skipped.length).toBe(5);
  });
});

describe("warehouseCheck (Stage 3 — Storekeeper)", () => {
  it("rejects an actor who isn't the assigned storekeeper", async () => {
    const request = await createTestRequest(5);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const result = await warehouseCheck(request.id, EMPLOYEE_ID, [{ requestItemId: request.items[0].id, availableQuantity: 5 }], PIN, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("A. completes the request immediately when stock fully covers it (skips Branch/Finance/Executive/Accounting)", async () => {
    await setBalance(50);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const result = await warehouseCheck(
      request.id,
      STOREKEEPER_ID,
      [{ requestItemId: request.items[0].id, availableQuantity: 50 }],
      PIN,
      2
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.status).toBe("COMPLETED");
    expect(result.request.items[0].allocatedQuantity).toBe(10);
    expect(result.request.items[0].missingQuantity).toBe(0);
    const remainingSteps = result.request.approvalSteps.filter((s) =>
      ["BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL", "ACCOUNTING_RECORD"].includes(s.type)
    );
    expect(remainingSteps.every((s) => s.status === "SKIPPED")).toBe(true);
  });

  it("C. allocates the available portion and carries the shortfall to Branch approval", async () => {
    await setBalance(3);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const result = await warehouseCheck(
      request.id,
      STOREKEEPER_ID,
      [{ requestItemId: request.items[0].id, availableQuantity: 3 }],
      PIN,
      2
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.status).toBe("PENDING_BRANCH_APPROVAL");
    expect(result.request.items[0].allocatedQuantity).toBe(3);
    expect(result.request.items[0].missingQuantity).toBe(7);
  });

  it("B. marks fully unavailable (0) and still carries the full quantity forward", async () => {
    await setBalance(0);
    const request = await createTestRequest(5);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const result = await warehouseCheck(
      request.id,
      STOREKEEPER_ID,
      [{ requestItemId: request.items[0].id, availableQuantity: 0 }],
      PIN,
      2
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.status).toBe("PENDING_BRANCH_APPROVAL");
    expect(result.request.items[0].allocatedQuantity).toBe(0);
    expect(result.request.items[0].missingQuantity).toBe(5);
  });
});

describe("Stage 4 branch routing (Engineering for FACTORY, Operations Director for OFFICE)", () => {
  it("a FACTORY department's shortfall is assigned to the Engineering chief, who can approve it", async () => {
    await setBalance(2);
    const request = await createTestRequest(10, 1000, DEPT_ID, ENGINEERING_CHIEF_ID);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");
    expect(checked.request.approvalSteps.find((s) => s.type === "BRANCH_APPROVAL")?.assignedUserName).toBe("Б.Нармандах");

    const approved = await branchApprove(request.id, ENGINEERING_CHIEF_ID, PIN, checked.request.version);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.request.status).toBe("PENDING_FINANCE_APPROVAL");
  });

  it("an OFFICE department's shortfall is assigned to the Operations Director, who can approve it", async () => {
    await setBalance(2);
    const request = await createTestRequest(10, 1000, OFFICE_DEPT_ID, OPERATIONS_DIRECTOR_ID);
    await departmentApprove(request.id, OFFICE_HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");
    expect(checked.request.approvalSteps.find((s) => s.type === "BRANCH_APPROVAL")?.assignedUserName).toBe("Н.Хүнцэнгэл");

    const approved = await branchApprove(request.id, OPERATIONS_DIRECTOR_ID, PIN, checked.request.version);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.request.status).toBe("PENDING_FINANCE_APPROVAL");
  });

  it("the Engineering chief cannot approve an OFFICE request's branch step (wrong assignee)", async () => {
    await setBalance(2);
    const request = await createTestRequest(10, 1000, OFFICE_DEPT_ID, OPERATIONS_DIRECTOR_ID);
    await departmentApprove(request.id, OFFICE_HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");

    const result = await branchApprove(request.id, ENGINEERING_CHIEF_ID, PIN, checked.request.version);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("Stage 5-7: Finance -> Executive -> Chief Accountant", () => {
  async function runToPendingFinance() {
    await setBalance(2);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");
    const branched = await branchApprove(request.id, ENGINEERING_CHIEF_ID, PIN, checked.request.version);
    if (!branched.ok) throw new Error("setup failed");
    return { requestId: request.id, version: branched.request.version };
  }

  it("Finance Director approves -> Executive Director approves -> Chief Accountant records (no PIN) -> ACCOUNTING_COMPLETED", async () => {
    const { requestId, version } = await runToPendingFinance();

    const financed = await financeApprove(requestId, FINANCE_DIRECTOR_ID, PIN, version);
    expect(financed.ok).toBe(true);
    if (!financed.ok) return;
    expect(financed.request.status).toBe("PENDING_EXECUTIVE_APPROVAL");

    const executed = await executiveApprove(requestId, EXECUTIVE_DIRECTOR_ID, PIN, financed.request.version);
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    // CEO approval hands over to the Manager's procurement stage, not to accounting.
    expect(executed.request.status).toBe("PENDING_PROCUREMENT");
    const blocked = await recordAccountingEntry(requestId, CHIEF_ACCOUNTANT_ID, { ledgerNumber: "TOO-EARLY", recordDate: new Date() }, executed.request.version);
    expect(blocked).toMatchObject({ ok: false, status: 409 });

    const accountingVersion = await finishProcurement(requestId);
    const recorded = await recordAccountingEntry(
      requestId,
      CHIEF_ACCOUNTANT_ID,
      { ledgerNumber: "LEDGER-001", recordDate: new Date("2026-11-02") },
      accountingVersion
    );
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.request.status).toBe("ACCOUNTING_COMPLETED");
    expect(recorded.request.accountingRecord?.ledgerNumber).toBe("LEDGER-001");
  });

  it("MANAGER/CHIEF_ACCOUNTANT never need a PIN to record -- a bogus/omitted PIN still succeeds", async () => {
    const { requestId, version } = await runToPendingFinance();
    const financed = await financeApprove(requestId, FINANCE_DIRECTOR_ID, PIN, version);
    if (!financed.ok) throw new Error("setup failed");
    const executed = await executiveApprove(requestId, EXECUTIVE_DIRECTOR_ID, PIN, financed.request.version);
    if (!executed.ok) throw new Error("setup failed");

    const accountingVersion = await finishProcurement(requestId);

    // recordAccountingEntry's signature takes no pin parameter at all --
    // this call's success (vs. a 401 PIN error) is itself the assertion.
    const recorded = await recordAccountingEntry(
      requestId,
      CHIEF_ACCOUNTANT_ID,
      { ledgerNumber: "LEDGER-002", recordDate: new Date() },
      accountingVersion
    );
    expect(recorded.ok).toBe(true);
  });

  it("wrong actor cannot record the accounting entry", async () => {
    const { requestId, version } = await runToPendingFinance();
    const financed = await financeApprove(requestId, FINANCE_DIRECTOR_ID, PIN, version);
    if (!financed.ok) throw new Error("setup failed");
    const executed = await executiveApprove(requestId, EXECUTIVE_DIRECTOR_ID, PIN, financed.request.version);
    if (!executed.ok) throw new Error("setup failed");

    const accountingVersion = await finishProcurement(requestId);
    const result = await recordAccountingEntry(requestId, EMPLOYEE_ID, { ledgerNumber: "X", recordDate: new Date() }, accountingVersion);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("stage-skip prevention (test #14)", () => {
  it("financeApprove is rejected on a request still waiting at an earlier stage", async () => {
    const request = await createTestRequest(5);
    // Request is still PENDING_DEPARTMENT_APPROVAL -- nothing has advanced
    // it to PENDING_FINANCE_APPROVAL yet, even though the FINANCE_APPROVAL
    // step row itself was created PENDING like every other step.
    const result = await financeApprove(request.id, FINANCE_DIRECTOR_ID, PIN, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("executiveApprove is rejected before Branch/Finance have run", async () => {
    await setBalance(2);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");
    // Still PENDING_BRANCH_APPROVAL at this point.
    const result = await executiveApprove(request.id, EXECUTIVE_DIRECTOR_ID, PIN, checked.request.version);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("recordAccountingEntry is rejected before Executive has approved", async () => {
    const request = await createTestRequest(5);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const result = await recordAccountingEntry(request.id, CHIEF_ACCOUNTANT_ID, { ledgerNumber: "X", recordDate: new Date() }, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});

describe("double-approval prevention (test #15)", () => {
  it("branchApprove cannot be applied twice to the same request", async () => {
    await setBalance(2);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");

    const [a, b] = await Promise.all([
      branchApprove(request.id, ENGINEERING_CHIEF_ID, PIN, checked.request.version),
      branchApprove(request.id, ENGINEERING_CHIEF_ID, PIN, checked.request.version),
    ]);
    const statuses = [a, b].map((r) => (r.ok ? 200 : r.status)).sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe("resubmission", () => {
  it("department-return -> resubmit with edited items -> re-approve, preserving the original rejection in history", async () => {
    const request = await createTestRequest(5);
    const returned = await departmentReturn(request.id, HEAD_ID, "Тоо хэмжээг тодруулна уу", 1);
    expect(returned.ok).toBe(true);
    if (!returned.ok) return;
    expect(returned.request.status).toBe("RETURNED_BY_DEPARTMENT");

    const resubmitted = await resubmitDepartmentReturn(request.id, EMPLOYEE_ID, returned.request.version, [
      { materialId: MATERIAL_ID, materialName: "Тест материал", unit: "ш", requestedQuantity: 2, unitPrice: 1000 },
    ]);
    expect(resubmitted.ok).toBe(true);
    if (!resubmitted.ok) return;
    expect(resubmitted.request.status).toBe("PENDING_DEPARTMENT_APPROVAL");
    expect(resubmitted.request.items).toHaveLength(1);
    expect(resubmitted.request.items[0].requestedQuantity).toBe(2);

    const reapproved = await departmentApprove(request.id, HEAD_ID, PIN, resubmitted.request.version);
    expect(reapproved.ok).toBe(true);
    if (!reapproved.ok) return;
    expect(reapproved.request.status).toBe("PENDING_WAREHOUSE_CHECK");

    const history = await prisma.approvalAction.findMany({
      where: { approvalStep: { requestId: request.id, type: "DEPARTMENT_HEAD" } },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => h.action)).toEqual(["RETURN", "APPROVE"]);
    expect(history[0].reason).toBe("Тоо хэмжээг тодруулна уу");
  });

  it("someone who isn't the requester cannot resubmit", async () => {
    const request = await createTestRequest(5);
    const returned = await departmentReturn(request.id, HEAD_ID, "шалтгаан", 1);
    if (!returned.ok) throw new Error("setup failed");
    const result = await resubmitDepartmentReturn(request.id, WRONG_HEAD_ID, returned.request.version, [
      { materialId: MATERIAL_ID, materialName: "Тест материал", unit: "ш", requestedQuantity: 1, unitPrice: 1000 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("branch-return -> cancel the remaining shortfall on resubmit -> request completes immediately", async () => {
    await setBalance(2);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");
    expect(checked.request.status).toBe("PENDING_BRANCH_APPROVAL");

    const returned = await branchReturn(request.id, ENGINEERING_CHIEF_ID, "Одоогоор хэрэгцээ алга", checked.request.version);
    if (!returned.ok) throw new Error("setup failed");
    expect(returned.request.status).toBe("RETURNED_BY_BRANCH_APPROVER");
    expect(returned.request.items[0].missingQuantity).toBe(8);

    const resubmitted = await resubmitPositionStepReturn(request.id, EMPLOYEE_ID, returned.request.version, [
      { requestItemId: returned.request.items[0].id, quantity: 0 },
    ]);
    expect(resubmitted.ok).toBe(true);
    if (!resubmitted.ok) return;
    expect(resubmitted.request.status).toBe("COMPLETED");
  });

  it("branch-return -> reopen the shortfall with an adjusted (lower) quantity -> continues through the full chain", async () => {
    await setBalance(2);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");

    const returned = await branchReturn(request.id, ENGINEERING_CHIEF_ID, "Тоо хэмжээг багасга", checked.request.version);
    if (!returned.ok) throw new Error("setup failed");

    const resubmitted = await resubmitPositionStepReturn(request.id, EMPLOYEE_ID, returned.request.version, [
      { requestItemId: returned.request.items[0].id, quantity: 4 },
    ]);
    expect(resubmitted.ok).toBe(true);
    if (!resubmitted.ok) return;
    expect(resubmitted.request.status).toBe("PENDING_BRANCH_APPROVAL");
    expect(resubmitted.request.items[0].missingQuantity).toBe(4);

    const reapproved = await branchApprove(request.id, ENGINEERING_CHIEF_ID, PIN, resubmitted.request.version);
    expect(reapproved.ok).toBe(true);
    if (!reapproved.ok) return;
    expect(reapproved.request.status).toBe("PENDING_FINANCE_APPROVAL");
  });

  it("rejects an adjustment above the still-missing quantity", async () => {
    await setBalance(2);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");
    const returned = await branchReturn(request.id, ENGINEERING_CHIEF_ID, "шалтгаан", checked.request.version);
    if (!returned.ok) throw new Error("setup failed");

    const result = await resubmitPositionStepReturn(request.id, EMPLOYEE_ID, returned.request.version, [
      { requestItemId: returned.request.items[0].id, quantity: 999 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("managerUpdateItemPrice", () => {
  it("updates the item's unit/total price and bumps the request version", async () => {
    const request = await createTestRequest(5);
    const result = await managerUpdateItemPrice(request.id, request.items[0].id, EMPLOYEE_ID, 2500, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.items[0].unitPrice).toBe(2500);
    expect(result.request.items[0].totalPrice).toBe(12500);
    expect(result.request.version).toBe(2);
  });

  it("rejects a stale expectedVersion", async () => {
    const request = await createTestRequest(5);
    const result = await managerUpdateItemPrice(request.id, request.items[0].id, EMPLOYEE_ID, 2500, 999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects a price change on a completed request", async () => {
    await setBalance(50);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 50 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");
    expect(checked.request.status).toBe("COMPLETED");

    const result = await managerUpdateItemPrice(request.id, request.items[0].id, EMPLOYEE_ID, 999, checked.request.version);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});

describe("optional unitPrice", () => {
  it("stores an item with no price as unitPrice/totalPrice null (distinct from 0)", async () => {
    const request = await createTestRequest(5, null);
    expect(request.items[0].unitPrice).toBeNull();
    expect(request.items[0].totalPrice).toBeNull();
  });

  it("a request with no price still progresses through departmentApprove", async () => {
    const request = await createTestRequest(5, null);
    const result = await departmentApprove(request.id, HEAD_ID, PIN, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.status).toBe("PENDING_WAREHOUSE_CHECK");
    expect(result.request.items[0].unitPrice).toBeNull();
    expect(result.request.totalAmount).toBeNull();
  });

  it("MANAGER can fill in a price later for an item that had none ('нөхөж оруулах')", async () => {
    const request = await createTestRequest(5, null);
    const result = await managerUpdateItemPrice(request.id, request.items[0].id, EMPLOYEE_ID, 1200, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.items[0].unitPrice).toBe(1200);
    expect(result.request.items[0].totalPrice).toBe(6000);
    expect(result.request.totalAmount).toBe(6000);
  });
});

describe("audit log", () => {
  it("records an ACCOUNTING_RECORD audit entry when the Chief Accountant records a request", async () => {
    await setBalance(2);
    const request = await createTestRequest(10);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");
    const branched = await branchApprove(request.id, ENGINEERING_CHIEF_ID, PIN, checked.request.version);
    if (!branched.ok) throw new Error("setup failed");
    const financed = await financeApprove(request.id, FINANCE_DIRECTOR_ID, PIN, branched.request.version);
    if (!financed.ok) throw new Error("setup failed");
    const executed = await executiveApprove(request.id, EXECUTIVE_DIRECTOR_ID, PIN, financed.request.version);
    if (!executed.ok) throw new Error("setup failed");
    const accountingVersion = await finishProcurement(request.id);
    await recordAccountingEntry(request.id, CHIEF_ACCOUNTANT_ID, { ledgerNumber: "LEDGER-AUDIT", recordDate: new Date() }, accountingVersion);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "MaterialRequest", entityId: request.id, action: "ACCOUNTING_RECORD" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(CHIEF_ACCOUNTANT_ID);
  });
});

describe("managerPricingApprove / managerPricingReturn (price review between branch and finance)", () => {
  // 10 requested, 2 in stock -> 8 still to buy; the request then waits at the Manager's price review.
  async function atPricing(unitPrice: number | null) {
    await setBalance(2);
    const request = await createTestRequest(10, unitPrice, DEPT_ID, ENGINEERING_CHIEF_ID, true);
    await departmentApprove(request.id, HEAD_ID, PIN, 1);
    const checked = await warehouseCheck(request.id, STOREKEEPER_ID, [{ requestItemId: request.items[0].id, availableQuantity: 2 }], PIN, 2);
    if (!checked.ok) throw new Error("setup failed");
    const branched = await branchApprove(request.id, ENGINEERING_CHIEF_ID, PIN, checked.request.version);
    if (!branched.ok) throw new Error("setup failed");
    return { request, version: branched.request.version };
  }

  it("the branch approval hands the request to the Manager, not to finance, and tells the managers", async () => {
    const { request, version } = await atPricing(1000);
    const row = await prisma.materialRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe("PENDING_MANAGER_PRICING");
    expect(await prisma.notification.count({ where: { userId: MANAGER_ID, relatedRequestId: request.id } })).toBe(1);

    // finance cannot jump the queue while the price review is open
    const early = await financeApprove(request.id, FINANCE_DIRECTOR_ID, PIN, version);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.status).toBe(409);
  });

  it("refuses the approval while something still to buy has no price, then lets it through once priced", async () => {
    const { request, version } = await atPricing(null);
    const refused = await managerPricingApprove(request.id, MANAGER_ID, PIN, version);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.status).toBe(400);

    const priced = await managerUpdateItemPrice(request.id, request.items[0].id, MANAGER_ID, 1500, version);
    if (!priced.ok) throw new Error("setup failed");
    const approved = await managerPricingApprove(request.id, MANAGER_ID, PIN, priced.request.version);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.request.status).toBe("PENDING_FINANCE_APPROVAL");
    expect(approved.request.approvalSteps.find((s) => s.type === "MANAGER_PRICING")?.status).toBe("APPROVED");

    const finance = await financeApprove(request.id, FINANCE_DIRECTOR_ID, PIN, approved.request.version);
    expect(finance.ok).toBe(true);
  });

  it("only an active MANAGER can decide the review", async () => {
    const { request, version } = await atPricing(1000);
    const byFinance = await managerPricingApprove(request.id, FINANCE_DIRECTOR_ID, PIN, version);
    expect(byFinance.ok).toBe(false);
    if (!byFinance.ok) expect(byFinance.status).toBe(403);
    const returnedByEmployee = await managerPricingReturn(request.id, EMPLOYEE_ID, "x", version);
    expect(returnedByEmployee.ok).toBe(false);
    if (!returnedByEmployee.ok) expect(returnedByEmployee.status).toBe(403);
  });

  it("a stale version is refused", async () => {
    const { request } = await atPricing(1000);
    const stale = await managerPricingApprove(request.id, MANAGER_ID, PIN, 999);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);
  });

  it("return -> the requester lowers the shortfall -> the review reopens and the whole chain runs again", async () => {
    const { request, version } = await atPricing(1000);
    const returned = await managerPricingReturn(request.id, MANAGER_ID, "Тоо хэмжээг багасга", version);
    if (!returned.ok) throw new Error("setup failed");
    expect(returned.request.status).toBe("RETURNED_BY_MANAGER_PRICING");
    const skipped = returned.request.approvalSteps.filter((s) => s.status === "SKIPPED").map((s) => s.type);
    expect(skipped).toEqual(["FINANCE_APPROVAL", "EXECUTIVE_APPROVAL", "ACCOUNTING_RECORD"]);

    const resubmitted = await resubmitPositionStepReturn(request.id, EMPLOYEE_ID, returned.request.version, [
      { requestItemId: returned.request.items[0].id, quantity: 4 },
    ]);
    if (!resubmitted.ok) throw new Error("resubmit failed");
    expect(resubmitted.request.status).toBe("PENDING_MANAGER_PRICING");
    expect(resubmitted.request.approvalSteps.filter((s) => s.status === "SKIPPED")).toHaveLength(0);

    const approved = await managerPricingApprove(request.id, MANAGER_ID, PIN, resubmitted.request.version);
    if (!approved.ok) throw new Error("approve failed");
    const finance = await financeApprove(request.id, FINANCE_DIRECTOR_ID, PIN, approved.request.version);
    expect(finance.ok).toBe(true);
    if (!finance.ok) return;
    const executive = await executiveApprove(request.id, EXECUTIVE_DIRECTOR_ID, PIN, finance.request.version);
    expect(executive.ok).toBe(true);
  });
});
