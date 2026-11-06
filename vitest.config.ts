import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "e2e/**"],
    // Every test file shares one isolated database and several suites count rows
    // across the whole table (monitoring queries, history reconstruction), so files
    // must not run at the same time.
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15000,
  },
});
