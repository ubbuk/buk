import { defineConfig } from "@playwright/test";

// Modal audit against an app instance that is wired to the ISOLATED test database
// (ubbuk_procurement_test on 127.0.0.1:5434). The app is started by hand with explicit env
// (see e2e/testdb/guard.ts); nothing here starts a server, seeds, resets or migrates.
// The specs open dialogs and type into them but never press a submit/approve/return/save button.
export default defineConfig({
  testDir: "./e2e/testdb",
  testMatch: "**/*.tdb.ts",
  globalSetup: "./e2e/testdb/global-setup.ts",
  timeout: 150_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "e2e/results-testdb",
  use: { baseURL: "http://localhost:3003", browserName: "chromium", trace: "off" },
});
