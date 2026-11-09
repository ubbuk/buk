import { defineConfig, devices } from "@playwright/test";

// Session revocation, direct-URL access and direct (single-step) granting of authority in a real browser, against an app instance wired to the ISOLATED
// test database (name ending "_test"; the spec refuses anything else). Start it by hand:
//   DATABASE_URL=$TEST_DATABASE_URL NEXTAUTH_URL=http://localhost:3005 NEXTAUTH_SECRET=local-test \
//   TRUSTED_PROXY=hops:1 npx next start -p 3005
// (the older admin / auth / profile / pin suites run on port 3004 the same way).
// E2E_CHANNEL=msedge uses the installed Edge when Playwright bundled Chromium cannot launch.
export default defineConfig({
  testDir: "./e2e/security",
  testMatch: "**/*.sec.ts",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "e2e/results-security",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3005",
    ...devices["Desktop Chrome"],
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
    trace: "retain-on-failure",
  },
});
