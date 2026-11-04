import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Only the session lookup is replaced; authorization, reconstruction, storage
// (a throwaway local directory, see vitest.setup.ts) and the C++ engine run for
// real against the isolated test database.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as reconstructGET } from "./reconstruct/route";
import { GET as snapshotsGET, POST as snapshotsPOST } from "./snapshots/route";
import { POST as verifyPOST } from "./snapshots/[id]/verify/route";
import { POST as restorePOST } from "./snapshots/[id]/test-restore/route";

const P = "tm-r-";
const users = {
  admin: { id: `${P}admin`, role: "ADMIN" },
  director: { id: `${P}director`, role: "DIRECTOR" },
  employee: { id: `${P}employee`, role: "EMPLOYEE" },
};
const as = (u: { id: string; role: string } | null) => {
  session.current = u ? { user: { id: u.id, role: u.role, name: u.id, email: `${u.id}@t.local` } } : null;
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const get = (qs = "") => new Request(`http://localhost/api/admin/time-machine/reconstruct${qs}`);

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({ data: Object.values(users).map((u) => ({ id: u.id, email: `${u.id}@test.local`, name: u.id, role: u.role as never, passwordHash: "x", isActive: true })) });
});
afterAll(cleanup);

const NOW = () => new Date().toISOString();

describe("authorization", () => {
  it("401 without a session on every endpoint", async () => {
    as(null);
    expect((await reconstructGET(get(`?asOf=${NOW()}`))).status).toBe(401);
    expect((await snapshotsGET(get())).status).toBe(401);
    expect((await snapshotsPOST(post({ asOf: NOW() }))).status).toBe(401);
    expect((await verifyPOST(post({}), ctx("x"))).status).toBe(401);
    expect((await restorePOST(post({}), ctx("x"))).status).toBe(401);
  });

  it("403 for a signed-in user who is not ADMIN or DIRECTOR", async () => {
    as(users.employee);
    expect((await reconstructGET(get(`?asOf=${NOW()}`))).status).toBe(403);
    expect((await snapshotsGET(get())).status).toBe(403);
    expect((await snapshotsPOST(post({ asOf: NOW() }))).status).toBe(403);
    expect((await verifyPOST(post({}), ctx("x"))).status).toBe(403);
    expect((await restorePOST(post({}), ctx("x"))).status).toBe(403);
  });
});

describe("input validation", () => {
  it("rejects a missing, malformed or future asOf", async () => {
    as(users.admin);
    expect((await reconstructGET(get())).status).toBe(400);
    expect((await reconstructGET(get("?asOf=yesterday"))).status).toBe(400);
    expect((await reconstructGET(get("?asOf=2999-01-01T00:00:00Z"))).status).toBe(400);
    expect((await snapshotsPOST(post({ asOf: "2999-01-01T00:00:00Z" }))).status).toBe(400);
    expect((await snapshotsPOST(post({}))).status).toBe(400);
  });

  it("rejects a snapshot id that is not in the generated format", async () => {
    as(users.admin);
    expect((await verifyPOST(post({}), ctx("../../etc/passwd"))).status).toBe(400);
    expect((await restorePOST(post({}), ctx("..%2F..%2Fsecret"))).status).toBe(400);
  });

  it("404s on a well-formed id that does not exist", async () => {
    as(users.admin);
    expect((await verifyPOST(post({}), ctx("20200101T000000000Z_20200101T000000000Z_000000000000_00000000"))).status).toBe(404);
  });
});

describe("end to end: reconstruct -> snapshot -> verify -> test restore", () => {
  it("runs the whole workflow for a director and reports real results", async () => {
    as(users.director);
    const asOf = NOW();

    const rec = await reconstructGET(get(`?asOf=${asOf}`));
    expect(rec.status).toBe(200);
    const recBody = await rec.json();
    expect(recBody.kind).toBe("historical-reconstruction");
    expect(recBody.engine.kind).toBe("wasm");
    expect(recBody.limitations.join(" ")).toMatch(/not a PostgreSQL backup/i);
    expect(["complete", "incomplete"]).toContain(recBody.completeness.status);

    const created = await snapshotsPOST(post({ asOf }));
    expect(created.status).toBe(201);
    const manifest = await created.json();
    expect(manifest.notADatabaseBackup).toBe(true);
    expect(manifest.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.artifact.sizeBytes).toBeGreaterThan(0);

    const list = await (await snapshotsGET(get())).json();
    expect(list.snapshots.map((s: { manifest: { snapshotId: string } }) => s.manifest.snapshotId)).toContain(manifest.snapshotId);
    expect(list.storage.driver).toBe("local");
    expect(list.storage.totalBytes).toBeGreaterThan(0);

    const verified = await (await verifyPOST(post({}), ctx(manifest.snapshotId))).json();
    expect(verified.ok).toBe(true);

    const restored = await (await restorePOST(post({}), ctx(manifest.snapshotId))).json();
    expect(restored.ok).toBe(true);
    expect(restored.scope).toMatch(/does not read or write any database/);

    const after = await (await snapshotsGET(get())).json();
    const item = after.snapshots.find((s: { manifest: { snapshotId: string } }) => s.manifest.snapshotId === manifest.snapshotId);
    expect(item.lastVerify.ok).toBe(true);
    expect(item.lastRestoreTest.ok).toBe(true);
  });
});
