import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Stage 1.5: granting authority in the admin screen (role change, create privileged user, department head) needs a
// reason, a confirmation and the administrator's OWN password; an account whose password an admin issued and its owner
// has not changed is refused. Real browser, app wired to the ISOLATED test database (see playwright.admin.config.ts).
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

const TAG = Date.now().toString(36);
const ADMIN_PASSWORD = "Passw0rd-admin";
const EMP_PASSWORD = "Passw0rd-employee";
const ids = { admin: `agpw-${TAG}-admin`, admin2: `agpw-${TAG}-admin2`, emp: `agpw-${TAG}-emp`, issued: `agpw-${TAG}-issued`, boss: `agpw-${TAG}-boss` };
const NAMES = { admin: `Админ ${TAG}`, admin2: `Админ Хоёр ${TAG}`, emp: `Ажилтан ${TAG}`, issued: `Түр нууц ${TAG}`, boss: `Дарга ${TAG}` };
const email = (id: string) => `${id}@test.local`;
const dept = `agpw-dept-${TAG}`;
const REASON = "Тушаал №12-ын дагуу шинэ албан тушаалд томилсон";
let ipCounter = 0;
const nextIp = () => `198.19.${120 + Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

test.beforeAll(async () => {
  const [apw, epw] = await Promise.all([bcrypt.hash(ADMIN_PASSWORD, 10), bcrypt.hash(EMP_PASSWORD, 10)]);
  await db.department.create({ data: { id: dept, name: `Цех ${TAG}`, type: "FACTORY" } });
  const mk = (id: string, name: string, role: "ADMIN" | "EMPLOYEE" | "BOSS", passwordHash: string) => db.user.create({ data: { id, email: email(id), name, role, passwordHash } });
  await mk(ids.admin, NAMES.admin, "ADMIN", apw);
  await mk(ids.admin2, NAMES.admin2, "ADMIN", apw);
  await mk(ids.emp, NAMES.emp, "EMPLOYEE", epw);
  await mk(ids.issued, NAMES.issued, "EMPLOYEE", epw);
  await mk(ids.boss, NAMES.boss, "BOSS", epw);
  // this account's password was issued by an administrator and its owner has not changed it since
  await db.auditLog.create({ data: { entityType: "User", entityId: ids.issued, action: "RESET_CREDENTIALS", actorId: ids.admin, afterJson: JSON.stringify({ kind: "PASSWORD_RESET", reason: "seed" }) } });
  await db.loginThrottle.deleteMany();
});
test.afterAll(async () => {
  await db.loginThrottle.deleteMany();
  const made = (await db.user.findMany({ where: { email: { startsWith: `agpw-${TAG}-new` } }, select: { id: true } })).map((u) => u.id);
  const all = [...Object.values(ids), ...made];
  await db.department.updateMany({ where: { id: dept }, data: { headId: null } });
  await db.notification.deleteMany({ where: { userId: { in: all } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: all } }, { entityId: { in: all } }, { entityId: dept }] } });
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
async function openEditor(page: Page, name: string) {
  await page.goto("/admin");
  await page.getByPlaceholder("Хэрэглэгч хайх...").fill(name);
  await page.getByRole("button", { name: `${name}-ийг засах` }).click();
}
const dialog = (page: Page) => page.getByRole("dialog");
// the grant dialog by name: the edit dialog it replaces may still be animating out
const grantDialog = (page: Page) => page.getByRole("dialog", { name: /олгохыг баталгаажуулах|томилохыг баталгаажуулах/ });
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

test.describe.serial("granting authority", () => {
  test("a role elevation asks for reason, confirmation and the own password; a wrong password changes nothing; the right one grants, audits and notifies", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin), ADMIN_PASSWORD);
    await openEditor(page, NAMES.emp);
    await dialog(page).locator("select").first().selectOption("STOREKEEPER");
    await dialog(page).getByRole("button", { name: "Хадгалах" }).click();

    const grant = grantDialog(page);
    await expect(grant.getByText("Эрх олгох шалтгаан")).toBeVisible();
    const submit = grant.getByRole("button", { name: "Эрх олгох", exact: true });
    await expect(submit).toBeDisabled();
    await grant.getByLabel(/Эрх олгох шалтгаан/).fill(REASON);
    await expect(submit).toBeDisabled();
    await grant.getByRole("checkbox").check();
    await expect(submit).toBeDisabled(); // still no password
    await grant.getByLabel("Таны өөрийн нууц үг").fill("wrong-admin-password");
    await submit.click();
    await expect(grant.getByTestId("grant-error")).toContainText("Нууц үг буруу байна");
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.emp } })).role).toBe("EMPLOYEE");
    expect(await db.auditLog.count({ where: { entityType: "AuthorityGrant", entityId: ids.emp } })).toBe(0);

    await grant.getByLabel("Таны өөрийн нууц үг").fill(ADMIN_PASSWORD);
    await submit.click();
    await expect(grantDialog(page)).toHaveCount(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.emp } })).role).toBe("STOREKEEPER");

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "AuthorityGrant", entityId: ids.emp } });
    expect(audit.actorId).toBe(ids.admin);
    expect(JSON.parse(audit.beforeJson!)).toMatchObject({ role: "EMPLOYEE" });
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ grantKind: "ROLE_ELEVATION", reason: REASON, after: { role: "STOREKEEPER" } });
    expect(JSON.stringify(audit)).not.toContain(ADMIN_PASSWORD);
    expect((await db.notification.findMany({ where: { userId: ids.emp, title: { contains: "Таны эрх" } } })).length).toBe(1);
    expect((await db.notification.findMany({ where: { userId: ids.admin2, title: { contains: "Эрх олгох" } } })).length).toBe(1);
    expect(await db.notification.count({ where: { userId: ids.admin, title: { contains: "Эрх олгох" } } })).toBe(0);
    await context.close();
  });

  test("an account whose password an admin issued and its owner has not changed is refused with a clear message", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin), ADMIN_PASSWORD);
    await openEditor(page, NAMES.issued);
    await dialog(page).locator("select").first().selectOption("DIRECTOR");
    await dialog(page).getByRole("button", { name: "Хадгалах" }).click();
    const grant = grantDialog(page);
    await grant.getByLabel(/Эрх олгох шалтгаан/).fill(REASON);
    await grant.getByRole("checkbox").check();
    await grant.getByLabel("Таны өөрийн нууц үг").fill(ADMIN_PASSWORD);
    await grant.getByRole("button", { name: "Эрх олгох", exact: true }).click();
    await expect(grant.getByTestId("grant-error")).toContainText("нууц үгээ");
    await expect(grant.getByTestId("grant-error")).toContainText("солино уу");
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.issued } })).role).toBe("EMPLOYEE");
    await context.close();
  });

  test("creating a user with a privileged role shows the reason and confirmation inline and keeps the button off until they are filled", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin2), ADMIN_PASSWORD);
    await page.goto("/admin");
    await page.getByRole("button", { name: /Шинэ хэрэглэгч/ }).first().click();
    await expect(page.getByTestId("create-grant")).toHaveCount(0); // EMPLOYEE: nothing extra
    await page.getByPlaceholder("И-мэйл").fill(`agpw-${TAG}-new@test.local`);
    await page.getByPlaceholder("Овог, нэр").fill(`Шинэ Нярав ${TAG}`);
    await dialog(page).locator("select").first().selectOption("STOREKEEPER");
    await expect(page.getByTestId("create-grant")).toBeVisible();
    await page.getByLabel(/Таны өөрийн нууц үг/).fill(ADMIN_PASSWORD);
    const submit = page.getByRole("button", { name: "Үүсгэх", exact: true });
    await expect(submit).toBeDisabled();
    await page.getByTestId("create-grant").getByLabel(/Эрх олгох шалтгаан/).fill(REASON);
    await expect(submit).toBeDisabled();
    await page.getByTestId("create-grant").getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("dialog", { name: "Түр нууц үг" })).toBeVisible();
    const created = await db.user.findUniqueOrThrow({ where: { email: `agpw-${TAG}-new@test.local` } });
    expect(created.role).toBe("STOREKEEPER");
    expect(await db.auditLog.count({ where: { entityType: "AuthorityGrant", entityId: created.id } })).toBe(1);
    await context.close();
  });

  test("naming a department head asks for the step-up; clearing the head does not", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin), ADMIN_PASSWORD);
    await page.goto("/admin");
    const row = page.locator("div", { hasText: `Цех ${TAG}` }).filter({ has: page.locator("select") }).last();
    await row.locator("select").selectOption(ids.boss);
    const grant = grantDialog(page);
    await grant.getByLabel(/Эрх олгох шалтгаан/).fill(REASON);
    await grant.getByRole("checkbox").check();
    await grant.getByLabel("Таны өөрийн нууц үг").fill(ADMIN_PASSWORD);
    await grant.getByRole("button", { name: "Эрх олгох", exact: true }).click();
    await expect(grantDialog(page)).toHaveCount(0);
    await expect.poll(async () => (await db.department.findUniqueOrThrow({ where: { id: dept } })).headId).toBe(ids.boss);

    await row.locator("select").selectOption("");
    await expect.poll(async () => (await db.department.findUniqueOrThrow({ where: { id: dept } })).headId).toBeNull();
    await expect(grantDialog(page)).toHaveCount(0); // no step-up for removing authority
    await context.close();
  });

  test("the API refuses a grant without the step-up even with a valid admin session", async ({ browser }) => {
    const { context, page } = await signIn(browser, email(ids.admin), ADMIN_PASSWORD);
    const bare = await page.request.patch(`/api/admin/users/${ids.boss}`, { data: { role: "DIRECTOR" } });
    expect(bare.status()).toBe(400);
    expect((await bare.json()).code).toBe("STEP_UP_REQUIRED");
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.boss } })).role).toBe("BOSS");
    await context.close();
  });

  for (const width of [390, 320]) {
    test(`the grant dialog fits ${width}px: no horizontal scroll, controls reachable`, async ({ browser }) => {
      const { context, page } = await signIn(browser, email(ids.admin2), ADMIN_PASSWORD, { width, height: 780 });
      await openEditor(page, NAMES.boss);
      await dialog(page).locator("select").first().selectOption("DIRECTOR");
      await dialog(page).getByRole("button", { name: "Хадгалах" }).click();
      const box = grantDialog(page);
      await expect(box.getByText("Эрх олгох шалтгаан")).toBeVisible();
      await noHorizontalScroll(page);
      const bounds = await box.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      for (const control of [box.getByLabel(/Эрх олгох шалтгаан/), box.getByRole("checkbox"), box.getByLabel("Таны өөрийн нууц үг"), box.getByRole("button", { name: "Болих" })]) {
        await control.scrollIntoViewIfNeeded();
        const cb = (await control.boundingBox())!;
        expect(cb.x + cb.width).toBeLessThanOrEqual(width + 1);
      }
      expect((await box.getByLabel("Таны өөрийн нууц үг").boundingBox())!.height).toBeGreaterThanOrEqual(43);
      await context.close();
    });
  }
});
