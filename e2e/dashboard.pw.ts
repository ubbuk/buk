import { expect, test } from "@playwright/test";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";
import { describe, scanOverflow } from "./helpers";

// Dashboard "Сүүлийн захиалгууд" and the shared DataTable: cards on phones, table from 768px.
test.use({ storageState: path.join(AUTH_DIR, "admin.json") });

for (const w of [320, 375, 390, 430, 440, 768, 1024, 1440]) {
  const phone = w < 768;
  test(`dashboard @${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: w >= 1024 ? 900 : 956 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const res = await scanOverflow(page);
    expect(res.pageScrollWidth, describe(res)).toBeLessThanOrEqual(res.viewport);
    expect(res.offenders, describe(res)).toEqual([]);

    if (phone) {
      await expect(page.locator(".dh-table table")).toHaveCount(0);
      const cards = page.locator(".dh-table ul > li");
      expect(await cards.count()).toBeGreaterThan(0);
      for (const box of await cards.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; }))) {
        expect(box.l).toBeGreaterThanOrEqual(0);
        expect(box.r).toBeLessThanOrEqual(w);
      }
      // quick-link tiles: two columns, all inside the viewport, >= 44px tall
      const tiles = page.locator("a.min-h-11");
      for (const t of await tiles.all()) {
        const b = (await t.boundingBox())!;
        expect(b.x + b.width).toBeLessThanOrEqual(w + 0.5);
        expect(b.height).toBeGreaterThanOrEqual(43.5);
      }
      // the floating truck button would cover the tiles; it is desktop-only (bottom nav has "Шинэ захиалга")
      await expect(page.locator("div.fixed.right-2.top-16")).toBeHidden();
    } else {
      await expect(page.locator(".dh-table table")).toHaveCount(1);
      await expect(page.locator(".dh-table ul > li")).toHaveCount(0);
    }
  });
}

for (const w of [375, 1024]) {
  test(`admin users DataTable @${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    if (w < 768) {
      await expect(page.locator("main table")).toHaveCount(0);
      expect(await page.locator("main ul > li").count()).toBeGreaterThan(0);
    } else {
      await expect(page.locator("main table")).toHaveCount(1);
    }
    const res = await scanOverflow(page);
    expect(res.offenders, describe(res)).toEqual([]);
  });
}
