import { defineConfig, devices } from "@playwright/test";

// Foreign trade UI flow against an app instance wired to the ISOLATED test database (name ending "_test"; the spec
// refuses anything else). The app is started by hand with explicit env, e.g.
//   DATABASE_URL=$TEST_DATABASE_URL NEXTAUTH_URL=http://localhost:3005 NEXTAUTH_SECRET=local-test npx next start -p 3005
// Nothing here starts a server, seeds, resets or migrates. E2E_CHANNEL=msedge uses the installed Edge when Playwright's
// bundled Chromium cannot launch.
export default defineConfig({
  testDir: "./e2e/foreign-trade",
  testMatch: "**/*.ft.ts",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "e2e/results-foreign-trade",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3005",
    ...devices["Desktop Chrome"],
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
    trace: "retain-on-failure",
  },
});
