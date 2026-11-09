import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { expect, test, type Browser } from "@playwright/test";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

const TAG = Date.now().toString(36);
const PASSWORD = "Passw0rd-throttle";
const ids = { victim: `thre2e-${TAG}-victim`, other: `thre2e-${TAG}-other` };
const email = (id: string) => `${id}@test.local`;
const ADDRESS_A = "203.0.113.11"; // the "attacker"
const ADDRESS_B = "203.0.113.22"; // the real user
const WRONG_MSG = "И-мэйл эсвэл нууц үг буруу байна";
const LIMITED_MSG = "Хэт олон удаа оролдлоо";

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const id of Object.values(ids)) {
    await db.user.upsert({ where: { id }, update: { passwordHash, isActive: true }, create: { id, email: email(id), name: id, role: "EMPLOYEE", passwordHash } });
  }
  await db.loginThrottle.deleteMany();
});
test.afterAll(async () => {
  await db.loginThrottle.deleteMany();
  await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await db.$disconnect();
});

async function client(browser: Browser, address: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": address } });
  return { context, page: await context.newPage() };
}
async function submit(page: Awaited<ReturnType<typeof client>>["page"], who: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email(who));
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
}

test.describe.serial("login rate limiting", () => {
  test("5 wrong passwords, then the limit message even for the right password; the real user from another address is not affected", async ({ browser }) => {
    const attacker = await client(browser, ADDRESS_A);
    for (let i = 0; i < 5; i++) {
      await submit(attacker.page, ids.victim, "wrong-password");
      await expect(attacker.page.locator("p.lg-error")).toHaveText(WRONG_MSG);
    }
    await submit(attacker.page, ids.victim, "wrong-password");
    await expect(attacker.page.locator("p.lg-error")).toContainText(LIMITED_MSG);
    await submit(attacker.page, ids.victim, PASSWORD); // the right password is refused too while limited
    await expect(attacker.page.locator("p.lg-error")).toContainText(LIMITED_MSG);
    await expect(attacker.page).toHaveURL(/\/login/);

    const owner = await client(browser, ADDRESS_B);
    await submit(owner.page, ids.victim, PASSWORD);
    await owner.page.waitForURL(/\/dashboard/);
    await owner.context.close();
    await attacker.context.close();
  });

  test("an unknown e-mail is limited the same way (the page does not reveal who exists)", async ({ browser }) => {
    const c = await client(browser, "203.0.113.33");
    const ghost = `thre2e-${TAG}-ghost`;
    for (let i = 0; i < 5; i++) {
      await submit(c.page, ghost, "x");
      await expect(c.page.locator("p.lg-error")).toHaveText(WRONG_MSG);
    }
    await submit(c.page, ghost, "x");
    await expect(c.page.locator("p.lg-error")).toContainText(LIMITED_MSG);
    await c.context.close();
  });

  test("a normal login is unchanged and clears the failure counters", async ({ browser }) => {
    const c = await client(browser, "203.0.113.44");
    await submit(c.page, ids.other, "oops");
    await expect(c.page.locator("p.lg-error")).toHaveText(WRONG_MSG);
    await submit(c.page, ids.other, PASSWORD);
    await c.page.waitForURL(/\/dashboard/);
    // the failed attempt was counted, then the success cleared this account's pair and account buckets
    const rows = await db.loginThrottle.findMany({ where: { key: { startsWith: "login:" } } });
    expect(rows.some((r) => r.key.startsWith("login:pair:") && r.count === 0)).toBe(true);
    expect(rows.some((r) => r.key.startsWith("login:acct:") && r.count === 0)).toBe(true);
    await c.context.close();
  });

  test("/api/me/password: 5 wrong current passwords are 401, then 429; the right one is refused while limited", async ({ browser }) => {
    const c = await client(browser, "203.0.113.55");
    await submit(c.page, ids.other, PASSWORD);
    await c.page.waitForURL(/\/dashboard/);
    const change = (current: string) =>
      c.page.request.post("/api/me/password", { data: { currentPassword: current, newPassword: "Another-pw-9", confirmPassword: "Another-pw-9" } });
    for (let i = 0; i < 5; i++) expect((await change("wrong")).status()).toBe(401);
    const blocked = await change(PASSWORD);
    expect(blocked.status()).toBe(429);
    expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
    // the password was not changed: the old one still logs in (from another address)
    const again = await client(browser, "203.0.113.66");
    await submit(again.page, ids.other, PASSWORD);
    await again.page.waitForURL(/\/dashboard/);
    await again.context.close();
    await c.context.close();
  });
});
