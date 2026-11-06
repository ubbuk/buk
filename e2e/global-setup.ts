import { chromium, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Logs in through the real login form (no auth bypass) once per role and keeps the
// session cookies for the specs. Accounts are the existing seeded demo users;
// override with E2E_PASSWORD / E2E_<ROLE>_EMAIL. Nothing is created or changed.
export const ROLES = {
  admin: process.env.E2E_ADMIN_EMAIL ?? "admin@ubbuk.mn",
  employee: process.env.E2E_EMPLOYEE_EMAIL ?? "tumurbaatar@ubbuk.mn",
  boss: "bold@ubbuk.mn",
  director: "khuntsengel@ubbuk.mn",
  manager: "tuvshin@ubbuk.mn",
  storekeeper: "sarnai@ubbuk.mn",
  engineering: "narmandakh@ubbuk.mn",
  accountant: "nomintuya@ubbuk.mn",
} as const;
export type RoleKey = keyof typeof ROLES;
export const AUTH_DIR = path.join(__dirname, ".auth");

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const password = process.env.E2E_PASSWORD ?? "ubbuk2026";
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  for (const [role, email] of Object.entries(ROLES)) {
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
    await ctx.storageState({ path: path.join(AUTH_DIR, `${role}.json`) });
    await ctx.close();
  }
  await browser.close();
}
