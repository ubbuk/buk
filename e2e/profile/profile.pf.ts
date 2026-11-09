import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { expect, test, type Browser, type Page } from "@playwright/test";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

const TAG = Date.now().toString(36);
const PASSWORD = "Passw0rd-profile";
const dept = `pfe2e-dept-${TAG}`;
const ids = { emp: `pfe2e-${TAG}-emp`, other: `pfe2e-${TAG}-other`, admin: `pfe2e-${TAG}-admin`, long: `pfe2e-${TAG}-long` };
const LONG_NAME = "Дашдондогийн-Нэмэхбаяр-Оргилуун-Мөнхсайхан-Ганзориг-Цэрэндорж";
const LONG_EMAIL = `very.long.employee.address.for.layout.check.${TAG}@a-really-long-company-domain-name.example.org`;
const email = (id: string) => `${id}@test.local`;
let ipCounter = 0;
const nextIp = () => `198.18.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await db.department.create({ data: { id: dept, name: `Бетон цех ${TAG}`, type: "FACTORY" } });
  const mk = (id: string, data: Record<string, unknown>) =>
    db.user.create({ data: { id, email: email(id), name: id, role: "EMPLOYEE", passwordHash, ...data } as never });
  await mk(ids.emp, { name: "Б.Төмөрбаатар", title: "Ерөнхий инженер", departmentId: dept });
  await mk(ids.other, { name: "Г.Сарнай", title: "Нярав (нууц)", departmentId: dept });
  await mk(ids.admin, { name: "Системийн админ", role: "ADMIN", title: null });
  await mk(ids.long, { name: LONG_NAME, email: LONG_EMAIL, title: "Үйлдвэрийн хөгжлийн хэлтсийн ахлах мэргэжилтэн", departmentId: dept });
  await db.loginThrottle.deleteMany();
});
test.afterAll(async () => {
  await db.loginThrottle.deleteMany();
  await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await db.department.deleteMany({ where: { id: dept } });
  await db.$disconnect();
});

async function signIn(browser: Browser, who: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": nextIp() }, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(who === ids.long ? LONG_EMAIL : email(who));
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Нэвтрэх" }).click();
  await page.waitForURL(/\/dashboard/);
  return { context, page };
}
const field = (page: Page, label: string) => page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

test.describe("my profile", () => {
  test("an employee reaches their own profile from the user menu and sees their real data", async ({ browser }) => {
    const { context, page } = await signIn(browser, ids.emp);
    await page.getByRole("link", { name: "Миний профайл" }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("heading", { name: "Миний профайл" })).toBeVisible();
    await expect(field(page, "Нэр")).toHaveText("Б.Төмөрбаатар");
    await expect(field(page, "И-мэйл")).toHaveText(email(ids.emp));
    await expect(field(page, "Цех, тасаг")).toContainText(`Бетон цех ${TAG}`);
    await expect(field(page, "Албан тушаал")).toHaveText("Ерөнхий инженер");
    await expect(field(page, "Эрх")).toHaveText("Employee");
    await expect(field(page, "Бүртгэлийн төлөв")).toHaveText("Идэвхтэй");
    // nothing about anybody else, and no secrets, anywhere on the page
    const html = await page.content();
    for (const leak of ["Нярав (нууц)", "Г.Сарнай", "passwordHash", "$2b$"]) expect(html, leak).not.toContain(leak);
    await context.close();
  });

  test("the page cannot be pointed at somebody else: a userId in the URL or the API is ignored", async ({ browser }) => {
    const { context, page } = await signIn(browser, ids.emp);
    await page.goto(`/profile?userId=${ids.other}&id=${ids.other}`);
    await expect(field(page, "Нэр")).toHaveText("Б.Төмөрбаатар");
    const viaApi = await page.request.get(`/api/me/profile?userId=${ids.other}`);
    expect(viaApi.status()).toBe(200);
    expect((await viaApi.json()).name).toBe("Б.Төмөрбаатар");
    expect(viaApi.headers()["cache-control"]).toBe("private, no-store");
    // there is no per-user route at all
    expect((await page.request.get(`/api/me/profile/${ids.other}`)).status()).toBe(404);
    expect((await page.goto(`/profile/${ids.other}`))?.status()).toBe(404);
    await context.close();
  });

  test("ADMIN sees their own profile, not an employee profile, and cannot ask for one", async ({ browser }) => {
    const { context, page } = await signIn(browser, ids.admin);
    await page.goto("/profile");
    await expect(field(page, "Нэр")).toHaveText("Системийн админ");
    await expect(field(page, "Эрх")).toHaveText("Admin");
    await expect(field(page, "Албан тушаал")).toHaveText("Тодорхойгүй");
    await expect(field(page, "Цех, тасаг")).toHaveText("Оноогоогүй");
    const named = await (await page.request.get(`/api/me/profile?userId=${ids.emp}`)).json();
    expect(named.name).toBe("Системийн админ");
    expect(JSON.stringify(named)).not.toContain("Ерөнхий инженер");
    await context.close();
  });

  test("a signed-out visitor is sent to the login page and gets no profile data", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.get("/api/me/profile")).status()).toBe(401);
    await context.close();
  });

  test("the profile page makes exactly one profile request and the existing sidebar and menu are unchanged", async ({ browser }) => {
    const { context, page } = await signIn(browser, ids.emp);
    const seen: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/me/profile")) seen.push(r.url());
    });
    await page.goto("/profile");
    await expect(field(page, "Нэр")).toHaveText("Б.Төмөрбаатар");
    expect(seen).toHaveLength(1);
    // the only new entry point is the user menu: no extra navigation item was added anywhere else
    expect(await page.locator('a[href="/profile"]').count()).toBe(1);
    for (const href of ["/requests/new", "/requests", "/settings"]) expect(await page.locator(`a[href="${href}"]`).count(), href).toBeGreaterThan(0);
    await context.close();
  });
});

test.describe("mobile", () => {
  for (const width of [390, 375, 360, 320]) {
    test(`fits ${width}px: reachable with a 44px target, long name and e-mail wrap, no horizontal scroll`, async ({ browser }) => {
      const { context, page } = await signIn(browser, ids.long, { width, height: 780 });
      // 381px and wider: the user menu in the header. Narrower: the header has no room for another 44px control,
      // so the same link sits at the end of the "Модулиуд" menu.
      if (width <= 380) await page.getByRole("button", { name: "Модулиуд" }).click();
      const link = page.getByRole("link", { name: "Миний профайл" });
      await expect(link).toBeVisible();
      await expect(link).toHaveCount(1);
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await link.click();
      await expect(page).toHaveURL(/\/profile$/);
      await expect(field(page, "Нэр")).toHaveText(LONG_NAME);
      await expect(field(page, "И-мэйл")).toHaveText(LONG_EMAIL);
      await noHorizontalScroll(page);
      // nothing is clipped: every value fits inside its own box (wrapped, not cut off)
      const clipped = await page.evaluate(() => [...document.querySelectorAll("dd, h3")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      expect(clipped).toEqual([]);
      const card = await page.locator("dl").boundingBox();
      expect(card!.x + card!.width).toBeLessThanOrEqual(width);
      await context.close();
    });
  }
});
