import { expect, test } from "@playwright/test";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";
import { checkDialog, describe, scanOverflow } from "./helpers";

// Dialogs (never submitted) and the phone search overlay.
const WIDTHS = [320, 375, 430, 768];
const LONG = "Тоо хэмжээг тодруулж дахин илгээнэ үү, өндөр даралтын гидравлик цилиндрийн битүүмжлэл ".repeat(6);

for (const w of WIDTHS) {
  test.describe(`modals @${w}`, () => {
    test("approval dialogs on /requests/[id] (current approver)", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, "engineering.json"), viewport: { width: w, height: 760 } });
      const page = await ctx.newPage();
      await page.goto("/approvals", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      // list rows open the request via onRowClick (no <a>), so click the first row
      const row = page.locator("tbody tr").first();
      await row.waitFor({ timeout: 10_000 }).catch(() => {});
      test.skip(!(await row.isVisible()), "no request pending for this approver");
      await row.click();
      await page.waitForURL(/\/requests\/[^/]+$/, { timeout: 15_000 });
      await page.waitForTimeout(1500);

      // material detail dialog
      await page.locator("tbody button.underline").first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect((await checkDialog(page)).problems).toEqual([]);
      await page.keyboard.press("Escape");

      // return dialog with a very long reason typed in
      await page.getByRole("button", { name: "Буцаах" }).first().click();
      await page.locator('[role="dialog"] textarea').fill(LONG);
      expect((await checkDialog(page)).problems).toEqual([]);
      await page.keyboard.press("Escape");

      // PIN dialog (partial PIN only, never confirmed)
      await page.getByRole("button", { name: "Батлах" }).first().click();
      await page.locator('[role="dialog"] input[type="password"]').fill("12");
      expect((await checkDialog(page)).problems).toEqual([]);
      const res = await scanOverflow(page);
      expect(res.offenders, describe(res)).toEqual([]);
      await ctx.close();
    });

    test("admin create-user dialog", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, "admin.json"), viewport: { width: w, height: 760 } });
      const page = await ctx.newPage();
      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /Шинэ хэрэглэгч/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect((await checkDialog(page)).problems).toEqual([]);
      await ctx.close();
    });

    test("mobile search overlay", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, "employee.json"), viewport: { width: w, height: 760 } });
      const page = await ctx.newPage();
      await page.goto("/requests", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: "Хайх" }).click();
      const dlg = page.getByRole("dialog", { name: "Хайлт" });
      await expect(dlg).toBeVisible();
      await expect(dlg.locator("input")).toBeFocused();
      const box = (await dlg.boundingBox())!;
      expect(box.x).toBeCloseTo(0, 0);
      expect(box.width).toBeCloseTo(w, 0);
      await dlg.locator("input").fill("Гагн");
      await expect(dlg.getByText("Материал", { exact: true })).toBeVisible({ timeout: 10_000 });
      const res = await scanOverflow(page);
      expect(res.offenders, describe(res)).toEqual([]);
      await page.screenshot({ path: `e2e/screenshots/search/search-${w}.png` });
      await page.keyboard.press("Escape");
      await expect(dlg).toHaveCount(0);

      // picking a result uses the existing handler (navigation) and closes the overlay
      await page.getByRole("button", { name: "Хайх" }).click();
      await dlg.locator("input").fill("Гагн");
      await dlg.getByRole("button").filter({ hasText: "Гагн" }).first().click();
      await expect(page).toHaveURL(/\/requests\/new\?material=/);
      await expect(dlg).toHaveCount(0);
      await ctx.close();
    });
  });
}

test("search icon is hidden on desktop, inline search shown", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, "employee.json"), viewport: { width: 1024, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("/requests", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Хайх" })).toBeHidden();
  await expect(page.getByPlaceholder("Захиалга, материал хайх...")).toBeVisible();
  await ctx.close();
});
