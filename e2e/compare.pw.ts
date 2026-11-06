import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";
import { scanOverflow } from "./helpers";

// Before/after screenshots + overflow numbers. Needs two running builds:
//   E2E_BEFORE_URL (baseline) and E2E_BASE_URL (current). Opt-in: set E2E_COMPARE=1.
const BEFORE = process.env.E2E_BEFORE_URL;
const OUT = path.join(__dirname, "screenshots", "compare");
const SHOTS: { name: string; url: string; role: "admin" | "employee" }[] = [
  { name: "new-order", url: "/requests/new", role: "employee" },
  { name: "dashboard", url: "/dashboard", role: "admin" },
  { name: "requests", url: "/requests", role: "admin" },
  { name: "admin", url: "/admin", role: "admin" },
  { name: "monitoring", url: "/admin/monitoring", role: "admin" },
];
test.skip(!process.env.E2E_COMPARE || !BEFORE, "set E2E_COMPARE=1 and E2E_BEFORE_URL");
fs.mkdirSync(OUT, { recursive: true });
const rows: string[] = [];

for (const w of [375, 1440]) {
  for (const s of SHOTS) {
    test(`compare ${s.name} @${w}`, async ({ browser }) => {
      for (const [label, base] of [["before", BEFORE!], ["after", process.env.E2E_BASE_URL!]] as const) {
        const ctx = await browser.newContext({
          baseURL: base,
          viewport: { width: w, height: w >= 1024 ? 900 : 800 },
          storageState: path.join(AUTH_DIR, `${s.role}.json`),
        });
        const page = await ctx.newPage();
        await page.goto(s.url, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const r = await scanOverflow(page);
        await page.screenshot({ path: path.join(OUT, `${s.name}-${w}-${label}.png`) });
        rows.push(`${s.name}@${w} ${label}: scrollWidth=${r.pageScrollWidth} viewport=${r.viewport} offenders=${r.offenders.length}`);
        await ctx.close();
      }
    });
  }
}
test.afterAll(() => fs.writeFileSync(path.join(OUT, "summary.txt"), rows.join("\n")));
