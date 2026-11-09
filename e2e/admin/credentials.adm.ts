import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { expect, test, type Browser, type Page } from "@playwright/test";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

const TAG = Date.now().toString(36);
const ADMIN_PASSWORD = "Passw0rd-admin";
const EMP_PASSWORD = "Passw0rd-employee";
const ids = { admin: `adme2e-${TAG}-admin`, admin2: `adme2e-${TAG}-admin2`, emp: `adme2e-${TAG}-emp`, boss: `adme2e-${TAG}-boss`, head: `adme2e-${TAG}-head` };
const NAMES = { admin: `Админ ${TAG}`, admin2: `Админ Хоёр ${TAG}`, emp: `Ажилтан ${TAG}`, boss: `Дарга ${TAG}`, head: `Хэлтсийн ${TAG}` };
const email = (id: string) => `${id}@test.local`;
const dept = `adme2e-dept-${TAG}`;
const NEW_EMAIL = `adme2e-${TAG}-new@test.local`;
let ipCounter = 0;
const nextIp = () => `198.19.${70 + Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

test.beforeAll(async () => {
  const [apw, epw] = await Promise.all([bcrypt.hash(ADMIN_PASSWORD, 10), bcrypt.hash(EMP_PASSWORD, 10)]);
  await db.department.create({ data: { id: dept, name: `Цех ${TAG}`, type: "FACTORY" } });
  const mk = (id: string, name: string, role: "ADMIN" | "EMPLOYEE" | "BOSS", passwordHash: string) =>
    db.user.create({ data: { id, email: email(id), name, role, passwordHash } });
  await mk(ids.admin, NAMES.admin, "ADMIN", apw);
  await mk(ids.admin2, NAMES.admin2, "ADMIN", apw);
  await mk(ids.emp, NAMES.emp, "EMPLOYEE", epw);
  await mk(ids.boss, NAMES.boss, "BOSS", epw);
  await mk(ids.head, NAMES.head, "EMPLOYEE", epw); // an EMPLOYEE role who nevertheless heads a department
  await db.department.update({ where: { id: dept }, data: { headId: ids.head } });
  await db.loginThrottle.deleteMany();
});
test.afterAll(async () => {
  await db.loginThrottle.deleteMany();
  const made = (await db.user.findMany({ where: { email: NEW_EMAIL }, select: { id: true } })).map((u) => u.id);
  const all = [...Object.values(ids), ...made];
  await db.notification.deleteMany({ where: { userId: { in: all } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: all } }, { entityId: { in: all } }] } });
  await db.department.updateMany({ where: { id: dept }, data: { headId: null } });
  await db.user.deleteMany({ where: { id: { in: all } } });
  await db.department.deleteMany({ where: { id: dept } });
  await db.$disconnect();
});

async function signIn(browser: Browser, email_: string, password: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": nextIp() }, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email_);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
  await page.waitForURL(/\/dashboard/);
  return { context, page };
}
async function findRow(page: Page, name: string) {
  await page.goto("/admin");
  await page.getByPlaceholder("Хэрэглэгч хайх...").fill(name);
}
const dialog = (page: Page) => page.getByRole("dialog");
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

test.describe.serial("ADMIN credential management", () => {
  test("password reset needs a reason, the identity attestation and the admin own password; wrong password changes nothing", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin), ADMIN_PASSWORD);
    await findRow(page, NAMES.emp);
    await page.getByRole("button", { name: `${NAMES.emp}-ийн нууц үг шинэчлэх` }).click();
    const submit = page.getByRole("button", { name: "Нууц үг сэргээх", exact: true });
    await expect(submit).toBeDisabled();
    await page.getByLabel(/Би энэ ажилтны хувийн байдлыг/).check();
    await expect(submit).toBeDisabled(); // still no reason and no password
    await page.getByLabel(/Сэргээх шалтгаан/).fill("Утсаар буцаж залгаж баталгаажуулсан, нууц үгээ мартсан");
    await expect(submit).toBeDisabled();
    await page.getByLabel("Таны өөрийн нууц үг").fill("wrong-admin-password");
    await submit.click();
    await expect(dialog(page).getByRole("alert")).toContainText("Нууц үг буруу байна");
    const emp = await db.user.findUniqueOrThrow({ where: { id: ids.emp } });
    expect(await bcrypt.compare(EMP_PASSWORD, emp.passwordHash)).toBe(true); // untouched
    await context.close();
  });

  test("an approval-capable account is refused with a clear message and stays untouched", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin), ADMIN_PASSWORD);
    for (const [name, id] of [[NAMES.boss, ids.boss], [NAMES.head, ids.head]] as const) {
      await findRow(page, name);
      await page.getByRole("button", { name: `${name}-ийн нууц үг шинэчлэх` }).click();
      await page.getByLabel(/Би энэ ажилтны хувийн байдлыг/).check();
      await page.getByLabel(/Сэргээх шалтгаан/).fill("Нууц үгээ мартсан гэж хэлсэн");
      await page.getByLabel("Таны өөрийн нууц үг").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Нууц үг сэргээх", exact: true }).click();
      await expect(dialog(page).getByRole("alert")).toContainText("Батлах эрхтэй");
      await expect(dialog(page).getByRole("alert")).not.toContainText(/\$2|hash|POSITION|ROLE|DEPARTMENT_HEAD/);
      const row = await db.user.findUniqueOrThrow({ where: { id } });
      expect(await bcrypt.compare(EMP_PASSWORD, row.passwordHash)).toBe(true);
      await page.keyboard.press("Escape");
    }
    // the refusals were recorded (bounded) and no success audit exists
    expect(await db.auditLog.count({ where: { entityId: { in: [ids.boss, ids.head] }, action: "REJECT", entityType: "UserCredentialReset" } })).toBe(2);
    expect(await db.auditLog.count({ where: { entityId: { in: [ids.boss, ids.head] }, action: "RESET_CREDENTIALS" } })).toBe(0);
    await context.close();
  });

  test("an admin cannot reset their own password here", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin2), ADMIN_PASSWORD);
    await findRow(page, NAMES.admin2);
    await page.getByRole("button", { name: `${NAMES.admin2}-ийн нууц үг шинэчлэх` }).click();
    await page.getByLabel(/Би энэ ажилтны хувийн байдлыг/).check();
    await page.getByLabel(/Сэргээх шалтгаан/).fill("Өөрийнхөө нууц үгийг сэргээх гэж үзлээ");
    await page.getByLabel("Таны өөрийн нууц үг").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Нууц үг сэргээх", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("Өөрийн нууц үгийг");
    await context.close();
  });

  test("a plain employee can be reset: temporary password shown once, audit and notification written, old password stops working", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin), ADMIN_PASSWORD);
    await findRow(page, NAMES.emp);
    await page.getByRole("button", { name: `${NAMES.emp}-ийн нууц үг шинэчлэх` }).click();
    await page.getByLabel(/Би энэ ажилтны хувийн байдлыг/).check();
    await page.getByLabel(/Сэргээх шалтгаан/).fill("Утсаар буцаж залгаж баталгаажуулсан, нууц үгээ мартсан");
    await page.getByLabel("Таны өөрийн нууц үг").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Нууц үг сэргээх", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Түр нууц үг" });
    await expect(modal).toBeVisible();
    const temp = (await modal.locator("p.font-mono").innerText()).trim();
    expect(temp.length).toBeGreaterThanOrEqual(12);
    await expect(modal).toContainText("аудитад бүртгэгдсэн");
    await context.close();

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: ids.emp, action: "RESET_CREDENTIALS" } });
    expect(audit.actorId).toBe(ids.admin);
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ kind: "PASSWORD_RESET", identityVerified: true, targetUserId: ids.emp });
    expect(JSON.stringify(audit)).not.toContain(temp);
    const note = await db.notification.findFirstOrThrow({ where: { userId: ids.emp } });
    expect(note.title).toBe("Таны нууц үг сэргээгдлээ");
    expect(note.body).not.toContain(temp);

    // the old password is dead; the temporary one works
    const old = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": nextIp() } });
    const oldPage = await old.newPage();
    await oldPage.goto("/login");
    await oldPage.locator('input[name="email"]').fill(email(ids.emp));
    await oldPage.locator('input[name="password"]').fill(EMP_PASSWORD);
    await oldPage.getByRole("button", { name: "Нэвтрэх" }).click();
    await expect(oldPage.locator("p.lg-error")).toBeVisible();
    await old.close();
    const fresh = await signIn(browser, email(ids.emp), temp);
    await fresh.context.close();
  });

  test("user creation needs the admin own password and creates a working account", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin2), ADMIN_PASSWORD);
    await page.goto("/admin");
    await page.getByRole("button", { name: /Шинэ хэрэглэгч|Хэрэглэгч нэмэх|Нэмэх/ }).first().click();
    await page.getByPlaceholder("И-мэйл").fill(NEW_EMAIL);
    await page.getByPlaceholder("Овог, нэр").fill(`Шинэ Ажилтан ${TAG}`);
    const submit = page.getByRole("button", { name: "Үүсгэх", exact: true });
    await expect(submit).toBeDisabled(); // no admin password yet
    await page.getByLabel(/Таны өөрийн нууц үг/).fill("wrong");
    await submit.click();
    await expect(page.getByText("Нууц үг буруу байна").first()).toBeVisible();
    expect(await db.user.count({ where: { email: NEW_EMAIL } })).toBe(0);
    await page.getByLabel(/Таны өөрийн нууц үг/).fill(ADMIN_PASSWORD);
    await submit.click();
    const modal = page.getByRole("dialog", { name: "Түр нууц үг" });
    await expect(modal).toBeVisible();
    const temp = (await modal.locator("p.font-mono").innerText()).trim();
    const created = await db.user.findUniqueOrThrow({ where: { email: NEW_EMAIL } });
    expect(await bcrypt.compare(temp, created.passwordHash)).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: created.id, action: "CREATE_USER" } });
    expect(audit.actorId).toBe(ids.admin2);
    expect(JSON.stringify(audit)).not.toContain(temp);
    await context.close();
    const fresh = await signIn(browser, NEW_EMAIL, temp);
    await fresh.context.close();
  });

  test("the API refuses a non-admin directly", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.head), EMP_PASSWORD);
    const reset = await page.request.post(`/api/admin/users/${ids.emp}/reset-credentials`, { data: { reason: "no authority", identityVerified: true, adminPassword: EMP_PASSWORD } });
    expect(reset.status()).toBe(403);
    const create = await page.request.post("/api/admin/users", { data: { email: `x-${NEW_EMAIL}`, name: "X", role: "EMPLOYEE", adminPassword: EMP_PASSWORD } });
    expect(create.status()).toBe(403);
    await context.close();
  });

  for (const width of [390, 320]) {
    test(`the reset dialog fits ${width}px: no horizontal scroll, controls reachable`, async ({ browser }) => {
      const { context, page } = await signIn(browser, email(ids.admin2), ADMIN_PASSWORD, { width, height: 780 });
      await findRow(page, NAMES.boss);
      await page.getByRole("button", { name: `${NAMES.boss}-ийн нууц үг шинэчлэх` }).click();
      const box = dialog(page);
      await expect(box).toBeVisible();
      await noHorizontalScroll(page);
      const bounds = await box.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      for (const control of [box.getByLabel(/Би энэ ажилтны хувийн байдлыг/), box.getByLabel(/Сэргээх шалтгаан/), box.getByLabel("Таны өөрийн нууц үг"), box.getByRole("button", { name: "Болих" })]) {
        await control.scrollIntoViewIfNeeded();
        const cb = (await control.boundingBox())!;
        expect(cb.x + cb.width).toBeLessThanOrEqual(width + 1);
      }
      const clipped = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] *')].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible" && el.children.length === 0 && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA").map((el) => el.textContent?.slice(0, 40)));
      expect(clipped).toEqual([]);
      await context.close();
    });
  }
});
