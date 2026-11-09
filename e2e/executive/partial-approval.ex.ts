import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Executive partial approval, end to end in a real browser: the executive approves
// 50 of 100 with a PIN, the procurement officer is capped at 50 and asks for 30
// more (without gaining any approval control), the executive approves it.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

const TAG = Date.now().toString(36);
const P = "exui-";
const PASSWORD = "Passw0rd-test";
const PIN = "1234";
const ids = {
  dept: `${P}dept-${TAG}`, emp: `${P}emp`, head: `${P}head`, store: `${P}store`, exec: `${P}exec`, mgr: `${P}mgr`, mgrIntl: `${P}mgr-intl`, mat: `${P}mat-${TAG}`,
  admin: `${P}admin`, execOld: `${P}exec-old`, execNew: `${P}exec-new`,
};
const PIN_NEW = "5678";
let parked: string[] = [];
let parkedExecutive: string[] = [];
let handoverRequestId = "";
const MATERIAL = `UIX${TAG} Цемент`;
const email = (id: string) => `${id}@test.local`;
let requestId = "";
let itemId = "";

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const pinHash = await bcrypt.hash(PIN, 10);
  await db.department.upsert({ where: { id: ids.dept }, update: {}, create: { id: ids.dept, name: `UIX${TAG} Dept`, type: "FACTORY" } });
  const users: [string, "EMPLOYEE" | "BOSS" | "STOREKEEPER" | "DIRECTOR" | "MANAGER" | "ADMIN"][] = [
    [ids.emp, "EMPLOYEE"], [ids.head, "BOSS"], [ids.store, "STOREKEEPER"], [ids.exec, "DIRECTOR"], [ids.mgr, "MANAGER"], [ids.mgrIntl, "MANAGER"],
    [ids.admin, "ADMIN"], [ids.execOld, "DIRECTOR"], [ids.execNew, "DIRECTOR"],
  ];
  for (const [id, role] of users) {
    await db.user.upsert({
      where: { id },
      update: { role, isActive: true, passwordHash },
      create: { id, email: email(id), name: id, role, passwordHash, departmentId: id === ids.emp || id === ids.head ? ids.dept : null },
    });
  }
  await db.approvalPinCredential.upsert({ where: { userId: ids.exec }, update: { pinHash, failedAttempts: 0, lockedUntil: null }, create: { userId: ids.exec, pinHash } });
  const pinHashNew = await bcrypt.hash(PIN_NEW, 10);
  await db.approvalPinCredential.upsert({ where: { userId: ids.execNew }, update: { pinHash: pinHashNew, failedAttempts: 0, lockedUntil: null }, create: { userId: ids.execNew, pinHash: pinHashNew } });
  // ASSIGNED mode (Domestic = mgr, International = mgrIntl) and an EXECUTIVE_DIRECTOR holder; the global position rows that exist are parked and restored.
  const existing = await db.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER", "EXECUTIVE_DIRECTOR"] }, userId: { not: { startsWith: P } } } });
  parked = existing.filter((e) => e.role !== "EXECUTIVE_DIRECTOR").map((e) => e.id);
  parkedExecutive = existing.filter((e) => e.role === "EXECUTIVE_DIRECTOR").map((e) => e.id);
  await db.approvalRoleAssignment.updateMany({ where: { id: { in: [...parked, ...parkedExecutive] } }, data: { isActive: false } });
  await db.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await db.approvalRoleAssignment.createMany({
    data: [
      { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: ids.mgr, isActive: true },
      { role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: ids.mgrIntl, isActive: true },
      { role: "EXECUTIVE_DIRECTOR", userId: ids.execNew, isActive: true },
    ],
  });
  await db.department.update({ where: { id: ids.dept }, data: { headId: ids.head } });
  await db.material.upsert({ where: { id: ids.mat }, update: {}, create: { id: ids.mat, code: `UIX-${TAG}`, name: MATERIAL, unit: "ш", defaultPrice: 1000 } });

  const types = ["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL", "MANAGER_PROCUREMENT", "ACCOUNTING_RECORD"] as const;
  const created = await db.materialRequest.create({
    data: {
      requestNumber: `UIX-${TAG}`,
      year: 9997,
      sequence: 1,
      departmentId: ids.dept,
      requestedById: ids.emp,
      status: "PENDING_EXECUTIVE_APPROVAL",
      submittedAt: new Date(),
      items: { create: [{ lineNo: 1, materialId: ids.mat, manualMaterialName: MATERIAL, unit: "ш", requestedQuantity: 100, unitPrice: 1000, totalPrice: 100000 }] },
      approvalSteps: {
        create: types.map((type, i) => ({
          type,
          sequence: i + 1,
          status: i < 4 ? ("APPROVED" as const) : ("PENDING" as const),
          assignedUserId: type === "EXECUTIVE_APPROVAL" ? ids.exec : type === "DEPARTMENT_HEAD" ? ids.head : type === "WAREHOUSE_CHECK" ? ids.store : null,
          decidedById: i < 4 ? ids.store : null,
          decidedAt: i < 4 ? new Date() : null,
        })),
      },
    },
    include: { items: true },
  });
  requestId = created.id;
  itemId = created.items[0].id;
  await db.warehouseCheck.create({
    data: { requestId, checkedById: ids.store, items: { create: [{ requestItemId: itemId, availableQuantity: 0, allocatedQuantity: 0, missingQuantity: 100 }] } },
  });
  // classified, and the item belongs to the Domestic manager
  await db.procurementClassification.create({ data: { requestId, confirmedById: ids.mgrIntl } });
  await db.procurementItemAssignment.create({ data: { requestItemId: itemId, kind: "DOMESTIC", assignedManagerId: ids.mgr } });

  // a second request still waiting for the executive who is being replaced (handover test)
  const other = await db.materialRequest.create({
    data: {
      requestNumber: `UIX-${TAG}-H`,
      year: 9997,
      sequence: 2,
      departmentId: ids.dept,
      requestedById: ids.emp,
      status: "PENDING_EXECUTIVE_APPROVAL",
      submittedAt: new Date(),
      items: { create: [{ lineNo: 1, materialId: ids.mat, manualMaterialName: MATERIAL, unit: "ш", requestedQuantity: 10, unitPrice: 1000, totalPrice: 10000 }] },
      approvalSteps: {
        create: types.map((type, i) => ({
          type,
          sequence: i + 1,
          status: i < 4 ? ("APPROVED" as const) : ("PENDING" as const),
          assignedUserId: type === "EXECUTIVE_APPROVAL" ? ids.execOld : type === "DEPARTMENT_HEAD" ? ids.head : type === "WAREHOUSE_CHECK" ? ids.store : null,
          decidedById: i < 4 ? ids.store : null,
          decidedAt: i < 4 ? new Date() : null,
        })),
      },
    },
    include: { items: true },
  });
  handoverRequestId = other.id;
  await db.warehouseCheck.create({
    data: { requestId: handoverRequestId, checkedById: ids.store, items: { create: [{ requestItemId: other.items[0].id, availableQuantity: 0, allocatedQuantity: 0, missingQuantity: 10 }] } },
  });
});

test.afterAll(async () => {
  await db.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalDecision" DISABLE TRIGGER USER`);
  await db.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalAllocation" DISABLE TRIGGER USER`);
  try {
    await db.executiveApprovalAllocation.deleteMany({ where: { requestItem: { requestId: { in: [requestId, handoverRequestId] } } } });
    await db.executiveApprovalDecision.deleteMany({ where: { requestId: { in: [requestId, handoverRequestId] } } });
  } finally {
    await db.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalDecision" ENABLE TRIGGER USER`);
    await db.$executeRawUnsafe(`ALTER TABLE "ExecutiveApprovalAllocation" ENABLE TRIGGER USER`);
  }
  const both = { in: [requestId, handoverRequestId] };
  await db.deferredApprovalRequestItem.deleteMany({ where: { deferredRequest: { requestId: both } } });
  await db.deferredApprovalRequest.deleteMany({ where: { requestId: both } });
  await db.procurementPurchase.deleteMany({ where: { requestItem: { requestId: both } } });
  await db.warehouseCheck.deleteMany({ where: { requestId: both } });
  await db.approvalAction.deleteMany({ where: { approvalStep: { requestId: both } } });
  await db.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await db.materialRequest.deleteMany({ where: { id: both } });
  await db.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await db.approvalRoleAssignment.updateMany({ where: { id: { in: [...parked, ...parkedExecutive] } }, data: { isActive: true, endedAt: null } });
  await db.$disconnect();
});

async function login(page: Page, id: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email(id));
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
  await page.waitForURL(/\/dashboard/);
}

async function as(browser: Browser, id: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await login(page, id);
  return { context, page };
}

const progress = (page: Page) => page.getByRole("progressbar", { name: "Батлагдсан хувь" });
async function enterPin(page: Page) {
  await page.getByPlaceholder("····").fill(PIN);
  await page.getByRole("button", { name: "Баталгаажуулах", exact: true }).click();
}
async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe.serial("executive partial approval", () => {
  test("executive approves 50 of 100 with the PIN; 50 stays deferred", async ({ browser }) => {
    const { context, page } = await as(browser, ids.exec);
    await page.goto(`/requests/${requestId}`);
    await page.getByRole("button", { name: "Хэсэгчлэн батлах" }).click();
    await page.getByLabel(new RegExp(MATERIAL)).fill("50");
    await page.getByLabel("Тайлбар (заавал биш)").fill("Эхний хэсгийг одоо авна");
    await page.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
    // a wrong PIN is refused and nothing is recorded
    await page.getByPlaceholder("····").fill("0000");
    await page.getByRole("button", { name: "Баталгаажуулах", exact: true }).click();
    await expect(page.getByText("PIN буруу байна")).toBeVisible();
    expect(await db.executiveApprovalDecision.count({ where: { requestId } })).toBe(0);
    await enterPin(page);
    await expect(progress(page)).toHaveAttribute("aria-valuenow", "50");
    await expect(page.getByText("Хэсэгчлэн батлагдсан").first()).toBeVisible();
    const decision = await db.executiveApprovalDecision.findFirstOrThrow({ where: { requestId }, include: { allocations: true } });
    expect(decision.kind).toBe("INITIAL_PARTIAL");
    expect(Number(decision.allocations[0].quantity)).toBe(50);
    expect(Number((await db.materialRequestItem.findUniqueOrThrow({ where: { id: itemId } })).requestedQuantity)).toBe(100);
    await noHorizontalScroll(page);
    await context.close();
  });

  test("procurement officer is capped at 50 and can only ask for more", async ({ browser }) => {
    const { context, page } = await as(browser, ids.mgr);
    await page.goto(`/procurement/${requestId}`);
    await expect(page.getByText("Захирлын баталсан").first()).toBeVisible();
    // the executive's controls are not offered to the officer
    await expect(page.getByRole("button", { name: "Нэмэлт тоо хэмжээ батлах" })).toHaveCount(0);
    // buying above the approved quantity is refused by the server
    await page.getByLabel(/Авсан тоо/).fill("51");
    await page.getByLabel(/Бодит нэгж үнэ/).fill("1000");
    await page.getByRole("button", { name: "Бүртгэх" }).click();
    await expect(page.getByText(/баталсан үлдэгдэл 50/)).toBeVisible();
    expect(await db.procurementPurchase.count({ where: { requestItemId: itemId } })).toBe(0);
    // within the limit works
    await page.getByLabel(/Авсан тоо/).fill("30");
    await page.getByRole("button", { name: "Бүртгэх" }).click();
    await expect(page.getByText("Худалдан авалт бүртгэгдлээ")).toBeVisible();
    // ask the executive for 30 more
    await page.getByRole("button", { name: "Нэмэлт зөвшөөрөл хүсэх" }).click();
    await page.getByPlaceholder("0 – 50").fill("30");
    await page.getByLabel(/Шалтгаан, тайлбар/).fill("Нийлүүлэгч бэлэн болсон");
    await page.getByRole("button", { name: "Илгээх" }).click();
    await expect(page.getByText("Нэмэлт зөвшөөрлийн хүсэлт", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Нэмэлт зөвшөөрөл хүсэх" })).toHaveCount(0); // one pending at a time
    await expect(page.getByRole("button", { name: "Батлах", exact: true })).toHaveCount(0);
    expect(await db.deferredApprovalRequest.count({ where: { requestId, status: "PENDING" } })).toBe(1);
    expect(Number((await db.executiveApprovalAllocation.aggregate({ where: { requestItemId: itemId }, _sum: { quantity: true } }))._sum.quantity)).toBe(50);
    await noHorizontalScroll(page);
    await context.close();
  });

  test("executive approves the officer's request with the PIN: 80 approved, 20 deferred", async ({ browser }) => {
    const { context, page } = await as(browser, ids.exec);
    await page.goto(`/requests/${requestId}`);
    await expect(page.getByText("Нийлүүлэгч бэлэн болсон").first()).toBeVisible();
    await page.getByRole("button", { name: "Батлах", exact: true }).click();
    await expect(page.getByPlaceholder("0 – 30")).toHaveValue("30");
    await page.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
    await enterPin(page);
    await expect(progress(page)).toHaveAttribute("aria-valuenow", "80");
    expect(await db.deferredApprovalRequest.count({ where: { requestId, status: "APPROVED" } })).toBe(1);
    expect(await db.executiveApprovalDecision.count({ where: { requestId } })).toBe(2);
    await context.close();
  });

  test("an ADMIN hands the pending executive work to the new executive, who can then act", async ({ browser }) => {
    const { context, page } = await as(browser, ids.admin);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Хүлээгдэж буй баталгааг шилжүүлэх" }).click();
    await page.getByLabel(/Өмнөх захирал/).selectOption({ label: ids.execOld });
    await expect(page.getByText("эхний батлалт хүлээж байна")).toBeVisible();
    await page.getByLabel(/Шилжүүлэх шалтгаан/).fill("Захирал солигдсон");
    await page.getByRole("button", { name: "Шилжүүлж баталгаажуулах" }).click();
    await expect(page.getByText("Баталгаа шилжлээ")).toBeVisible();
    const rows = await db.executiveApprovalReassignment.findMany({ where: { requestId: handoverRequestId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromUserId: ids.execOld, toUserId: ids.execNew, reassignedById: ids.admin, reason: "Захирал солигдсон" });
    // the ADMIN sees the request but has no approval controls
    await page.goto(`/requests/${handoverRequestId}`);
    await expect(page.getByRole("button", { name: "Батлах", exact: true })).toHaveCount(0);
    await context.close();

    // the new executive now has the approval controls and uses their OWN PIN
    const next = await as(browser, ids.execNew);
    await next.page.goto(`/requests/${handoverRequestId}`);
    await next.page.getByRole("button", { name: "Батлах", exact: true }).click();
    await next.page.getByPlaceholder("····").fill(PIN); // the old executive PIN is not theirs
    await next.page.getByRole("button", { name: "Баталгаажуулах", exact: true }).click();
    await expect(next.page.getByText("PIN буруу байна")).toBeVisible();
    await next.page.getByPlaceholder("····").fill(PIN_NEW);
    await next.page.getByRole("button", { name: "Баталгаажуулах", exact: true }).click();
    await expect.poll(async () => (await db.materialRequest.findUniqueOrThrow({ where: { id: handoverRequestId } })).status).toBe("PENDING_PROCUREMENT");
    expect((await db.approvalStep.findFirstOrThrow({ where: { requestId: handoverRequestId, type: "EXECUTIVE_APPROVAL" } })).decidedById).toBe(ids.execNew);
    await next.context.close();
  });

  test("the panel fits a phone screen (iPhone width) for both roles", async ({ browser }) => {
    for (const [id, path] of [[ids.exec, `/requests/${requestId}`], [ids.mgr, `/procurement/${requestId}`]] as const) {
      const { context, page } = await as(browser, id, { width: 390, height: 844 });
      await page.goto(path);
      await expect(page.getByRole("progressbar", { name: "Батлагдсан хувь" })).toBeVisible();
      await noHorizontalScroll(page);
      await context.close();
    }
  });
});
