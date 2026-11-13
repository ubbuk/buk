import { chromium, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { assertTestDatabaseOnly, TESTDB_AUTH_DIR } from "./guard";

// Existing seeded demo accounts that exist in the test DB. Logs in through the real login
// form (no bypass). If a login fails we stop: no password is reset or created.
export const TESTDB_ROLES = {
  admin: "admin@ubbuk.mn",
  manager: "tuvshin@ubbuk.mn",
  accountant: "nomintuya@ubbuk.mn",
} as const;

export default async function globalSetup(config: FullConfig) {
  assertTestDatabaseOnly();
  const baseURL = config.projects[0].use.baseURL!;
  const password = process.env.E2E_PASSWORD ?? "ubbuk2026";
  fs.mkdirSync(TESTDB_AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  for (const [role, email] of Object.entries(TESTDB_ROLES)) {
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    } catch {
      await browser.close();
      throw new Error(`Login as ${email} failed on the test-DB instance; stopping (no password is reset or created).`);
    }
    await ctx.storageState({ path: path.join(TESTDB_AUTH_DIR, `${role}.json`) });
    await ctx.close();
  }
  await browser.close();
}
