import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Step 2 of the approval flow: the administrator assigns a keeper to a warehouse and switches the routing mode in
// /admin; new requests then go to the primary keeper (PRIMARY) or to the keeper of the warehouse holding the
// material (BY_WAREHOUSE); a keeper of another warehouse is refused. Real browser, app wired to the ISOLATED test
// database (see playwright.admin.config.ts).
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

const TAG = Date.now().toString(36);
const PASSWORD = "Passw0rd-wk";
const PIN = "1234";
const PRIMARY_KEEPER = "u-sarnai"; // the seeded STOREKEEPER_LEAD holder
const id = (s: string) => `wkpw-${TAG}-${s}`;
const ids = { admin: id("admin"), emp: id("emp"), head: id("head"), keeperA: id("keeper-a"), keeperB: id("keeper-b") };
const NAME = { topA: `Агуулах А ${TAG}`, topB: `Агуулах Б ${TAG}`, topC: `Агуулах В ${TAG}`, keeperA: `Нярав А ${TAG}`, keeperB: `Нярав Б ${TAG}` };
const dept = id("dept");
const W = { topA: id("top-a"), topB: id("top-b"), topC: id("top-c"), locA: id("loc-a"), locB: id("loc-b"), locC: id("loc-c") };
const MAT = { a: id("mat-a"), c: id("mat-c") };
const email = (s: string) => `${s}@test.local`;
let ipCounter = 0;
const nextIp = () => `198.19.${160 + Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

test.beforeAll(async () => {
  const [hash, pinHash] = await Promise.all([bcrypt.hash(PASSWORD, 10), bcrypt.hash(PIN, 10)]);
  await db.department.create({ data: { id: dept, name: `Цех ${TAG}`, type: "FACTORY" } });
  const mk = (uid: string, name: string, role: "ADMIN" | "EMPLOYEE" | "BOSS" | "STOREKEEPER") =>
    db.user.create({ data: { id: uid, email: email(uid), name, role, passwordHash: hash, departmentId: role === "EMPLOYEE" || role === "BOSS" ? dept : null } });
  await mk(ids.admin, `Админ ${TAG}`, "ADMIN");
  await mk(ids.emp, `Ажилтан ${TAG}`, "EMPLOYEE");
  await mk(ids.head, `Дарга ${TAG}`, "BOSS");
  await mk(ids.keeperA, NAME.keeperA, "STOREKEEPER");
  await mk(ids.keeperB, NAME.keeperB, "STOREKEEPER");
  await db.department.update({ where: { id: dept }, data: { headId: ids.head } });
  for (const userId of [ids.head, ids.keeperA, ids.keeperB]) await db.approvalPinCredential.create({ data: { userId, pinHash } });

  await db.warehouse.createMany({ data: [{ id: W.topA, name: NAME.topA }, { id: W.topB, name: NAME.topB }, { id: W.topC, name: NAME.topC }] });
  await db.warehouse.createMany({
    data: [
      { id: W.locA, name: `Байршил А ${TAG}`, parentId: W.topA, sortPriority: 5 },
      { id: W.locB, name: `Байршил Б ${TAG}`, parentId: W.topB, sortPriority: 6 },
      { id: W.locC, name: `Байршил В ${TAG}`, parentId: W.topC, sortPriority: 7 },
    ],
  });
  await db.material.createMany({ data: [MAT.a, MAT.c].map((m) => ({ id: m, code: m, name: m, unit: "ш", defaultPrice: 100 })) });
  await db.inventoryBalance.createMany({
    data: [
      { materialId: MAT.a, warehouseId: W.locA, quantityOnHand: 50 },
      { materialId: MAT.c, warehouseId: W.locC, quantityOnHand: 50 },
    ],
  });
  await db.systemSetting.deleteMany({ where: { key: "step2_keeper_mode" } });
  await db.loginThrottle.deleteMany();
});

test.afterAll(async () => {
  await db.loginThrottle.deleteMany();
  const requests = await db.materialRequest.findMany({ where: { requestedById: ids.emp }, select: { id: true, items: { select: { id: true } } } });
  const reqIds = requests.map((r) => r.id);
  const itemIds = requests.flatMap((r) => r.items.map((i) => i.id));
  const reservations = await db.stockReservation.findMany({ where: { requestItemId: { in: itemIds } }, select: { id: true } });
  await db.stockIssue.deleteMany({ where: { reservationId: { in: reservations.map((r) => r.id) } } });
  await db.stockReservation.deleteMany({ where: { requestItemId: { in: itemIds } } });
  await db.warehouseCheckItem.deleteMany({ where: { requestItemId: { in: itemIds } } });
  await db.warehouseCheck.deleteMany({ where: { requestId: { in: reqIds } } });
  await db.approvalAction.deleteMany({ where: { approvalStep: { requestId: { in: reqIds } } } });
  const users = Object.values(ids);
  await db.notification.deleteMany({ where: { OR: [{ relatedRequestId: { in: reqIds } }, { userId: { in: users } }] } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: reqIds } }, { actorId: { in: users } }, { entityId: { in: [...users, ...Object.values(W)] } }] } });
  await db.materialRequest.deleteMany({ where: { id: { in: reqIds } } });
  await db.inventoryBalance.deleteMany({ where: { materialId: { in: Object.values(MAT) } } });
  await db.material.deleteMany({ where: { id: { in: Object.values(MAT) } } });
  await db.warehouse.updateMany({ where: { id: { in: Object.values(W) } }, data: { keeperId: null } });
  await db.warehouse.deleteMany({ where: { id: { in: [W.locA, W.locB, W.locC] } } });
  await db.warehouse.deleteMany({ where: { id: { in: [W.topA, W.topB, W.topC] } } });
  await db.department.update({ where: { id: dept }, data: { headId: null } });
  await db.approvalPinCredential.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.department.deleteMany({ where: { id: dept } });
  await db.systemSetting.deleteMany({ where: { key: "step2_keeper_mode" } });
  await db.$disconnect();
});

async function signIn(browser: Browser, userId: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": nextIp() } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email(userId));
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
  await page.waitForURL(/\/dashboard/);
  return { context, page };
}

const settings = (page: Page) => page.getByTestId("warehouse-settings");
const mode = async () => (await db.systemSetting.findUnique({ where: { key: "step2_keeper_mode" } }))?.value ?? "PRIMARY";

async function createRequest(page: Page, materialId: string) {
  const res = await page.request.post("/api/requests", {
    data: { departmentId: dept, items: [{ materialId, materialName: "wk", unit: "ш", requestedQuantity: 2, unitPrice: 100 }] },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}
const step2 = (requestId: string) => db.approvalStep.findFirstOrThrow({ where: { requestId, type: "WAREHOUSE_CHECK" } });

test.describe.serial("step 2 keeper routing", () => {
  test("the admin assigns a keeper to a warehouse and switches the mode; both are persisted and audited", async ({ browser }) => {
    const { context, page } = await signIn(browser, ids.admin);
    await page.goto("/admin");
    await expect(settings(page)).toBeVisible();
    expect(await mode()).toBe("PRIMARY");
    await expect(settings(page).getByLabel("Нярав сонгох горим")).toHaveValue("PRIMARY");

    await settings(page).getByLabel(`${NAME.topA} нярав`).selectOption(ids.keeperA);
    await expect.poll(async () => (await db.warehouse.findUniqueOrThrow({ where: { id: W.topA } })).keeperId).toBe(ids.keeperA);
    await settings(page).getByLabel(`${NAME.topB} нярав`).selectOption(ids.keeperB);
    await expect.poll(async () => (await db.warehouse.findUniqueOrThrow({ where: { id: W.topB } })).keeperId).toBe(ids.keeperB);
    expect(await db.auditLog.count({ where: { entityType: "Warehouse", entityId: W.topA, actorId: ids.admin } })).toBeGreaterThan(0);

    await settings(page).getByLabel("Нярав сонгох горим").selectOption("BY_WAREHOUSE");
    await expect.poll(mode).toBe("BY_WAREHOUSE");
    await context.close();
  });

  test("BY_WAREHOUSE: the keeper of the warehouse holding the material gets the request; the other keeper is refused (403)", async ({ browser }) => {
    const emp = await signIn(browser, ids.emp);
    const requestId = await createRequest(emp.page, MAT.a);
    expect((await step2(requestId)).assignedUserId).toBe(ids.keeperA);
    const request = await db.materialRequest.findUniqueOrThrow({ where: { id: requestId }, include: { items: true } });

    const head = await signIn(browser, ids.head);
    const approved = await head.page.request.post(`/api/requests/${requestId}/department-approve`, { data: { pin: PIN, expectedVersion: request.version } });
    expect(approved.status()).toBe(200);
    const version = (await db.materialRequest.findUniqueOrThrow({ where: { id: requestId } })).version;
    const body = { items: [{ requestItemId: request.items[0].id, availableQuantity: 2 }], pin: PIN, expectedVersion: version };

    const other = await signIn(browser, ids.keeperB);
    expect((await other.page.request.post(`/api/requests/${requestId}/warehouse-check`, { data: body })).status()).toBe(403);
    expect((await db.materialRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("PENDING_WAREHOUSE_CHECK");

    const own = await signIn(browser, ids.keeperA);
    const done = await own.page.request.post(`/api/requests/${requestId}/warehouse-check`, { data: body });
    expect(done.status()).toBe(200);
    // the keeper's decision is final: a covered request is complete, no senior-keeper step follows
    expect((await db.materialRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("COMPLETED");
    const reservation = await db.stockReservation.findFirstOrThrow({ where: { requestItemId: request.items[0].id } });
    expect(reservation.warehouseId).toBe(W.locA);
    await Promise.all([emp.context.close(), head.context.close(), other.context.close(), own.context.close()]);
  });

  test("BY_WAREHOUSE: a warehouse without a keeper falls back to the primary keeper and is audited", async ({ browser }) => {
    const emp = await signIn(browser, ids.emp);
    const requestId = await createRequest(emp.page, MAT.c);
    expect((await step2(requestId)).assignedUserId).toBe(PRIMARY_KEEPER);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: requestId, afterJson: { contains: "STOREKEEPER_FALLBACK" } } });
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ reason: "NO_KEEPER", warehouseId: W.topC });
    await emp.context.close();
  });

  test("the admin switches back to PRIMARY: every new request goes to the primary keeper again", async ({ browser }) => {
    const admin = await signIn(browser, ids.admin);
    await admin.page.goto("/admin");
    await settings(admin.page).getByLabel("Нярав сонгох горим").selectOption("PRIMARY");
    await expect.poll(mode).toBe("PRIMARY");
    await admin.context.close();

    const emp = await signIn(browser, ids.emp);
    const requestId = await createRequest(emp.page, MAT.a);
    expect((await step2(requestId)).assignedUserId).toBe(PRIMARY_KEEPER);
    await emp.context.close();
  });

  test("the /warehouses catalog is read from the database: groups with their keeper, locations below", async ({ browser }) => {
    const emp = await signIn(browser, ids.emp);
    await emp.page.goto("/warehouses");
    const groupA = emp.page.getByRole("button", { name: new RegExp(NAME.topA) });
    await expect(groupA).toContainText(`Нярав: ${NAME.keeperA}`);
    await expect(emp.page.getByRole("button", { name: new RegExp(NAME.topC) })).toContainText("Нярав байхгүй");
    await groupA.click();
    await emp.page.getByRole("link", { name: new RegExp(`Байршил А ${TAG}`) }).click();
    await expect(emp.page.getByRole("heading", { name: `Байршил А ${TAG}` })).toBeVisible();
    await emp.context.close();
  });

  test("the admin screen has no horizontal scroll on a phone", async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": nextIp() }, viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email(ids.admin));
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Нэвтрэх" }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/admin");
    await expect(settings(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await context.close();
  });
});
