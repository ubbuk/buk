import { expect, test } from "@playwright/test";
import path from "node:path";
import { resolveNavItems } from "../lib/nav";
import { AUTH_DIR, ROLES, type RoleKey } from "./global-setup";
import { describe, scanOverflow } from "./helpers";

// Every role's own navigation plus the dynamic pages it can reach, at phone/tablet widths.
// Read-only: pages are opened, nothing is submitted.
const ROLE_ENUM: Record<RoleKey, string> = {
  admin: "ADMIN",
  employee: "EMPLOYEE",
  boss: "BOSS",
  director: "DIRECTOR",
  manager: "MANAGER",
  storekeeper: "STOREKEEPER",
  engineering: "ENGINEERING",
  accountant: "CHIEF_ACCOUNTANT",
};
const WIDTHS = [320, 390, 768];

for (const role of Object.keys(ROLES) as RoleKey[]) {
  test.describe(`role ${role}`, () => {
    test.use({ storageState: path.join(AUTH_DIR, `${role}.json`) });

    for (const w of WIDTHS) {
      test(`pages @${w}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: w >= 768 ? 1024 : 800 });
        const urls = ["/dashboard", ...resolveNavItems(ROLE_ENUM[role]).map((i) => i.href)];

        // dynamic pages: follow the first real link on the list pages
        const dynamic: string[] = [];
        for (const [list, prefix] of [
          ["/requests", "/requests/"],
          ["/approvals", "/requests/"],
          ["/procurement", "/procurement/"],
          ["/archive", "/requests/"],
        ] as const) {
          if (!urls.includes(list)) continue;
          await page.goto(list, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1500);
          const hrefs = await page.locator(`a[href^="${prefix}"]`).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
          const first = hrefs.find((h) => !h.endsWith("/new") && !h.includes("?"));
          if (first && !dynamic.includes(first)) dynamic.push(first);
        }

        const failures: string[] = [];
        const seen: string[] = [];
        for (const url of [...new Set([...urls, ...dynamic])]) {
          await page.goto(url, { waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(700);
          const res = await scanOverflow(page);
          seen.push(url);
          if (res.pageScrollWidth > res.viewport || res.offenders.length) failures.push(`${url}\n${describe(res)}`);
        }
        test.info().annotations.push({ type: "pages", description: seen.join(" ") });
        if (!dynamic.some((d) => d.startsWith("/procurement/"))) {
          test.info().annotations.push({ type: "not-covered", description: "no /procurement/[id] link visible" });
        }
        expect(failures, failures.join("\n\n")).toEqual([]);
      });
    }
  });
}
