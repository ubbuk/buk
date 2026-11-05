import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Only the session lookup is replaced; the route, authorization and queries run for real against the
// isolated test database. The procurement sections share the Monitoring guard (ADMIN / DIRECTOR).
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET, POST } from "./route";

const P = "pmr-";
const TAG = Date.now().toString(36);
const users = {
  admin: { id: `${P}admin`, role: "ADMIN" },
  director: { id: `${P}director`, role: "DIRECTOR" },
  employee: { id: `${P}employee`, role: "EMPLOYEE" },
  manager: { id: `${P}manager`, role: "MANAGER" },
  boss: { id: `${P}boss`, role: "BOSS" },
  storekeeper: { id: `${P}store`, role: "STOREKEEPER" },
  accountant: { id: `${P}acct`, role: "CHIEF_ACCOUNTANT" },
  engineering: { id: `${P}eng`, role: "ENGINEERING" },
};
const DEPT = `${P}dept-${TAG}`;
const NUMBER = `PMR-${TAG}-1`;
let requestId = "";

const SECTIONS = ["procurement", "procurement-requests", "procurement-detail"];
const call = (section: string, qs = "", method: "GET" | "POST" = "GET") => {
  const req = new Request(`http://localhost/api/admin/monitoring/${section}${qs}`, { method });
  const ctx = { params: Promise.resolve({ section }) };
  return method === "GET" ? GET(req, ctx) : POST(req, ctx);
};
const as = (u: { id: string; role: string } | null) => {
  session.current = u ? { user: { id: u.id, role: u.role, name: u.id, email: `${u.id}@t.local` } } : null;
};

async function cleanup() {
  await prisma.materialRequest.deleteMany({ where: { requestNumber: { startsWith: "PMR-" } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.user.updateMany({ where: { id: { startsWith: P } }, data: { departmentId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.department.create({ data: { id: DEPT, name: `PMR ${TAG} цех`, type: "FACTORY" } });
  await prisma.user.createMany({
    data: Object.values(users).map((u) => ({ id: u.id, email: `${u.id}@test.local`, name: u.id, passwordHash: "x", role: u.role as never, departmentId: u.role === "EMPLOYEE" ? DEPT : null })),
  });
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber: NUMBER, year: 9999, sequence: 1, departmentId: DEPT, requestedById: users.employee.id, status: "PENDING_PROCUREMENT", version: 5,
      items: { create: [{ lineNo: 1, unit: "ш", requestedQuantity: 3, manualMaterialName: `PMR ${TAG} item` }] },
      approvalSteps: { create: [
        { type: "EXECUTIVE_APPROVAL", sequence: 5, status: "APPROVED", assignedUserId: users.storekeeper.id, decidedAt: new Date(Date.now() - 3600_000) },
        { type: "MANAGER_PROCUREMENT", sequence: 6, status: "PENDING", assignedUserId: null },
      ] },
    },
  });
  requestId = created.id;
});
afterAll(cleanup);
beforeEach(() => as(null));

describe("procurement monitoring authorization (server side)", () => {
  it("rejects unauthenticated requests with 401 on every procurement section", async () => {
    for (const s of SECTIONS) expect((await call(s, `?id=${requestId}`)).status, s).toBe(401);
  });

  it.each(Object.keys(users).filter((k) => k !== "admin" && k !== "director"))("rejects %s with 403 and leaks nothing", async (who) => {
    as(users[who as keyof typeof users]);
    for (const s of SECTIONS) {
      const res = await call(s, `?id=${requestId}&q=${NUMBER}`);
      expect(res.status, `${who} ${s}`).toBe(403);
      expect(await res.json()).toEqual({ error: "Эрхгүй үйлдэл" }); // no counts, no request numbers
    }
  });

  it.each([["admin"], ["director"]] as const)("lets %s read the organisation-wide procurement data", async (who) => {
    as(users[who]);
    const overview = await call("procurement", "?range=all&thresholdHours=48");
    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({ thresholdHours: 48, requests: { awaitingProcurement: expect.any(Number) }, items: expect.any(Object), managers: expect.any(Array) });
    const list = await call("procurement-requests", `?q=${NUMBER}`);
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.rows.map((r: { requestNumber: string }) => r.requestNumber)).toEqual([NUMBER]);
    const detail = await call("procurement-detail", `?id=${requestId}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).row.requestId).toBe(requestId);
  });

  it("is read-only: no write method reaches a procurement section", async () => {
    as(users.admin);
    for (const s of SECTIONS) expect((await call(s, "", "POST")).status, s).toBe(404);
    const exported = Object.keys(await import("./route")).filter((k) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(k));
    expect(exported.sort()).toEqual(["GET", "POST"]); // POST only serves the existing access-log "view" call
  });
});

describe("procurement monitoring endpoints", () => {
  beforeEach(() => as(users.admin));

  it("clamps paging and falls back to safe defaults for unknown scope, filter and threshold", async () => {
    const res = await call("procurement-requests", `?q=${NUMBER}&page=0&pageSize=100000&scope=nonsense&filter=nonsense&thresholdHours=abc`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ page: 1, pageSize: 100, scope: "active", thresholdHours: 72, total: 1 });
  });

  it("answers 404 for a missing, oversized or never-in-procurement request id", async () => {
    expect((await call("procurement-detail")).status).toBe(404);
    expect((await call("procurement-detail", `?id=${"x".repeat(80)}`)).status).toBe(404);
    expect((await call("procurement-detail", "?id=pmr-unknown")).status).toBe(404);
    const plain = await prisma.materialRequest.create({
      data: { requestNumber: `PMR-${TAG}-2`, year: 9999, sequence: 2, departmentId: DEPT, requestedById: users.employee.id, status: "PENDING_DEPARTMENT_APPROVAL" },
    });
    expect((await call("procurement-detail", `?id=${plain.id}`)).status).toBe(404);
  });

  it("does not break the existing monitoring sections", async () => {
    for (const s of ["overview", "pending"]) expect((await call(s)).status, s).toBe(200);
  });
});
