import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Private employee profile, phase 1. Only the session lookup is replaced; the route, the field
// selection and PostgreSQL are real (isolated test database).
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import * as profileRoute from "./profile/route";

const P = "prf-";
const TAG = Date.now().toString(36);
const SECRET_HASH = `$2b$10$profile-secret-hash-${TAG}`;
const PIN_HASH = `$2b$10$profile-pin-secret-hash-${TAG}`;
const dept = `${P}dept-${TAG}`;
const ids = { emp: `${P}emp-${TAG}`, other: `${P}other-${TAG}`, admin: `${P}admin-${TAG}`, nodept: `${P}nodept-${TAG}`, off: `${P}off-${TAG}` };

const as = (id: string | null, role = "EMPLOYEE") => {
  session.current = id ? { user: { id, role, name: "session-name", email: "session@mail", departmentId: null } } : null;
};
// Next calls a route handler with the request even though this one declares no parameter: pass it, to prove it is ignored.
const handler = profileRoute.GET as unknown as (req: Request) => Promise<Response>;
const get = (url = "http://localhost/api/me/profile") => handler(new Request(url));
const root = process.cwd();

beforeAll(async () => {
  await prisma.department.create({ data: { id: dept, name: `Цех ${TAG}`, type: "FACTORY" } });
  const mk = (id: string, over: Record<string, unknown>) =>
    prisma.user.create({ data: { id, email: `${id}@test.local`, name: `Name ${id}`, role: "EMPLOYEE", passwordHash: SECRET_HASH, ...over } as never });
  await mk(ids.emp, { title: "Ерөнхий инженер", departmentId: dept });
  await mk(ids.other, { title: "Нярав (нууц)", departmentId: dept });
  await mk(ids.admin, { role: "ADMIN", title: null });
  await mk(ids.nodept, { role: "MANAGER", title: null });
  await mk(ids.off, { isActive: false, title: "Хуучин ажилтан", departmentId: dept });
  await prisma.approvalPinCredential.create({ data: { userId: ids.emp, pinHash: PIN_HASH } });
});
afterAll(async () => {
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
});

describe("authentication", () => {
  it("401 without a session, and a session without a user id is not accepted either", async () => {
    as(null);
    expect((await get()).status).toBe(401);
    session.current = { user: { role: "ADMIN" } };
    expect((await get()).status).toBe(401);
    session.current = {};
    expect((await get()).status).toBe(401);
  });

  it("404 (not someone else's data) when the session's user no longer exists", async () => {
    as(`${P}ghost-${TAG}`);
    expect((await get()).status).toBe(404);
  });
});

describe("a profile is only ever the session user's own", () => {
  it("returns the signed-in user's real data (name, department, job title, role, status)", async () => {
    as(ids.emp);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: `Name ${ids.emp}`,
      email: `${ids.emp}@test.local`,
      title: "Ерөнхий инженер",
      role: "EMPLOYEE",
      isActive: true,
      department: { name: `Цех ${TAG}`, type: "FACTORY" },
    });
  });

  it("identity comes from the session only: query strings, headers and path tricks cannot select another person", async () => {
    as(ids.emp);
    for (const url of [
      `http://localhost/api/me/profile?userId=${ids.other}`,
      `http://localhost/api/me/profile?id=${ids.other}&user=${ids.other}&email=${ids.other}@test.local`,
      `http://localhost/api/me/profile?userId[]=${ids.other}`,
    ]) {
      const body = await (await get(url)).json();
      expect(body.name, url).toBe(`Name ${ids.emp}`);
      expect(JSON.stringify(body)).not.toContain(ids.other);
      expect(JSON.stringify(body)).not.toContain("Нярав (нууц)");
    }
    // a request that carries somebody else's id in headers is ignored too (the handler does not even receive the request)
    const withHeaders = await handler(new Request("http://localhost/api/me/profile", { headers: { "x-user-id": ids.other, authorization: `Bearer ${ids.other}` } }));
    expect((await withHeaders.json()).name).toBe(`Name ${ids.emp}`);
    expect(profileRoute.GET.length).toBe(0); // GET() declares no parameters: nothing from the request can reach it
  });

  it("each user sees their own profile, and different users never see each other's", async () => {
    as(ids.emp);
    const a = await (await get()).json();
    as(ids.other);
    const b = await (await get()).json();
    expect(a.title).toBe("Ерөнхий инженер");
    expect(b.title).toBe("Нярав (нууц)");
    expect(a.email).not.toBe(b.email);
  });

  it("ADMIN gets no special access: asking for the profile returns the admin's own, even when naming another user", async () => {
    as(ids.admin, "ADMIN");
    const own = await (await get()).json();
    expect(own).toMatchObject({ name: `Name ${ids.admin}`, role: "ADMIN", title: null, department: null });
    const named = await (await get(`http://localhost/api/me/profile?userId=${ids.emp}`)).json();
    expect(named).toEqual(own);
    expect(JSON.stringify(named)).not.toContain("Ерөнхий инженер");
  });

  it("the session's role claim changes nothing about whose data is returned", async () => {
    as(ids.emp, "ADMIN"); // a forged/odd role claim
    expect((await (await get()).json()).role).toBe("EMPLOYEE"); // the real role from the database
  });

  it("handles a user without a department or job title, and an inactive account's status", async () => {
    as(ids.nodept, "MANAGER");
    expect(await (await get()).json()).toMatchObject({ role: "MANAGER", title: null, department: null, isActive: true });
    as(ids.off);
    expect(await (await get()).json()).toMatchObject({ isActive: false, title: "Хуучин ажилтан" });
  });
});

describe("nothing sensitive leaves the server", () => {
  it("exposes exactly the intended fields: no id, password hash, PIN credential, login times or any other column", async () => {
    as(ids.emp);
    const res = await get();
    const text = await res.text();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["department", "email", "isActive", "name", "role", "title"]);
    expect(Object.keys(JSON.parse(text).department).sort()).toEqual(["name", "type"]);
    for (const secret of [SECRET_HASH, PIN_HASH, "passwordHash", "pinHash", "failedAttempts", "lockedUntil", "lastLoginAt", "departmentId", "approvalPinCredential"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("personal data is never cached", async () => {
    as(ids.emp);
    expect((await get()).headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("the surface stays small", () => {
  it("the route is read-only: GET is the only handler", () => {
    expect(Object.keys(profileRoute).filter((k) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(k))).toEqual(["GET"]);
  });

  it("there is no dynamic route that could carry another user's id", () => {
    for (const dir of ["app/api/me/profile", "app/(app)/profile"]) {
      const entries = readdirSync(path.join(root, dir));
      expect(entries.filter((e) => /^\[.*\]$/.test(e)), dir).toEqual([]);
    }
    expect(existsSync(path.join(root, "app/(app)/profile/page.tsx"))).toBe(true);
  });

  it("profile data is not wired into the JWT callbacks, the global request store, the live-event bus or the request loader", () => {
    for (const file of ["lib/auth.ts", "lib/store.ts", "lib/events.ts", "components/requests/RequestsLoader.tsx"]) {
      expect(readFileSync(path.join(root, file), "utf8"), file).not.toMatch(/profile/i);
    }
  });

  it("the profile page fetches only its own endpoint and never touches the request list or the store", () => {
    const page = readFileSync(path.join(root, "app/(app)/profile/page.tsx"), "utf8");
    expect(page.match(/fetch\(/g)).toHaveLength(1);
    expect(page).toContain('"/api/me/profile"');
    expect(page).not.toMatch(/api\/requests|useRequestStore|lib\/store/);
  });

  it("the profile is only ever read with an id from the session (no caller passes a request value)", () => {
    const route = readFileSync(path.join(root, "app/api/me/profile/route.ts"), "utf8");
    expect(route).toContain("getOwnProfile(session.user.id)");
    expect(route).not.toMatch(/searchParams|req\.|request\.|params/);
  });
});
