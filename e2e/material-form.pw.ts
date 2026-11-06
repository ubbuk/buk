import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";
import { describe, heightFor, scanOverflow, smallTargets, VIEWPORTS } from "./helpers";

// "Шинэ захиалга": desktop keeps the table, phones get one card per material.
// The form is filled in but never submitted / saved.
test.use({ storageState: path.join(AUTH_DIR, "employee.json") });

const LONG = "Өндөр даралтын гидравлик цилиндрийн битүүмжлэлийн комплект усны эсэргүүцэлтэй хүнд даацын ".repeat(2);

async function open(page: Page) {
  await page.goto("/requests/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /Мөр нэмэх/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
}

for (const w of VIEWPORTS) {
  const phone = w <= 1024; // cards up to and including 1024px
  test.describe(`form @${w}`, () => {
    test.use({ viewport: { width: w, height: heightFor(w) } });

    test("layout, many rows, long names, dropdown", async ({ page }) => {
      await open(page);

      // table <-> cards swap
      await expect(page.locator("table.hud-table")).toHaveCount(phone ? 0 : 1);
      await expect(page.getByRole("list", { name: "Захиалах материалууд" })).toHaveCount(phone ? 1 : 0);

      // add rows (logic: same addRow handler on both layouts)
      for (let i = 0; i < 5; i++) await page.getByRole("button", { name: /Мөр нэмэх/ }).click();
      const nameInputs = page.locator('input[role="combobox"]');
      await expect(nameInputs).toHaveCount(6);

      // long free-text name + numbers -> totals computed
      await nameInputs.first().fill(LONG);
      await page.keyboard.press("Escape");
      const qty = phone ? page.locator('input[id^="m-qty-"]') : page.getByLabel("Тоо хэмжээ");
      const price = phone ? page.locator('input[id^="m-price-"]') : page.getByLabel("Нэгж үнэ");
      await qty.first().fill("3");
      await price.first().fill("1500");
      await expect(page.getByText("4,500", { exact: false }).first()).toBeVisible();

      // dropdown open on the last row (near the bottom / keyboard area)
      await nameInputs.last().scrollIntoViewIfNeeded();
      await nameInputs.last().click();
      const list = page.getByRole("listbox");
      await expect(list).toBeVisible();
      const box = (await list.boundingBox())!;
      const vv = page.viewportSize()!;
      expect(box.x, "dropdown left edge").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "dropdown right edge").toBeLessThanOrEqual(vv.width + 0.5);
      expect(box.y, "dropdown top").toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, "dropdown bottom").toBeLessThanOrEqual(vv.height + 0.5);

      // the open dropdown must not collide with the fixed bottom nav
      if (w < 768) {
        const nav = (await page.locator("nav.fixed").boundingBox())!;
        expect(box.y + box.height, "dropdown overlaps bottom nav").toBeLessThanOrEqual(nav.y + 0.5);
      }

      const res = await scanOverflow(page);
      await page.screenshot({ path: `e2e/screenshots/form/form-${w}.png` });
      expect(res.offenders, describe(res)).toEqual([]);
      expect(res.pageScrollWidth).toBeLessThanOrEqual(res.viewport);
    });

    test("add / delete / validation parity", async ({ page }) => {
      await open(page);
      const del = page.getByRole("button", { name: /-р мөрийг устгах/ });
      await expect(del.first()).toBeDisabled(); // single row can't be removed
      await page.getByRole("button", { name: /Мөр нэмэх/ }).click();
      await expect(del).toHaveCount(2);
      await del.nth(1).click();
      await expect(del).toHaveCount(1);
      if (phone) {
        // every card shows balance, unit, qty, unit price, total, note and delete
        const card = page.getByRole("list", { name: "Захиалах материалууд" }).locator("li").first();
        for (const t of ["Агуулахын үлдэгдэл", "Хэмжих нэгж", "Тоо хэмжээ", "Нэгж үнэ", "Бүгд үнэ", "Тайлбар"]) {
          await expect(card.getByText(t, { exact: false }).first()).toBeVisible();
        }
        await expect(card.getByRole("button", { name: /устгах/ })).toBeVisible();
        const small = await smallTargets(page, "ul[aria-label]");
        expect(small.filter((s) => !s.startsWith("input")), "touch targets <44px in cards").toEqual([]);
      }
    });
  });
}
