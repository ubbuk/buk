import { expect, test } from "@playwright/test";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";
import { describe, heightFor, scanOverflow, smallFontInputs, VIEWPORTS } from "./helpers";

// Static pages reachable by the admin account (sees every nav entry).
const PAGES = [
  "/dashboard",
  "/requests",
  "/approvals",
  "/warehouses",
  "/archive",
  "/reports",
  "/settings",
  "/procurement",
  "/accounting",
  "/admin",
  "/admin/audit",
  "/admin/monitoring",
  "/admin/monitoring/time-machine",
];

test.use({ storageState: path.join(AUTH_DIR, "admin.json") });

for (const w of VIEWPORTS) {
  test.describe(`viewport ${w}`, () => {
    test.use({ viewport: { width: w, height: heightFor(w) } });

    for (const url of PAGES) {
      test(`no horizontal overflow: ${url}`, async ({ page }, info) => {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(800); // let HUD / 3D panels lay out
        const res = await scanOverflow(page);
        await page.screenshot({ path: info.outputPath(`${url.replace(/\//g, "_")}-${w}.png`), fullPage: false });
        expect.soft(res.pageScrollWidth, `document scrolls horizontally\n${describe(res)}`).toBeLessThanOrEqual(res.viewport);
        expect(res.offenders, describe(res)).toEqual([]);
        if (w <= 430) expect.soft(await smallFontInputs(page), "inputs <16px zoom on iOS focus").toEqual([]);
      });
    }

    test("landscape-sized height does not break bottom nav / content", async ({ page }) => {
      test.skip(w > 430, "phones only");
      await page.setViewportSize({ width: Math.max(w, 640), height: w });
      await page.goto("/requests", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      const res = await scanOverflow(page);
      expect(res.offenders, describe(res)).toEqual([]);
    });
  });
}

test("every nav destination is reachable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dashboard");
  const nav = page.locator("nav.fixed");
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "Бусад" }).click();
  const hrefs = new Set<string>();
  for (const a of await nav.locator("a[href]").all()) hrefs.add((await a.getAttribute("href"))!);
  for (const h of ["/requests/new", "/requests", "/approvals", "/warehouses", "/archive", "/reports", "/settings", "/procurement", "/accounting", "/admin", "/admin/monitoring"]) {
    expect(hrefs, `missing ${h} in mobile nav`).toContain(h);
  }
  const res = await scanOverflow(page);
  expect(res.offenders, describe(res)).toEqual([]);
});
