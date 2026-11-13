import path from "node:path";

export const TESTDB_AUTH_DIR = path.join(__dirname, "..", ".auth-testdb");
export const TESTDB_BASE_URL = "http://localhost:3003";

// Refuses to run unless every database URL visible to this process names the isolated
// test database on the local test container. The app instance under test must have been
// started with the same values (checked separately via pg_stat_activity before running).
export function assertTestDatabaseOnly() {
  const problems: string[] = [];
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const raw = process.env[name];
    if (!raw) {
      problems.push(`${name} is not set (must point at the test DB)`);
      continue;
    }
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      problems.push(`${name} is not a valid URL`);
      continue;
    }
    const db = u.pathname.replace(/^\//, "");
    if (!db.endsWith("_test")) problems.push(`${name} database "${db}" does not end with _test`);
    if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port !== "5434") problems.push(`${name} host:port ${u.hostname}:${u.port} is not 127.0.0.1:5434`);
  }
  if (process.env.E2E_BASE_URL && process.env.E2E_BASE_URL !== TESTDB_BASE_URL) problems.push(`E2E_BASE_URL must be ${TESTDB_BASE_URL}`);
  for (const k of ["S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY_ID"]) if (process.env[k]) problems.push(`${k} must be unset (storage must be the local temp dir)`);
  if (process.env.STORAGE_DRIVER && process.env.STORAGE_DRIVER !== "local") problems.push("STORAGE_DRIVER must be local");
  if (problems.length) throw new Error("Test-DB guard refused to start:\n  - " + problems.join("\n  - "));
}
