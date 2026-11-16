import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";
import { describe, scanOverflow } from "./helpers";

// Санхүү → Агуулах: нярвын бүлэг → 1С склад → бараа мод. Өгөгдөл ба 1С-ийн шинэчлэлтийг хуурамчаар (route) өгдөг тул DB-ээс хамаарахгүй,
// зөвхөн унших. Мод барих логик (lib/onec/stock-tree.test.ts) ба API (dashboard.test.ts) нь тусдаа тестэд.
test.use({ storageState: path.join(AUTH_DIR, "director.json") });

const item = (n: number, code: string, amount: number) => ({
  id: `${code}-${n}`,
  warehouse_code: code,
  warehouse: "",
  item_code: `ITEM-${code}-${n}`,
  item: `Бараа ${code} №${n} урт нэртэй материал`,
  unit: "ш",
  account: "1411",
  qty: n % 7 === 0 ? -2 : 12.5,
  amount,
  unit_cost: 1000,
});
const rowsOf = (code: string, count: number) => Array.from({ length: count }, (_, i) => item(i + 1, code, (count - i) * 1000));
const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);

const BIG = rowsOf("00-BIG", 120);
const SMALL = rowsOf("00-SMALL", 3);
const FIN = rowsOf("00-FIN", 2);
const BLANK = rowsOf("", 4).map((r) => ({ ...r, account: "1418", warehouse_code: "" }));

const w = (key: string, name: string, keeper: { id: string; name: string } | null, rows: typeof BIG, reservable = true) => ({ key, name, keeper, reservable, items: rows.length, amount: sum(rows), rows });
const KEEPER = { id: "k1", name: "Тест Нярав" };

const RESPONSE = {
  date: "2026-11-16",
  totals: { items: 129, warehouses: 3, amount: sum(BIG) + sum(SMALL) + sum(FIN) + sum(BLANK), negative_rows: 17 },
  groups: [
    { key: "g1", name: "Бүлэг нэг", kind: "group", keeper: KEEPER, items: 123, amount: sum(BIG) + sum(SMALL), accounts: [], warehouses: [w("00-BIG", "Олон мөртэй склад", KEEPER, BIG), w("00-SMALL", "Жижиг склад", KEEPER, SMALL)] },
    { key: "g2", name: "Бэлэн бүтээгдэхүүн (нөөцлөхгүй)", kind: "group", keeper: null, items: 2, amount: sum(FIN), accounts: [], warehouses: [w("00-FIN", "Бэлэн бүтээгдэхүүний склад", null, FIN, false)] },
    { key: "none", name: "Агуулах тодорхойгүй", kind: "unknown", keeper: null, items: 4, amount: sum(BLANK), accounts: ["1418"], warehouses: [w("none", "Агуулах тодорхойгүй", null, BLANK)] },
  ],
  filters: {
    keepers: [KEEPER],
    hasUnassigned: true,
    warehouses: [
      { code: "00-BIG", name: "Олон мөртэй склад", group: "Бүлэг нэг" },
      { code: "00-SMALL", name: "Жижиг склад", group: "Бүлэг нэг" },
      { code: "00-FIN", name: "Бэлэн бүтээгдэхүүний склад", group: "Бэлэн бүтээгдэхүүн (нөөцлөхгүй)" },
    ],
    hasUnknown: true,
  },
  truncated: false,
  lastSyncedAt: "2026-11-16T05:00:00.000Z",
};

/** API-г хуурамчаар хариулж, хүсэлтийн URL-уудыг цуглуулна; 1С-ийн шинэчлэлтийг (POST refresh) «саяхан» гэж хаана */
async function mockApi(page: Page) {
  const requests: URL[] = [];
  await page.route("**/api/dashboard/stock?**", (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: RESPONSE });
  });
  await page.route("**/api/dashboard/refresh", (route) => route.fulfill({ json: { status: "recent", lastSyncedAt: RESPONSE.lastSyncedAt, retryAfterSeconds: 30 } }));
  return requests;
}

const open = async (page: Page, url = "/finance/stock") => {
  const requests = await mockApi(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("stock-tree")).toBeVisible();
  return requests;
};

test("анхдагчаар бүгд хураастай; бүлэг → склад → бараа задарна; нярвын нэр, нөөцлөхгүй тэмдэг, тодорхойгүй бүлэг хамгийн доор", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);

  const groups = page.getByTestId("stock-group");
  await expect(groups).toHaveCount(3);
  await expect(page.getByTestId("stock-warehouse")).toHaveCount(0); // хураастай
  await expect(groups.last()).toContainText("Агуулах тодорхойгүй (1418 данс)");
  await expect(groups.last()).toHaveAttribute("data-kind", "unknown");

  // бүлэг бүрт барааны тоо, дүн, нярав (нэр өгөгдлөөс); оноогоогүй бол «Нярав оноогоогүй»
  await expect(groups.first()).toContainText("Бүлэг нэг");
  await expect(groups.first()).toContainText("Нярав: Тест Нярав");
  await expect(groups.first()).toContainText("123 бараа");
  await expect(groups.nth(1)).toContainText("Нярав оноогоогүй");

  await groups.first().getByRole("button", { name: /Бүлэг нэг/ }).click();
  await expect(groups.first().getByTestId("stock-warehouse")).toHaveCount(2);
  const big = groups.first().getByTestId("stock-warehouse").first();
  await expect(big).toContainText("Олон мөртэй склад");
  await expect(big).toContainText("Нярав: Тест Нярав");
  await expect(big).toContainText("120 бараа");

  await groups.nth(1).getByRole("button", { name: /Бэлэн бүтээгдэхүүн/ }).click();
  await expect(groups.nth(1)).toContainText("Нөөцлөхгүй");

  // хоёр дахь удаа дарахад хураагдана
  await groups.first().getByRole("button", { name: /Бүлэг нэг/ }).click();
  await expect(groups.first().getByTestId("stock-warehouse")).toHaveCount(0);
});

test("олон мөртэй склад: эхлээд 50 мөр, «Дахиад харуулах»-аар нэмэгдэнэ; дүнгээр буурахаар", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const group = page.getByTestId("stock-group").first();
  await group.getByRole("button", { name: /Бүлэг нэг/ }).click();
  const big = group.getByTestId("stock-warehouse").first();
  await big.getByRole("button", { name: /Олон мөртэй склад/ }).click();

  const rows = big.locator("li");
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toContainText("№1 "); // хамгийн их дүн эхэнд
  await big.getByRole("button", { name: /Дахиад харуулах \(70 үлдсэн\)/ }).click();
  await expect(rows).toHaveCount(100);
  await big.getByRole("button", { name: /Дахиад харуулах \(20 үлдсэн\)/ }).click();
  await expect(rows).toHaveCount(120);
  await expect(big.getByRole("button", { name: /Дахиад харуулах/ })).toHaveCount(0);
});

test("шүүлтүүд URL-д хадгалагдаж, API-д дамжиж, дахин ачаалахад сэргэнэ", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const requests = await open(page);

  await page.getByLabel("Нярав", { exact: true }).selectOption("k1");
  await expect(page).toHaveURL(/keeper=k1/);
  await page.getByLabel("Склад", { exact: true }).selectOption("00-SMALL");
  await expect(page).toHaveURL(/wh=00-SMALL/);
  await page.getByLabel("Барааны нэр эсвэл кодоор хайх").fill("цемент");
  await expect(page).toHaveURL(/q=%D1%86%D0%B5%D0%BC%D0%B5%D0%BD%D1%82/); // 300 мс-ийн дараа
  await expect.poll(() => requests.at(-1)?.searchParams.get("q")).toBe("цемент");
  expect(requests.at(-1)!.searchParams.get("keeper")).toBe("k1");
  expect(requests.at(-1)!.searchParams.get("warehouse")).toBe("00-SMALL");

  // хайлт идэвхтэй үед таарсан хэсгүүд нээлттэй
  await expect(page.getByTestId("stock-warehouse").first()).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Барааны нэр эсвэл кодоор хайх")).toHaveValue("цемент");
  await expect(page.getByLabel("Нярав", { exact: true })).toHaveValue("k1");
  await expect(page.getByLabel("Склад", { exact: true })).toHaveValue("00-SMALL");

  await page.getByRole("button", { name: "Шүүлт арилгах" }).click();
  await expect(page).not.toHaveURL(/q=|keeper=|wh=/);
  await expect(page.getByLabel("Нярав", { exact: true })).toHaveValue("");
});

for (const width of [320, 390, 768]) {
  test(`утсан дээр уншигдахуйц: бүгд задарсан үед хэвтээ гүйлт, халилт байхгүй @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width >= 768 ? 1024 : 800 });
    await open(page);
    for (const g of await page.getByTestId("stock-group").all()) {
      await g.getByRole("button").first().click();
      for (const wh of await g.getByTestId("stock-warehouse").all()) await wh.getByRole("button").first().click();
    }
    await expect(page.getByTestId("stock-warehouse").first().locator("li").first()).toBeVisible();

    const res = await scanOverflow(page);
    expect(res.pageScrollWidth, describe(res)).toBeLessThanOrEqual(res.viewport);
    expect(res.offenders, describe(res)).toEqual([]);

    // толгойн хоёр тал (нэр, дүн) харагдана: дүн хуудасны баруун ирмэгээс гарахгүй
    const amount = page.getByTestId("stock-group").first().getByRole("button").first().locator("span.tabular-nums").first();
    const box = (await amount.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
  });
}
