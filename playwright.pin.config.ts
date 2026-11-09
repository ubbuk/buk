import { defineConfig, devices } from "@playwright/test";

// PIN setup / change / ADMIN reset in a real browser, against an app instance wired to the ISOLATED test
// database (name ending "_test"; the spec refuses anything else). Start the app by hand:
//   DATABASE_URL=$TEST_DATABASE_URL NEXTAUTH_URL=http://localhost:3004 NEXTAUTH_SECRET=local-test \
//   TRUSTED_PROXY=hops:1 npx next start -p 3004
// E2E_CHANNEL=msedge uses the installed Edge when Playwright's bundled Chromium cannot launch.
export default defineConfig({
  testDir: "./e2e/pin",
  testMatch: "**/*.pin.ts",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "e2e/results-pin",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3004",
    ...devices["Desktop Chrome"],
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
    trace: "retain-on-failure",
  },
});
