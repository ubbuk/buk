// Safety guard: the tests upsert/create rows (including overwriting seeded
// approvers' PIN hashes) and never clean up, so they must never run against
// the real ERP database. They only run against TEST_DATABASE_URL, and only if
// that database's name ends in "_test".
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Tests refuse to run against DATABASE_URL (the real database). " +
      "Start the isolated DB: docker compose -p ubbuk-test -f docker-compose.test.yml up -d"
  );
}

const dbName = new URL(testUrl).pathname.replace(/^\//, "");
if (!dbName.endsWith("_test")) {
  throw new Error(`TEST_DATABASE_URL must point to a database whose name ends in "_test" (got "${dbName}").`);
}

// Prisma reads DATABASE_URL; an already-set env var wins over .env.
process.env.DATABASE_URL = testUrl;

// Attachment tests write real files through lib/storage.ts; keep them out of
// the real ERP's .storage directory.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.LOCAL_STORAGE_ROOT = mkdtempSync(path.join(tmpdir(), "ubbuk-test-storage-"));
