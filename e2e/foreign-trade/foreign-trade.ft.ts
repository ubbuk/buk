import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { scanOverflow } from "../helpers";

// Foreign trade, end to end in a real browser: the BOSS creates and sends an order, the MANAGER researches suppliers,
// records the choice and sends it to technical review, the chief engineer approves with a PIN (the operations director
// then finds the stage done), the finance director and the executive director approve, the finance department receives
// it. Also: who sees the menu entry, direct URL access, and the page on a phone.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

const P = "ftui-";
const PASSWORD = "Passw0rd-test";
const PIN = "2468";
const ids = { boss: `${P}boss`, mgr: `${P}mgr`, ops: `${P}ops`, eng: `${P}eng`, fin: `${P}fin`, exec: `${P}exec`, acct: `${P}acct`, emp: `${P}emp`, other: `${P}other-boss` };
const roles = { boss: "BOSS", mgr: "MANAGER", ops: "DIRECTOR", eng: "ENGINEERING", fin: "DIRECTOR", exec: "DIRECTOR", acct: "CHIEF_ACCOUNTANT", emp: "EMPLOYEE", other: "BOSS" } as const;
const positions = { OPERATIONS_DIRECTOR: ids.ops, ENGINEERING_CHIEF: ids.eng, FINANCE_DIRECTOR: ids.fin, EXECUTIVE_DIRECTOR: ids.exec } as const;
const email = (id: string) => `${id}@test.local`;
const ITEM = `Hydraulic pump ${Date.now().toString(36)}`;
let parked: string[] = [];
let orderId = "";

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const pinHash = await bcrypt.hash(PIN, 10);
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    const id = ids[key];
    await db.user.upsert({ where: { id }, update: { role: roles[key], isActive: true, passwordHash }, create: { id, email: email(id), name: `${key.toUpperCase()} ftui`, role: roles[key], passwordHash } });
  }
  for (const w of ["ops", "eng", "fin", "exec"] as const) {
    await db.approvalPinCredential.upsert({ where: { userId: ids[w] }, update: { pinHash, failedAttempts: 0, lockedUntil: null }, create: { userId: ids[w], pinHash } });
  }
  const existing = await db.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: Object.keys(positions) as never[] }, userId: { not: { startsWith: P } } } });
  parked = existing.map((e) => e.id);
  await db.approvalRoleAssignment.updateMany({ where: { id: { in: parked } }, data: { isActive: false } });
  await db.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await db.approvalRoleAssignment.createMany({ data: Object.entries(positions).map(([role, userId]) => ({ role: role as never, userId, isActive: true })) });
});

test.afterAll(async () => {
  await db.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await db.foreignTradeOrder.deleteMany({ where: { createdById: { startsWith: P } } });
  await db.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await db.approvalRoleAssignment.updateMany({ where: { id: { in: parked } }, data: { isActive: true } });
  await db.approvalPinCredential.deleteMany({ where: { userId: { startsWith: P } } });
  await db.user.deleteMany({ where: { id: { startsWith: P } } });
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

async function approveWithPin(page: Page) {
  await page.getByRole("button", { name: "Батлах" }).click();
  await page.getByPlaceholder("····").fill(PIN);
  await page.getByRole("button", { name: "Баталгаажуулах" }).click();
}

test.describe.configure({ mode: "serial" });

test("the menu entry is role based and a direct URL is refused", async ({ browser }) => {
  for (const [who, shown] of [["boss", true], ["mgr", true], ["ops", true], ["acct", true], ["emp", false]] as const) {
    const { context, page } = await as(browser, ids[who]);
    await page.getByRole("button", { name: "Модулиуд" }).click();
    await expect(page.getByRole("link", { name: "Гадаад худалдаа" })).toHaveCount(shown ? 1 : 0);
    await context.close();
  }
  const { context, page } = await as(browser, ids.emp);
  await page.goto("/foreign-trade");
  await expect(page).toHaveURL(/\/dashboard/);
  const res = await page.request.get("/api/foreign-trade");
  expect(res.status()).toBe(403);
  await context.close();
});

test("BOSS creates an order with an attachment and sends it to the MANAGER", async ({ browser }) => {
  const { context, page } = await as(browser, ids.boss);
  await page.goto("/foreign-trade");
  await page.getByRole("link", { name: /Шинэ захиалга/ }).click();
  await page.getByLabel("Барааны нэр").fill(ITEM);
  await page.getByLabel("Техникийн шаардлага").fill("250 bar, 40 l/min");
  await page.getByLabel("Тоо хэмжээ").fill("2");
  await page.locator("textarea").first().fill("Replacement of the worn pump on press no. 3");
  await page.locator('input[type="file"]').setInputFiles({ name: "spec.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.getByRole("button", { name: "MANAGER руу илгээх" }).click();
  await page.waitForURL(/\/foreign-trade\/(?!new)[^/]+$/);
  orderId = page.url().split("/").pop()!;
  await expect(page.getByText("Үнийн судалгаа (MANAGER)").first()).toBeVisible();
  await expect(page.getByText("spec.pdf")).toBeVisible();
  // the price research is not presented to the BOSS yet
  await expect(page.getByText("Үнийн судалгааг MANAGER танилцуулсны дараа")).toBeVisible();
  await context.close();
});

test("MANAGER records two suppliers, compares them, discusses, records the choice and sends it to technical review", async ({ browser }) => {
  const { context, page } = await as(browser, ids.mgr);
  await page.goto(`/foreign-trade/${orderId}`);
  for (const [name, country, price, days] of [["Shenzhen Hydro", "China", "1000", "30"], ["Bosch Rexroth", "Germany", "1400", "10"]]) {
    await page.getByRole("button", { name: /Нийлүүлэгч нэмэх/ }).click();
    await page.getByLabel("Нийлүүлэгчийн нэр").fill(name);
    await page.getByLabel("Улс").fill(country);
    await page.getByLabel("Үнэ", { exact: true }).fill(price);
    await page.getByLabel("Тээврийн зардал").fill("50");
    await page.getByLabel("Нийлүүлэх хугацаа").fill(days);
    await page.getByLabel("Баталгаат нөхцөл").fill("12 сар");
    await page.getByRole("button", { name: "Хадгалах" }).click();
    await expect(page.getByRole("table").getByText(name)).toBeVisible();
  }
  await expect(page.getByText("Хамгийн хурдан").first()).toBeVisible();

  // sending without a recorded supplier is not possible
  await expect(page.getByRole("button", { name: "Техникийн хяналтад илгээх" })).toBeDisabled();

  await page.getByRole("button", { name: "Цехийн даргад танилцуулах" }).click();
  await page.getByRole("button", { name: "Техникийн хяналтад танилцуулах" }).click();

  // discussion
  await page.getByLabel("Мессеж").fill("Shenzhen is cheaper, Bosch is faster. Thoughts?");
  await page.getByRole("button", { name: "Илгээх", exact: true }).click();
  await expect(page.getByText("Shenzhen is cheaper, Bosch is faster. Thoughts?")).toBeVisible();

  // record the choice (desktop table: the first "Сонгох")
  await page.getByRole("button", { name: "Сонгох" }).first().click();
  await page.getByLabel("Шийдвэрийн үндэслэл").fill("Agreed in the discussion: lowest total price");
  await page.getByRole("button", { name: "Бүртгэх" }).click();
  await expect(page.getByText("Сонгосон нийлүүлэгч:")).toBeVisible();

  await page.getByRole("button", { name: "Техникийн хяналтад илгээх" }).click();
  await expect(page.getByText("Техникийн хяналт (аль нэг нь)").first()).toBeVisible();
  await expect(page.getByText("Хүлээгдэж буй:")).toContainText("Ерөнхий инженер");
  await context.close();
});

test("BOSS now sees the research and the discussion, and answers", async ({ browser }) => {
  const { context, page } = await as(browser, ids.boss);
  await page.goto(`/foreign-trade/${orderId}`);
  await expect(page.getByText("Shenzhen is cheaper, Bosch is faster. Thoughts?")).toBeVisible();
  await expect(page.getByText("Bosch Rexroth").first()).toBeVisible();
  await page.getByLabel("Мессеж").fill("Go with the cheaper one, delivery time is fine");
  await page.getByRole("button", { name: "Илгээх", exact: true }).click();
  await expect(page.getByText("Go with the cheaper one")).toBeVisible();
  // BOSS cannot decide anything
  await expect(page.getByRole("button", { name: "Батлах" })).toHaveCount(0);
  await context.close();
});

test("technical review is an OR: the chief engineer approves with a PIN, the operations director finds it done", async ({ browser }) => {
  const ops = await as(browser, ids.ops);
  const eng = await as(browser, ids.eng);
  await ops.page.goto(`/foreign-trade/${orderId}`);
  await eng.page.goto(`/foreign-trade/${orderId}`);
  await expect(ops.page.getByText("Таны шийдвэр хүлээж байна")).toBeVisible();
  await expect(eng.page.getByText("Таны шийдвэр хүлээж байна")).toBeVisible();

  // a wrong PIN changes nothing
  await eng.page.getByRole("button", { name: "Батлах" }).click();
  await eng.page.getByPlaceholder("····").fill("0000");
  await eng.page.getByRole("button", { name: "Баталгаажуулах" }).click();
  await expect(eng.page.getByText("PIN буруу байна")).toBeVisible();
  await eng.page.getByPlaceholder("····").fill(PIN);
  await eng.page.getByRole("button", { name: "Баталгаажуулах" }).click();
  await expect(eng.page.getByText("Санхүү хариуцсан захирал").first()).toBeVisible();
  await expect(eng.page.getByText("Таны шийдвэр хүлээж байна")).toHaveCount(0);

  // the other position: stage done, its decision panel is gone (live update) and approving again is refused
  await ops.page.reload();
  await expect(ops.page.getByText("Таны шийдвэр хүлээж байна")).toHaveCount(0);
  const again = await ops.page.request.post(`/api/foreign-trade/${orderId}/decision`, { data: { action: "APPROVE", pin: PIN, expectedVersion: 1 } });
  expect(again.status()).toBeGreaterThanOrEqual(400);
  await ops.context.close();
  await eng.context.close();
});

test("finance director, executive director, then the finance department receives it", async ({ browser }) => {
  const fin = await as(browser, ids.fin);
  const exec = await as(browser, ids.exec);
  const acct = await as(browser, ids.acct);

  // the executive and the finance department cannot open it before their turn
  expect((await exec.page.request.get(`/api/foreign-trade/${orderId}`)).status()).toBe(404);
  expect((await acct.page.request.get(`/api/foreign-trade/${orderId}`)).status()).toBe(404);

  await fin.page.goto(`/foreign-trade/${orderId}`);
  await expect(fin.page.getByText("Таны шийдвэр хүлээж байна")).toBeVisible();
  await approveWithPin(fin.page);
  await expect(fin.page.getByText("Таны шийдвэр хүлээж байна")).toHaveCount(0);

  expect((await acct.page.request.get(`/api/foreign-trade/${orderId}`)).status()).toBe(404);
  await exec.page.goto(`/foreign-trade/${orderId}`);
  await expect(exec.page.getByText("Таны шийдвэр хүлээж байна")).toBeVisible();
  await approveWithPin(exec.page);
  await expect(exec.page.getByText("Батлагдсан — Санхүүгийн хэлтэст шилжсэн").first()).toBeVisible();

  await acct.page.goto(`/foreign-trade/${orderId}`);
  await expect(acct.page.getByText("Батлагдсан — Санхүүгийн хэлтэст шилжсэн").first()).toBeVisible();
  // the executive and the finance director never got discussion notices
  const notes = await db.notification.findMany({ where: { userId: { in: [ids.fin, ids.exec, ids.acct] }, type: "FOREIGN_TRADE_DISCUSSION" } });
  expect(notes).toHaveLength(0);
  await fin.context.close();
  await exec.context.close();
  await acct.context.close();
});

test("a stranger BOSS cannot read the order", async ({ browser }) => {
  const { context, page } = await as(browser, ids.other);
  expect((await page.request.get(`/api/foreign-trade/${orderId}`)).status()).toBe(404);
  await page.goto(`/foreign-trade/${orderId}`);
  await expect(page.getByText("Захиалга олдсонгүй").first()).toBeVisible();
  await context.close();
});

test("the pages fit a phone (390 px) without sideways scrolling", async ({ browser }) => {
  const { context, page } = await as(browser, ids.mgr, { width: 390, height: 844 });
  for (const path of ["/foreign-trade", `/foreign-trade/${orderId}`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const scan = await scanOverflow(page);
    expect(scan.pageScrollWidth, `${path} scrollWidth`).toBeLessThanOrEqual(scan.viewport + 1);
    expect(scan.offenders, `${path} offenders`).toEqual([]);
  }
  await page.screenshot({ path: "e2e/results-foreign-trade/phone-detail.png", fullPage: true });
  await context.close();

  const boss = await as(browser, ids.boss, { width: 390, height: 844 });
  await boss.page.goto("/foreign-trade/new");
  await boss.page.waitForLoadState("networkidle");
  const scan = await scanOverflow(boss.page);
  expect(scan.pageScrollWidth).toBeLessThanOrEqual(scan.viewport + 1);
  expect(scan.offenders).toEqual([]);
  await boss.context.close();
});
