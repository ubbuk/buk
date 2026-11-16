import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";
import { describe, scanOverflow } from "./helpers";

// Санхүү → Зарцуулалт: таб (материал / хэлтэс / агуулах), эхний 10 + «Үлдсэн N», нийтийн %, URL-д таб ба хайлт, өдрийн график (өнөөдөр хүртэл +
// өмнөх сар), KPI-ийн ↑↓ %. API-г хуурамчаар (route) хариулдаг тул 1С, DB-ээс хамаарахгүй, зөвхөн унших.
test.use({ storageState: path.join(AUTH_DIR, "director.json") });

const nowUb = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" });
const ym = nowUb.slice(0, 7);
const todayDay = Number(nowUb.slice(8, 10));
const daysInMonth = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();

// 25 материал: дүн нь буурах (1-р нь хамгийн их). Нийт = 25 * 26 / 2 * 1000 = 325,000
const MATERIALS = Array.from({ length: 25 }, (_, i) => ({ key: `m${i + 1}`, name: `Материал ${String(i + 1).padStart(2, "0")}`, unit: "ш", quantity: 10 + i, amount: (25 - i) * 1000, documents: 2 }));
const TOTAL = MATERIALS.reduce((s, m) => s + m.amount, 0);
const DEPARTMENTS = [
  { name: "Цех А", amount: 200_000, documents: 5 },
  { name: "Цех Б", amount: 125_000, documents: 3 },
];
const KEEPER = { id: "k1", name: "Тест Нярав" };
const WAREHOUSES = [
  { key: "00-A1", name: "Склад А1", group: "Бүлэг нэг", keeper: KEEPER, mapped: true, amount: 200_000, documents: 5 },
  { key: "00-B1", name: "Склад Б1", group: "Бүлэг хоёр", keeper: null, mapped: true, amount: 100_000, documents: 2 },
  { key: "name:Гадаад склад", name: "Гадаад склад", group: null, keeper: null, mapped: false, amount: 25_000, documents: 1 },
];
const DAILY = Array.from({ length: daysInMonth }, (_, i) => ({ date: `${ym}-${String(i + 1).padStart(2, "0")}`, amount: (i + 1) * 100, previous: (i + 1) * 60 }));

const RESPONSE = {
  month: ym,
  totals: { amount: TOTAL, documents: 8, materials: MATERIALS.length },
  byMaterial: MATERIALS,
  byDepartment: DEPARTMENTS,
  byWarehouse: WAREHOUSES,
  daily: DAILY,
  comparison: { prevMonth: "2026-10", throughDay: todayDay, amount: 216_667, documents: 6, changePct: 50, documentsChangePct: -12.5 },
  documents: [{ id: "d1", number: "00-1", date: `${ym}-01T00:00:00`, department: "Цех А", warehouse: "Склад А1", warehouseCode: "00-A1", recipient: "", purpose: "Засвар", amount: 1000 }],
  meta: { fetchedAt: new Date().toISOString(), cached: false, stale: false, retryAfterSeconds: null },
};

async function open(page: Page, url = "/finance/usage") {
  await page.route("**/api/dashboard/usage?**", (route) => route.fulfill({ json: RESPONSE }));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ranked-rows")).toBeVisible();
}

test("таб: Материалаар нь анхдагч; эхний 10 мөр ба «Үлдсэн N (дүн)» хураасан; нийтийн % ба баганан график", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);

  await expect(page.getByRole("tab", { name: /Материалаар \(25\)/ })).toHaveAttribute("aria-selected", "true");
  const rows = page.getByTestId("ranked-row");
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText("Материал 01");
  await expect(rows.first()).toContainText("7.7%"); // 25000 / 325000
  await expect(rows.first().getByRole("img", { name: /Нийтийн 7\.7%/ })).toBeVisible();

  // үлдсэн 15 нь нэг хураасан мөр: 15 материалын дүн = 120,000 (1+2+...+15)
  const rest = page.getByTestId("ranked-rest");
  await expect(rest).toContainText("Үлдсэн 15");
  await expect(rest).toContainText("120,000₮");
  await rest.getByRole("button").click();
  await expect(rows).toHaveCount(25);
  await expect(rows.last()).toContainText("Материал 25");
  await rest.getByRole("button").click();
  await expect(rows).toHaveCount(10);
});

test("Агуулахаар таб: 1С склад → нярвын бүлэг ба нярав; нярав оноогоогүй, ERP-д холбогдоогүй; URL-д хадгалагдана", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await page.getByRole("tab", { name: /Агуулахаар/ }).click();
  await expect(page).toHaveURL(/tab=warehouse/);

  const rows = page.getByTestId("ranked-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Склад А1");
  await expect(rows.nth(0)).toContainText("Бүлэг нэг");
  await expect(rows.nth(0)).toContainText("Нярав: Тест Нярав");
  await expect(rows.nth(1)).toContainText("Нярав оноогоогүй");
  await expect(rows.nth(2)).toContainText("ERP-д холбогдоогүй");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: /Агуулахаар/ })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: /Хэлтэс, цехээр/ }).click();
  await expect(page).toHaveURL(/tab=dept/);
  await expect(page.getByTestId("ranked-row").first()).toContainText("Цех А");
  await page.getByRole("tab", { name: /Материалаар/ }).click();
  await expect(page).not.toHaveURL(/tab=/); // анхдагч таб URL-д байхгүй
});

test("хайлт БҮХ мөрөөс (эхний 10-аас гадуурхаас ч) хайж, анхны эрэмбийн дугаараа хадгална; URL-д хадгалагдана", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await page.getByRole("searchbox", { name: "Материал, хэлтэс, агуулах хайх" }).fill("Материал 20");
  await expect(page).toHaveURL(/q=%D0%9C%D0%B0%D1%82%D0%B5%D1%80%D0%B8%D0%B0%D0%BB(\+|%20)20/);
  const rows = page.getByTestId("ranked-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Материал 20");
  await expect(rows.first()).toContainText("20"); // эрэмбийн дугаар 20 (эхний 10-д ордоггүй)
  await expect(page.getByTestId("ranked-rows")).toContainText("Таарсан 1 мөр (25-аас)");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("searchbox", { name: "Материал, хэлтэс, агуулах хайх" })).toHaveValue("Материал 20");
  await expect(page.getByTestId("ranked-row")).toHaveCount(1);

  await page.getByRole("button", { name: "Хайлт арилгах" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.getByTestId("ranked-row")).toHaveCount(10);

  await page.getByRole("searchbox", { name: "Материал, хэлтэс, агуулах хайх" }).fill("байхгүй нэр");
  await expect(page.getByText("Хайлтад тохирох мөр олдсонгүй")).toBeVisible();
});

test("KPI: өмнөх сарын мөн үетэй харьцуулсан % (↑↓) ба тайлбар", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await expect(page.getByText("+50.0%")).toBeVisible();
  await expect(page.getByText("-12.5%")).toBeVisible();
  await expect(page.getByText(`Өмнөх сарын 1–${todayDay}-той харьцуулахад`).first()).toBeVisible();
});

test("өдрийн график: одоогийн сард өнөөдөр хүртэлх өдөр л, өмнөх сарын ижил өдрүүдтэй (саарал) харьцуулна", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const chart = page.locator("svg[role=img]").filter({ has: page.locator("rect[fill^='url(']") }).first();
  await expect(page.getByText("Өмнөх сар", { exact: true })).toBeVisible(); // legend
  // өдөр бүр хоёр багана (энэ сар + өмнөх сар), зөвхөн өнөөдөр хүртэл
  await expect(chart.locator("rect[fill^='url(']")).toHaveCount(todayDay * 2);
});

for (const width of [320, 390, 768]) {
  test(`утсан дээр уншигдахуйц: бүгд задарсан үед халилт, хэвтээ гүйлт байхгүй @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width >= 768 ? 1024 : 800 });
    await open(page);
    await page.getByTestId("ranked-rest").getByRole("button").click();
    await expect(page.getByTestId("ranked-row")).toHaveCount(25);
    const res = await scanOverflow(page);
    expect(res.pageScrollWidth, describe(res)).toBeLessThanOrEqual(res.viewport);
    expect(res.offenders, describe(res)).toEqual([]);

    await page.getByRole("tab", { name: /Агуулах/ }).click(); // нарийн дэлгэц дээр богино нэр
    await expect(page.getByTestId("ranked-row")).toHaveCount(3);
    // гурван таб бүгд дэлгэцэн дотор, нэр нь тасрахгүй (нэг мөрөнд)
    for (const tab of await page.getByRole("tab").all()) {
      const b = (await tab.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
      expect(b.height).toBeLessThan(48);
    }
    const res2 = await scanOverflow(page);
    expect(res2.pageScrollWidth, describe(res2)).toBeLessThanOrEqual(res2.viewport);
    expect(res2.offenders, describe(res2)).toEqual([]);
  });
}
