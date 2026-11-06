import { defineConfig } from "@playwright/test";

// Responsive audit. Runs against a locally started `next dev` on :3001 (or
// E2E_BASE_URL). It only reads: log in with an existing account, open pages,
// type into forms but never submit. Do not point it at staging/production.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 150_000,
  workers: 2,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],
  outputDir: "e2e/results",
  snapshotPathTemplate: "e2e/screenshots/{testFilePath}/{arg}{ext}",
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npx next dev -p 3001", url: `${baseURL}/login`, reuseExistingServer: true, timeout: 180_000 },
});
