import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Only the session lookup is replaced (it needs a signed cookie / request
// context); the route, authorization, queries and audit writes run for real
// against the isolated test database.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET, POST } from "./route";

const P = "mon-r-";
const users = {
  admin: { id: `${P}admin`, role: "ADMIN" },
  director: { id: `${P}director`, role: "DIRECTOR" },
  employee: { id: `${P}employee`, role: "EMPLOYEE" },
  manager: { id: `${P}manager`, role: "MANAGER" },
};

const call = (section: string, qs = "", method: "GET" | "POST" = "GET") => {
  const req = new Request(`http://localhost/api/admin/monitoring/${section}${qs}`, { method });
  const ctx = { params: Promise.resolve({ section }) };
  return method === "GET" ? GET(req, ctx) : POST(req, ctx);
};
const as = (u: { id: string; role: string } | null) => {
  session.current = u ? { user: { id: u.id, role: u.role, name: u.id, email: `${u.id}@t.local` } } : null;
};

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: Object.values(users).map((u) => ({
      id: u.id,
      email: `${u.id}@test.local`,
      name: u.id,
      passwordHash: "x",
      role: u.role as never,
    })),
  });
});
afterAll(cleanup);
beforeEach(() => as(null));

describe("/api/admin/monitoring authorization (server side)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    expect((await call("overview")).status).toBe(401);
    expect((await call("view", "", "POST")).status).toBe(401);
  });

  it.each([["employee"], ["manager"]] as const)("rejects %s with 403 on every section and records it", async (who) => {
    as(users[who]);
    for (const s of ["overview", "departments", "employees", "pending", "returned", "activity"]) {
      const res = await call(s);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Эрхгүй үйлдэл" }); // no data leaks in the error body
    }
    expect((await call("view", "", "POST")).status).toBe(403);
    const denied = await prisma.auditLog.count({ where: { actorId: users[who].id, action: "MONITORING_ACCESS_DENIED" } });
    expect(denied).toBe(1); // many attempts, one (de-duplicated) audit entry
  });

  it.each([["admin"], ["director"]] as const)("allows %s", async (who) => {
    as(users[who]);
    const res = await call("overview", "?range=7d");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toHaveProperty("users.active");
    expect(body).toHaveProperty("requests.pending");
    for (const s of ["departments", "employees", "pending", "returned", "activity"]) {
      expect((await call(s, "?page=1&pageSize=5")).status).toBe(200);
    }
  });

  it("clamps page size and handles bad paging input", async () => {
    as(users.admin);
    const body = await (await call("activity", "?page=-4&pageSize=100000&range=all")).json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(100);
  });

  it("returns 404 for unknown sections and logs a view for allowed roles", async () => {
    as(users.director);
    expect((await call("nope")).status).toBe(404);
    expect((await call("view", "", "POST")).status).toBe(200);
    const views = await prisma.auditLog.count({ where: { actorId: users.director.id, action: "VIEW_MONITORING" } });
    expect(views).toBe(1);
  });
});
