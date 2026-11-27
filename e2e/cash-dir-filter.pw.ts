import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";

// Мөнгөн хөрөнгө → «Бүх гүйлгээ»: чиглэлийн шүүлтүүр (Бүгд / Орсон / Гарсан / Шилжүүлэг), ?dir= URL, нийт, хайлттай хамт, утсанд нэг мөр.
// Зөвхөн унших; ажиллаж буй апп + бодит өгөгдөл шаардана.
test.use({ storageState: path.join(AUTH_DIR, "admin.json"), isMobile: true, hasTouch: true, viewport: { width: 360, height: 844 } });

const group = (p: Page) => p.getByTestId("cash-dir-filter");
const total = (p: Page) => p.getByTestId("cash-dir-total");
const btn = (p: Page, name: string) => group(p).getByRole("button", { name, exact: true });
const rawCount = async (p: Page) => Number(((await total(p).innerText()).match(/(\d+) гүйлгээ/) ?? [])[1]);
/** Ачаалж дууссаны дараах тоо: жагсаалт «loading» (opacity-60) биш, хоёр удаа дараалан ижил */
async function countOf(p: Page) {
  let prev = -1;
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(400);
    const loading = await p.locator("#cash-entries ul.opacity-60").count();
    const c = await rawCount(p);
    if (!loading && c === prev) return c;
    prev = c;
  }
  return prev;
}

async function open(page: Page, qs = "") {
  await page.goto(`/finance/cash${qs}`, { waitUntil: "networkidle" }).catch(() => undefined);
  await expect(group(page)).toBeVisible({ timeout: 60_000 });
  await expect(total(page)).toBeVisible({ timeout: 60_000 });
}

test("товчнууд нэг мөрөнд багтана, хуудас хэвтээ гүйхгүй; анхдагч Бүгд", async ({ page }) => {
  await open(page);
  const boxes = await Promise.all(["Бүгд", "Орсон", "Гарсан", "Шилжүүлэг"].map((n) => btn(page, n).boundingBox()));
  const ys = boxes.map((b) => Math.round(b!.y));
  expect(new Set(ys).size, `нэг мөр биш: ${ys}`).toBe(1);
  for (const b of boxes) expect(b!.x + b!.width).toBeLessThanOrEqual(360);
  await expect(btn(page, "Бүгд")).toHaveAttribute("aria-pressed", "true");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  // «Бүх гүйлгээ» гарчиг, нийт нь тасрахгүй
  const t = await total(page).boundingBox();
  expect(t!.x + t!.width).toBeLessThanOrEqual(360);
  expect(await total(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test("Орсон: ногоон «+», нийт «Орсон: N гүйлгээ · +…», URL ?dir=in", async ({ page }) => {
  await open(page);
  await btn(page, "Орсон").click();
  await expect(page).toHaveURL(/[?&]dir=in(&|$)/);
  await expect(total(page)).toContainText("Орсон:");
  await expect.poll(async () => (await total(page).innerText()).includes("+")).toBe(true);
  const row = page.locator("#cash-entries li button[aria-expanded] > span[role=button]").first();
  if (await row.count()) {
    await expect(row).toHaveClass(/text-success/);
    expect((await row.innerText()).trim().startsWith("+")).toBe(true);
  }
});

test("Гарсан: улаан «−»; Шилжүүлэг: тэмдэггүй; Бүгд: ?dir алга болно", async ({ page }) => {
  await open(page);
  const all = await countOf(page);
  await btn(page, "Гарсан").click();
  await expect(page).toHaveURL(/[?&]dir=out(&|$)/);
  await expect(total(page)).toContainText("Гарсан:");
  await expect.poll(async () => /[−-]/.test(await total(page).innerText())).toBe(true);
  const row = page.locator("#cash-entries li button[aria-expanded] > span[role=button]").first();
  if (await row.count()) {
    await expect(row).toHaveClass(/text-danger/);
    expect(/^[−-]/.test((await row.innerText()).trim())).toBe(true);
  }
  await btn(page, "Шилжүүлэг").click();
  await expect(page).toHaveURL(/[?&]dir=transfer(&|$)/);
  await expect(total(page)).toContainText("Шилжүүлэг:");
  expect(await total(page).innerText()).not.toMatch(/[+−]\d/);
  await btn(page, "Бүгд").click();
  await expect(page).not.toHaveURL(/dir=/);
  expect(await countOf(page)).toBe(all);
});

test("?dir=out-аар шууд нээхэд Гарсан сонгогдсон; Орсон + Гарсан ≠ шилжүүлэг; хайлттай хамт нийт өөрчлөгдөнө", async ({ page }) => {
  await open(page, "?dir=out");
  await expect(btn(page, "Гарсан")).toHaveAttribute("aria-pressed", "true");
  await expect(total(page)).toContainText("Гарсан:");
  const out = await countOf(page);
  await btn(page, "Орсон").click();
  await expect(total(page)).toContainText("Орсон:");
  const inn = await countOf(page);
  await btn(page, "Бүгд").click();
  await expect(total(page)).not.toContainText(":");
  expect(await countOf(page)).toBe(inn + out);
  // хайлт + шүүлтүүр: хайлт нь Орсон дотроос л шүүнэ
  await btn(page, "Орсон").click();
  await expect(total(page)).toContainText("Орсон:");
  await page.getByLabel("Гүйлгээ хайх").fill("ХХК");
  await expect.poll(async () => (await total(page).innerText()).includes("Орсон:")).toBe(true);
  expect(await countOf(page)).toBeLessThanOrEqual(inn);
});
