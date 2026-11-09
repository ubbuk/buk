import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { expect, test, type Browser } from "@playwright/test";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

const TAG = Date.now().toString(36);
const PASSWORD = "Passw0rd-employee";
const ADMIN_PASSWORD = "Passw0rd-admin";
const ids = { boss: `pine2e-${TAG}-boss`, admin: `pine2e-${TAG}-admin`, locked: `pine2e-${TAG}-locked` };
const NAMES = { boss: `Ажилтан Бат ${TAG}`, admin: `Админ ${TAG}`, locked: `Түгжигдсэн ${TAG}` };
const email = (id: string) => `${id}@test.local`;
let ipCounter = 0;
const nextIp = () => `198.18.${50 + Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

test.beforeAll(async () => {
  const [pw, apw, pinHash] = await Promise.all([bcrypt.hash(PASSWORD, 10), bcrypt.hash(ADMIN_PASSWORD, 10), bcrypt.hash("1234", 10)]);
  await db.user.create({ data: { id: ids.boss, email: email(ids.boss), name: NAMES.boss, role: "BOSS", passwordHash: pw } });
  await db.user.create({ data: { id: ids.admin, email: email(ids.admin), name: NAMES.admin, role: "ADMIN", passwordHash: apw } });
  await db.user.create({ data: { id: ids.locked, email: email(ids.locked), name: NAMES.locked, role: "BOSS", passwordHash: pw } });
  await db.approvalPinCredential.create({ data: { userId: ids.locked, pinHash, lockedUntil: new Date(Date.now() + 10 * 60_000) } });
  await db.loginThrottle.deleteMany();
});
test.afterAll(async () => {
  await db.loginThrottle.deleteMany();
  const all = Object.values(ids);
  await db.notification.deleteMany({ where: { userId: { in: all } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: all } }, { entityId: { in: all } }] } });
  await db.approvalPinCredential.deleteMany({ where: { userId: { in: all } } });
  await db.user.deleteMany({ where: { id: { in: all } } });
  await db.$disconnect();
});

async function signIn(browser: Browser, who: keyof typeof ids, password: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": nextIp() } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email(ids[who]));
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
  await page.waitForURL(/\/dashboard/);
  return { context, page };
}
const pinHashOf = async (userId: string) => (await db.approvalPinCredential.findUnique({ where: { userId } }))?.pinHash ?? null;

test.describe.serial("PIN management", () => {
  test("setting and changing a PIN needs the account password", async ({ browser }) => {
    const { context, page } = await signIn(browser, "boss", PASSWORD);
    await page.goto("/settings");
    await page.getByLabel("Шинэ PIN (4 орон)").fill("4321");
    await page.getByLabel("PIN давтах").fill("4321");
    const submit = page.getByRole("button", { name: /PIN тохируулах|PIN солих/ });
    await expect(submit).toBeDisabled(); // no password yet

    await page.getByLabel("Одоогийн нууц үг (PIN").fill("wrong-password");
    await submit.click();
    await expect(page.getByText("Нууц үг буруу байна").first()).toBeVisible();
    expect(await pinHashOf(ids.boss)).toBeNull();

    await page.getByLabel("Одоогийн нууц үг (PIN").fill(PASSWORD);
    await submit.click();
    await expect(page.getByText("PIN амжилттай тохируулагдлаа")).toBeVisible();
    const first = await pinHashOf(ids.boss);
    expect(first).not.toBeNull();
    expect(await bcrypt.compare("4321", first!)).toBe(true);

    // changing it asks for the password again
    await page.getByLabel("Шинэ PIN (4 орон)").fill("8765");
    await page.getByLabel("PIN давтах").fill("8765");
    await expect(page.getByRole("button", { name: "PIN солих" })).toBeDisabled();
    await page.getByLabel("Одоогийн нууц үг (PIN").fill(PASSWORD);
    await page.getByRole("button", { name: "PIN солих" }).click();
    // the first success toast may still be on screen, so wait for the stored hash itself to change
    await expect.poll(async () => bcrypt.compare("8765", (await pinHashOf(ids.boss))!)).toBe(true);
    await context.close();
  });

  test("a locked account cannot change its PIN and the lock stays", async ({ browser }) => {
    const { context, page } = await signIn(browser, "locked", PASSWORD);
    const before = await db.approvalPinCredential.findUniqueOrThrow({ where: { userId: ids.locked } });
    await page.goto("/settings");
    await page.getByLabel("Шинэ PIN (4 орон)").fill("1111");
    await page.getByLabel("PIN давтах").fill("1111");
    await page.getByLabel("Одоогийн нууц үг (PIN").fill(PASSWORD);
    await page.getByRole("button", { name: "PIN солих" }).click();
    await expect(page.getByText(/түгжигдсэн байна/).first()).toBeVisible();
    const after = await db.approvalPinCredential.findUniqueOrThrow({ where: { userId: ids.locked } });
    expect(after.pinHash).toBe(before.pinHash);
    expect(after.lockedUntil).toEqual(before.lockedUntil);
    await context.close();
  });

  test("an ADMIN resets a PIN with a reason, the identity attestation and their own password; the employee then creates a new one", async ({ browser }) => {
    const { context, page } = await signIn(browser, "admin", ADMIN_PASSWORD);
    await page.goto("/admin");
    await page.getByPlaceholder("Хэрэглэгч хайх...").fill(NAMES.locked);
    await page.getByRole("button", { name: `${NAMES.locked}-ийн PIN цуцлах` }).click();

    const submit = page.getByRole("button", { name: "PIN цуцлах", exact: true });
    await expect(submit).toBeDisabled(); // nothing filled in
    await page.getByLabel(/Би энэ ажилтны хувийн байдлыг/).check();
    await page.getByLabel(/Цуцлах шалтгаан/).fill("Утсаар буцаж залгаж баталгаажуулсан, PIN-ээ мартсан");
    await expect(submit).toBeDisabled(); // still no admin password
    await page.getByLabel("Таны өөрийн нууц үг").fill("wrong-admin-password");
    await submit.click();
    await expect(page.getByText("Нууц үг буруу байна").first()).toBeVisible();
    expect(await pinHashOf(ids.locked)).not.toBeNull(); // nothing was reset

    await page.getByLabel("Таны өөрийн нууц үг").fill(ADMIN_PASSWORD);
    await submit.click();
    await expect(page.getByText(`${NAMES.locked}-ийн PIN цуцлагдлаа`)).toBeVisible();
    expect(await pinHashOf(ids.locked)).toBeNull();

    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: ids.locked, action: "RESET_CREDENTIALS" } });
    expect(log.actorId).toBe(ids.admin);
    expect(JSON.parse(log.afterJson!)).toMatchObject({ kind: "PIN_RESET", identityVerified: true, hadPin: true });
    expect(JSON.parse(log.afterJson!).reason).toContain("Утсаар буцаж залгаж");
    expect(JSON.stringify(log)).not.toMatch(/\$2[aby]\$|1234/);
    // the admin was never offered a PIN field anywhere in that dialog
    await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(0);
    await context.close();

    // the employee is told, and must use their OWN password to create a new PIN (the lock is gone with the old credential)
    const emp = await signIn(browser, "locked", PASSWORD);
    await emp.page.goto("/settings");
    await emp.page.getByLabel("Шинэ PIN (4 орон)").fill("2468");
    await emp.page.getByLabel("PIN давтах").fill("2468");
    await emp.page.getByLabel("Одоогийн нууц үг (PIN").fill(ADMIN_PASSWORD); // the admin's password is not theirs
    await emp.page.getByRole("button", { name: "PIN тохируулах" }).click();
    await expect(emp.page.getByText("Нууц үг буруу байна").first()).toBeVisible();
    await emp.page.getByLabel("Одоогийн нууц үг (PIN").fill(PASSWORD);
    await emp.page.getByRole("button", { name: "PIN тохируулах" }).click();
    await expect(emp.page.getByText("PIN амжилттай тохируулагдлаа")).toBeVisible();
    expect(await bcrypt.compare("2468", (await pinHashOf(ids.locked))!)).toBe(true);
    expect((await db.approvalPinCredential.findUniqueOrThrow({ where: { userId: ids.locked } })).lockedUntil).toBeNull();
    await emp.context.close();
  });

  test("the reset button is not offered to non-admins and the API refuses them", async ({ browser }) => {
    const { context, page } = await signIn(browser, "boss", PASSWORD);
    const res = await page.request.post(`/api/admin/users/${ids.locked}/reset-pin`, {
      data: { reason: "no authority", identityVerified: true, adminPassword: PASSWORD },
    });
    expect(res.status()).toBe(403);
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: /PIN цуцлах/ })).toHaveCount(0);
    await context.close();
  });
});
