import { defineConfig, devices } from "@playwright/test";

// Login regression on WebKit (iPhone Safari engine). The auth endpoint is mocked,
// so no database, seed or real credentials are involved.
export default defineConfig({
  testDir: "./e2e/login",
  testMatch: "**/*.wk.ts",
  timeout: 60_000,
  reporter: [["list"]],
  outputDir: "e2e/results-login",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001", ...devices["iPhone 13"], ...(process.env.E2E_BROWSER === "chromium" ? { browserName: "chromium" as const, defaultBrowserType: "chromium" as const } : {}) },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npx next dev -p 3001", url: "http://localhost:3001/login", reuseExistingServer: true, timeout: 180_000 },
});
