import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { checkDialog, describe, scanOverflow } from "../helpers";
import { TESTDB_AUTH_DIR } from "./guard";

// Dialogs that need procurement / accounting data. Dialogs are opened and typed into, never submitted.
const WIDTHS = [320, 375, 430, 768];
const LONG = "Өндөр даралтын гидравлик цилиндрийн битүүмжлэлийн комплект усны эсэргүүцэлтэй хүнд даацын шалтгаан ".repeat(5);
const auth = (role: string) => path.join(TESTDB_AUTH_DIR, `${role}.json`);

async function dialogOk(page: Page) {
  await expect(page.getByRole("dialog")).toBeVisible();
  const d = await checkDialog(page);
  expect(d.problems, d.problems.join("\n")).toEqual([]);
  const res = await scanOverflow(page);
  expect(res.offenders, describe(res)).toEqual([]);
}

for (const w of WIDTHS) {
  test.describe(`test-DB dialogs @${w}`, () => {
    test("accounting dialog (chief accountant)", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: auth("accountant"), viewport: { width: w, height: 760 } });
      const page = await ctx.newPage();
      await page.goto("/accounting", { waitUntil: "domcontentloaded" });
      const btn = page.getByRole("button", { name: "Бүртгэх" }).first();
      await btn.waitFor({ timeout: 20_000 });
      await btn.click();
      await dialogOk(page);
      const fields = page.locator('[role="dialog"] input[type="text"], [role="dialog"] textarea');
      if (await fields.count()) await fields.last().fill(LONG);
      await dialogOk(page);
      await ctx.close();
    });

    test("procurement detail dialog (admin monitoring)", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: auth("admin"), viewport: { width: w, height: 760 } });
      const page = await ctx.newPage();
      await page.goto("/admin/monitoring", { waitUntil: "domcontentloaded" });
      const btn = page.getByRole("button", { name: "Дэлгэрэнгүй" }).first();
      await btn.waitFor({ timeout: 30_000 }).catch(() => {});
      test.skip(!(await btn.isVisible()), "no procurement rows with a detail button in this data set");
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await dialogOk(page);
      await ctx.close();
    });

    test("procurement handover dialog (admin)", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: auth("admin"), viewport: { width: w, height: 760 } });
      const page = await ctx.newPage();
      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      const btn = page.getByRole("button", { name: "Дуусаагүй ажлыг шилжүүлэх" }).first();
      await btn.waitFor({ timeout: 20_000 }).catch(() => {});
      test.skip(!(await btn.isVisible()), "no procurement-position row on /admin in this data set");
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await dialogOk(page);
      await ctx.close();
    });

    test("/procurement/[id] page and any enabled dialog (manager)", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: auth("manager"), viewport: { width: w, height: 760 } });
      const page = await ctx.newPage();
      await page.goto("/procurement", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const href = await page.locator('a[href^="/procurement/"]').first().getAttribute("href", { timeout: 5000 }).catch(() => null);
      test.skip(!href, "no /procurement/[id] link visible to this manager");
      await page.goto(href!, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const res = await scanOverflow(page);
      expect(res.offenders, describe(res)).toEqual([]);

      // open whichever dialog trigger is enabled (they stay disabled when no procurement manager is configured)
      let opened = 0;
      for (const name of ["Ангилал баталгаажуулах", "Худалдан авалтыг дуусгах", "Дахин хуваарилах", "Засах", "Хүчингүй болгох"]) {
        const b = page.getByRole("button", { name }).first();
        if ((await b.count()) && (await b.isEnabled())) {
          await b.scrollIntoViewIfNeeded();
          await b.click();
          await dialogOk(page);
          await page.keyboard.press("Escape");
          opened++;
        }
      }
      test.info().annotations.push({ type: "dialogs-opened", description: String(opened) });
      await ctx.close();
    });
  });
}
