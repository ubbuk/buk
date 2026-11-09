import bcrypt from "bcrypt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { authOptions, userSessionCacheKey } from "./auth";
import { invalidate } from "./cache";

// Stage 2: every change of credentials revokes the sessions issued before it. The real jwt / session callbacks of
// lib/auth.ts, the real routes and the isolated test database; only the session lookup of the routes is replaced.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { POST as RESET_ROUTE } from "@/app/api/admin/users/[id]/reset-credentials/route";
import { PATCH as USER_PATCH } from "@/app/api/admin/users/[id]/route";
import { POST as REVOKE_ROUTE } from "@/app/api/admin/users/[id]/revoke-sessions/route";
import { POST as ME_PASSWORD } from "@/app/api/me/password/route";

const P = "sr-";
const TAG = Date.now().toString(36);
const ADMIN_PASSWORD = "Admin-pw-1";
const EMP_PASSWORD = "Employee-pw-1";
let adminHash = "";
let empHash = "";
let n = 0;
const created: string[] = [];

async function user(role: "ADMIN" | "EMPLOYEE" | "BOSS" = "EMPLOYEE") {
  n += 1;
  const id = `${P}${TAG}-${n}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role, passwordHash: role === "ADMIN" ? adminHash : empHash } });
  created.push(id);
  return id;
}
const as = (id: string, role: string) => {
  session.current = { user: { id, role, name: id, email: `${id}@test.local`, departmentId: null } };
};
const req = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const sv = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).sessionVersion;

/** What the session cookie holds after sign-in: runs the real jwt callback for a fresh login. */
async function signIn(id: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id } });
  return (await authOptions.callbacks!.jwt!({ token: { id: "", role: "", departmentId: null }, user: { id: u.id, role: u.role, departmentId: u.departmentId, sessionVersion: u.sessionVersion }, account: null } as never)) as { id: string; role: string; sv?: number };
}
/** The next request with that cookie: the jwt callback re-validates it against the database. */
async function nextRequest(token: { id: string; role: string; sv?: number }) {
  invalidate(userSessionCacheKey(token.id));
  return (await authOptions.callbacks!.jwt!({ token: { ...token } } as never)) as { role: string };
}
async function sessionOf(token: { role: string; id: string }) {
  return authOptions.callbacks!.session!({ session: { user: { name: "x" }, expires: "" }, token } as never);
}

beforeAll(async () => {
  adminHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  empHash = await bcrypt.hash(EMP_PASSWORD, 4);
  await prisma.loginThrottle.deleteMany();
});
afterEach(async () => {
  await prisma.loginThrottle.deleteMany();
});
afterAll(async () => {
  await prisma.loginThrottle.deleteMany();
  await prisma.notification.deleteMany({ where: { userId: { in: created } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: created } }, { entityId: { in: created } }] } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe("the session carries the credential generation", () => {
  it("a fresh sign-in is valid; the version is part of the token", async () => {
    const id = await user();
    const token = await signIn(id);
    expect(token.sv).toBe(0);
    expect((await nextRequest(token)).role).toBe("EMPLOYEE");
  });

  it("a token from before Stage 2 has no version, counts as generation 0 and is valid until the first revocation", async () => {
    const id = await user();
    const legacy = { id, role: "EMPLOYEE" };
    expect((await nextRequest(legacy)).role).toBe("EMPLOYEE");
    await prisma.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    expect((await nextRequest(legacy)).role).toBe("");
  });

  it("a revoked session is no session: the session callback yields an empty object, which getServerSession turns into null", async () => {
    const id = await user();
    const token = await signIn(id);
    expect(await sessionOf(token)).toMatchObject({ user: { id } });
    await prisma.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    const revoked = await nextRequest(token);
    expect(await sessionOf({ ...token, ...revoked })).toEqual({});
  });
});

describe("what revokes sessions", () => {
  it("the owner changing their password: every older session is revoked (the new password signs in again)", async () => {
    const id = await user();
    const old = await signIn(id);
    const other = await signIn(id); // a second device
    as(id, "EMPLOYEE");
    const res = await ME_PASSWORD(req({ currentPassword: EMP_PASSWORD, newPassword: "Brand-new-pw-1", confirmPassword: "Brand-new-pw-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, signedOut: true });
    expect(await sv(id)).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).passwordChangedAt).not.toBeNull();
    expect((await nextRequest(old)).role).toBe("");
    expect((await nextRequest(other)).role).toBe("");
    const fresh = await signIn(id);
    expect(fresh.sv).toBe(1);
    expect((await nextRequest(fresh)).role).toBe("EMPLOYEE");
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "CHANGE_PASSWORD" } })).afterJson).toContain("sessionsRevoked");
  });

  it("a wrong current password changes nothing and revokes nothing", async () => {
    const id = await user();
    const token = await signIn(id);
    as(id, "EMPLOYEE");
    expect((await ME_PASSWORD(req({ currentPassword: "wrong-password", newPassword: "Brand-new-pw-1", confirmPassword: "Brand-new-pw-1" }))).status).toBe(401);
    expect(await sv(id)).toBe(0);
    expect((await nextRequest(token)).role).toBe("EMPLOYEE");
  });

  it("an administrator password reset revokes the employee's sessions", async () => {
    const admin = await user("ADMIN");
    const emp = await user();
    const token = await signIn(emp);
    as(admin, "ADMIN");
    const res = await RESET_ROUTE(req({ reason: "Утсаар баталгаажуулсан, нууц үгээ мартсан", identityVerified: true, adminPassword: ADMIN_PASSWORD }), ctx(emp));
    expect(res.status).toBe(200);
    expect(await sv(emp)).toBe(1);
    expect((await nextRequest(token)).role).toBe("");
  });

  it("deactivating revokes for good: re-activating the account does NOT bring an old session back", async () => {
    const admin = await user("ADMIN");
    const emp = await user();
    const token = await signIn(emp);
    as(admin, "ADMIN");
    expect((await USER_PATCH(req({ isActive: false }), ctx(emp))).status).toBe(200);
    expect((await nextRequest(token)).role).toBe("");
    expect((await USER_PATCH(req({ isActive: true }), ctx(emp))).status).toBe(200);
    // before Stage 2 this old token would have been valid again here
    expect((await nextRequest(token)).role).toBe("");
    expect((await nextRequest(await signIn(emp))).role).toBe("EMPLOYEE");
  });

  it("another account's sessions are unaffected", async () => {
    const a = await user();
    const b = await user();
    const tokenB = await signIn(b);
    as(a, "EMPLOYEE");
    await ME_PASSWORD(req({ currentPassword: EMP_PASSWORD, newPassword: "Brand-new-pw-1", confirmPassword: "Brand-new-pw-1" }));
    expect((await nextRequest(tokenB)).role).toBe("EMPLOYEE");
  });
});

describe("administrator: sign an account out of every device", () => {
  const body = (over: object = {}) => ({ reason: "Утас алдсан гэж мэдэгдсэн", adminPassword: ADMIN_PASSWORD, ...over });

  it("needs ADMIN, the admin's own password and a reason; records it and tells the account; leaves the password alone", async () => {
    const admin = await user("ADMIN");
    const emp = await user();
    const token = await signIn(emp);
    const hashBefore = (await prisma.user.findUniqueOrThrow({ where: { id: emp } })).passwordHash;

    as(emp, "EMPLOYEE");
    expect((await REVOKE_ROUTE(req(body()), ctx(emp))).status).toBe(403);
    as(admin, "ADMIN");
    expect((await REVOKE_ROUTE(req(body({ adminPassword: "wrong" })), ctx(emp))).status).toBe(401);
    expect((await REVOKE_ROUTE(req(body({ reason: "x" })), ctx(emp))).status).toBe(400);
    expect((await REVOKE_ROUTE(req(body()), ctx(admin))).status).toBe(403); // own sessions: change the password instead
    expect((await REVOKE_ROUTE(req(body()), ctx(`${P}nobody`))).status).toBe(404);
    expect((await nextRequest(token)).role).toBe("EMPLOYEE");

    expect((await REVOKE_ROUTE(req(body()), ctx(emp))).status).toBe(200);
    expect((await nextRequest(token)).role).toBe("");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: emp } })).passwordHash).toBe(hashBefore);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: emp, action: "UPDATE_USER" } });
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ kind: "SESSIONS_REVOKED" });
    expect(JSON.stringify(audit)).not.toContain(ADMIN_PASSWORD);
    expect((await prisma.notification.findMany({ where: { userId: emp } })).some((x) => x.title.includes("нэвтрэлт хаагдлаа"))).toBe(true);
  });
});
