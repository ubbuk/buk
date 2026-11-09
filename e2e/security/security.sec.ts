import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { expect, test, type Browser } from "@playwright/test";

// Stage 2 and 4 plus direct URLs in a real browser: direct URLs, revoked sessions, password change signing out, and that the
// administrator grants authority DIRECTLY (own password + reason + confirmation, no second approval).
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

const TAG = Date.now().toString(36);
const PW = "Passw0rd-sec";
const ids = { admin: `sec-${TAG}-admin`, emp: `sec-${TAG}-emp`, emp2: `sec-${TAG}-emp2`, target: `sec-${TAG}-target`, acct: `sec-${TAG}-acct` };
const NAMES = { admin: `Админ ${TAG}`, emp: `Ажилтан ${TAG}`, emp2: `Хоёр ${TAG}`, target: `Хүлээн авагч ${TAG}`, acct: `Нягтлан ${TAG}` };
const email = (id: string) => `${id}@test.local`;
const REASON = "Тушаал №12-ын дагуу шинэ албан тушаалд томилсон";
let ipCounter = 0;
const nextIp = () => `198.19.${150 + Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

test.beforeAll(async () => {
  const hash = await bcrypt.hash(PW, 10);
  const mk = (key: keyof typeof ids, role: "ADMIN" | "EMPLOYEE" | "CHIEF_ACCOUNTANT") => db.user.create({ data: { id: ids[key], email: email(ids[key]), name: NAMES[key], role, passwordHash: hash } });
  await mk("admin", "ADMIN");
  await mk("emp", "EMPLOYEE");
  await mk("emp2", "EMPLOYEE");
  await mk("target", "EMPLOYEE");
  await mk("acct", "CHIEF_ACCOUNTANT");
  await db.loginThrottle.deleteMany();
});
test.afterAll(async () => {
  await db.loginThrottle.deleteMany();
  const all = Object.values(ids);
  await db.notification.deleteMany({ where: { userId: { in: all } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: all } }, { entityId: { in: all } }] } });
  await db.user.deleteMany({ where: { id: { in: all } } });
  await db.$disconnect();
});

async function signIn(browser: Browser, id: string, password = PW) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": nextIp() } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email(id));
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
  await page.waitForURL(/\/dashboard/);
  return { context, page };
}

test.describe.serial("direct URLs", () => {
  test("no session: every page and API answer is a sign-in / 401, never content", async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": nextIp() } });
    const page = await context.newPage();
    for (const path of ["/admin", "/requests", "/profile", "/procurement", "/admin/monitoring"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
    for (const path of ["/api/requests", "/api/admin/users", "/api/notifications"]) {
      const res = await page.request.get(path);
      expect([401, 403], path).toContain(res.status());
    }
    await context.close();
  });

  test("an ordinary employee typing a privileged URL lands on the dashboard; the API refuses too", async ({ browser }) => {
    const { context, page } = await signIn(browser, ids.emp);
    for (const path of ["/admin", "/accounting", "/procurement"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/dashboard/);
    }
    expect((await page.request.get("/api/admin/users")).status()).toBe(403);
    expect((await page.request.post("/api/admin/users", { data: { email: "x@test.local", name: "X", role: "BOSS", adminPassword: "x" } })).status()).toBe(403);
    await context.close();
  });

  test("an accountant reaches /accounting by URL; the administrator reaches /admin", async ({ browser }) => {
    const acct = await signIn(browser, ids.acct);
    await acct.page.goto("/accounting");
    await expect(acct.page).toHaveURL(/\/accounting/);
    await acct.context.close();
    const admin = await signIn(browser, ids.admin);
    await admin.page.goto("/admin");
    await expect(admin.page).toHaveURL(/\/admin$/);
    await admin.context.close();
  });
});

test.describe.serial("session revocation", () => {
  test("a session revoked in the database meets the login page on its next load and a 401 from the API", async ({ browser }) => {
    const { context, page } = await signIn(browser, ids.emp2);
    expect((await page.request.get("/api/notifications")).status()).toBe(200);
    await db.user.update({ where: { id: ids.emp2 }, data: { sessionVersion: { increment: 1 } } });
    // the server keeps the account view for a few seconds
    await expect.poll(async () => (await page.request.get("/api/notifications")).status(), { timeout: 15000 }).toBe(401);
    await page.goto("/requests");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("deactivating and re-activating an account does not bring an old session back", async ({ browser }) => {
    const { context, page } = await signIn(browser, ids.emp2);
    await db.user.update({ where: { id: ids.emp2 }, data: { isActive: false, sessionVersion: { increment: 1 } } });
    await expect.poll(async () => (await page.request.get("/api/notifications")).status(), { timeout: 15000 }).toBe(401);
    await db.user.update({ where: { id: ids.emp2 }, data: { isActive: true } });
    await new Promise((r) => setTimeout(r, 6000));
    expect((await page.request.get("/api/notifications")).status()).toBe(401);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
    const fresh = await signIn(browser, ids.emp2); // a new sign-in works
    await fresh.context.close();
  });

  test("changing the password in Settings signs every session out, this one included; the new password signs in again", async ({ browser }) => {
    const { context, page } = await signIn(browser, ids.emp);
    const other = await signIn(browser, ids.emp); // a second device
    await page.goto("/settings");
    // the first three password fields on the page are the password form (current, new, repeat)
    const fields = page.locator('input[type="password"]');
    await fields.nth(0).fill(PW);
    await fields.nth(1).fill("Changed-pw-123");
    await fields.nth(2).fill("Changed-pw-123");
    await page.getByRole("button", { name: "Нууц үг солих", exact: true }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect.poll(async () => (await other.page.request.get("/api/notifications")).status(), { timeout: 15000 }).toBe(401);
    await context.close();
    await other.context.close();
    const again = await signIn(browser, ids.emp, "Changed-pw-123");
    await again.context.close();
  });
});

test.describe.serial("granting authority is direct (own password + reason + confirmation, no second approval)", () => {
  test("the administrator changes a role to STOREKEEPER in one step; a wrong password changes nothing", async ({ browser }) => {
    const admin = await signIn(browser, ids.admin);
    await admin.page.goto("/admin");
    await admin.page.getByPlaceholder("Хэрэглэгч хайх...").fill(NAMES.target);
    await admin.page.getByRole("button", { name: `${NAMES.target}-ийг засах` }).click();
    await admin.page.getByRole("dialog").locator("select").first().selectOption("STOREKEEPER");
    await admin.page.getByRole("dialog").getByRole("button", { name: "Хадгалах" }).click();
    const grant = admin.page.getByRole("dialog", { name: /олгохыг баталгаажуулах/ });
    await grant.getByLabel(/Эрх олгох шалтгаан/).fill(REASON);
    await grant.getByRole("checkbox").check();
    await grant.getByLabel("Таны өөрийн нууц үг").fill("wrong-admin-password");
    await grant.getByRole("button", { name: "Эрх олгох", exact: true }).click();
    await expect(grant.getByTestId("grant-error")).toContainText("Нууц үг буруу байна");
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.target } })).role).toBe("EMPLOYEE");
    await grant.getByLabel("Таны өөрийн нууц үг").fill(PW);
    await grant.getByRole("button", { name: "Эрх олгох", exact: true }).click();
    await expect(grant).toHaveCount(0, { timeout: 15000 });
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.target } })).role).toBe("STOREKEEPER");
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "AuthorityGrant", entityId: ids.target } });
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ grantKind: "ROLE_ELEVATION", reason: REASON });
    await admin.context.close();
  });

  test("the API refuses a grant without the step-up, with a valid administrator session", async ({ browser }) => {
    const admin = await signIn(browser, ids.admin);
    const bare = await admin.page.request.patch(`/api/admin/users/${ids.emp}`, { data: { role: "BOSS" } });
    expect(bare.status()).toBe(400);
    expect((await bare.json()).code).toBe("STEP_UP_REQUIRED");
    await admin.context.close();
  });

  test("the ADMIN role is not offered for new users and the API refuses it", async ({ browser }) => {
    const admin = await signIn(browser, ids.admin);
    await admin.page.goto("/admin");
    await admin.page.getByRole("button", { name: /Шинэ хэрэглэгч/ }).first().click();
    const options = await admin.page.getByRole("dialog").locator("select").first().locator("option").allTextContents();
    expect(options.join("|")).not.toMatch(/Админ|ADMIN|Системийн админ/i);
    const res = await admin.page.request.post("/api/admin/users", { data: { email: `adm-${TAG}@test.local`, name: "X", role: "ADMIN", adminPassword: PW, reason: REASON, confirmed: true } });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe("ADMIN_ROLE_LOCKED");
    await admin.context.close();
  });
});
