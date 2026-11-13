import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ADMIN_TEST_HASH, ADMIN_TEST_PASSWORD, withStepUp } from "@/app/api/procurement/step-up-support";

// The real handler on the isolated test DB; only the session lookup is replaced.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as USERS } from "../../route";
import { PATCH } from "./route";

const P = "payroll-t-";
const ids = { admin: `${P}admin`, director: `${P}director`, employee: `${P}employee`, target: `${P}target`, boss: `${P}boss` } as const;
type Who = keyof typeof ids;
const as = (w: Who | null) => {
  session.current = w ? { user: { id: ids[w], role: w === "admin" ? "ADMIN" : w.toUpperCase(), name: w, email: `${ids[w]}@t.local`, departmentId: null } } : null;
};
// The step-up fields (the administrator's own password, a reason, a confirmation) are added unless the test overrides them.
const raw = (id: string, body: unknown) =>
  PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "Content-Type": "application/json", "x-forwarded-for": "10.9.8.7" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const patch = (id: string, body: object) => raw(id, withStepUp(body));
const throttleKey = `pwd:user:${createHash("sha256").update(ids.admin).digest("hex")}`;
const flag = async () => (await prisma.user.findUniqueOrThrow({ where: { id: ids.target } })).canViewPayroll;
const audits = () => prisma.auditLog.findMany({ where: { entityId: ids.target, action: "ONEC_PAYROLL_ACCESS" }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  const mk = (id: string, role: "ADMIN" | "DIRECTOR" | "EMPLOYEE" | "BOSS") =>
    prisma.user.upsert({ where: { id }, update: { role, isActive: true, passwordHash: role === "ADMIN" ? ADMIN_TEST_HASH : "x" }, create: { id, email: `${id}@test.local`, name: id, role, passwordHash: role === "ADMIN" ? ADMIN_TEST_HASH : "x" } });
  await Promise.all([mk(ids.admin, "ADMIN"), mk(ids.director, "DIRECTOR"), mk(ids.employee, "EMPLOYEE"), mk(ids.target, "EMPLOYEE"), mk(ids.boss, "BOSS")]);
});
beforeEach(async () => {
  await prisma.loginThrottle.deleteMany({ where: { key: throttleKey } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { startsWith: P } }, { entityId: { startsWith: P } }] } });
  await prisma.user.update({ where: { id: ids.target }, data: { canViewPayroll: false } });
});
afterAll(async () => {
  await prisma.loginThrottle.deleteMany({ where: { key: throttleKey } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { startsWith: P } }, { entityId: { startsWith: P } }] } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
});

describe("PATCH /api/admin/users/[id]/payroll-access", () => {
  it("only an ADMIN can change it: nobody else (including a DIRECTOR, or the person himself) can, and nothing is written", async () => {
    for (const w of [null, "director", "employee", "boss"] as const) {
      as(w);
      expect((await patch(ids.target, { canViewPayroll: true })).status, String(w)).toBe(403);
    }
    // a person cannot grant himself
    session.current = { user: { id: ids.target, role: "EMPLOYEE", name: "t", email: "t@t.local", departmentId: null } };
    expect((await patch(ids.target, { canViewPayroll: true })).status).toBe(403);
    expect(await flag()).toBe(false);
    expect(await audits()).toHaveLength(0);
  });

  it("an ADMIN session whose DB account is no longer an active ADMIN is refused (checked in the database)", async () => {
    await prisma.user.update({ where: { id: ids.admin }, data: { isActive: false } });
    as("admin");
    expect((await patch(ids.target, { canViewPayroll: true })).status).toBe(403);
    await prisma.user.update({ where: { id: ids.admin }, data: { isActive: true } });
    expect(await flag()).toBe(false);
  });

  it("grant and revoke are written to the DB and each is audit-logged: who, to whom, granted/revoked, when, from where", async () => {
    as("admin");
    const before = Date.now();
    expect((await patch(ids.target, { canViewPayroll: true })).status).toBe(200);
    expect(await flag()).toBe(true);
    expect((await patch(ids.target, { canViewPayroll: false })).status).toBe(200);
    expect(await flag()).toBe(false);

    const rows = await audits();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ entityType: "User", entityId: ids.target, actorId: ids.admin });
    expect(JSON.parse(rows[0].beforeJson!)).toEqual({ canViewPayroll: false });
    expect(JSON.parse(rows[0].afterJson!)).toEqual({ canViewPayroll: true, change: "granted", reason: "Тестийн шалтгаан", confirmed: true, stepUp: "admin_password" });
    expect(JSON.parse(rows[1].beforeJson!)).toEqual({ canViewPayroll: true });
    expect(JSON.parse(rows[1].afterJson!)).toEqual({ canViewPayroll: false, change: "revoked", reason: "Тестийн шалтгаан", confirmed: true, stepUp: "admin_password" });
    expect(JSON.stringify(rows)).not.toContain(ADMIN_TEST_PASSWORD); // never the password, never a hash
    expect(JSON.stringify(rows)).not.toContain(ADMIN_TEST_HASH);
    expect(rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("granting AND revoking both need the reason, the confirmation and the administrator's own password; the reason is what gets stored", async () => {
    as("admin");
    const bad: [string, object][] = [
      ["no password", { adminPassword: "" }],
      ["no reason", { reason: "" }],
      ["a two-letter reason", { reason: "ab" }],
      ["a blank reason", { reason: "   " }],
      ["no confirmation", { confirmed: false }],
    ];
    for (const grant of [true, false]) {
      if (!grant) await patch(ids.target, { canViewPayroll: true });
      for (const [label, override] of bad) {
        expect((await patch(ids.target, { canViewPayroll: grant, ...override })).status, `${grant ? "grant" : "revoke"}: ${label}`).toBe(400);
        expect(await flag(), `${grant ? "grant" : "revoke"}: ${label}`).toBe(!grant);
      }
      // the fields missing altogether
      expect((await raw(ids.target, { canViewPayroll: grant })).status).toBe(400);
      expect(await flag()).toBe(!grant);
    }
    expect((await audits()).filter((r) => JSON.parse(r.afterJson!).change === "revoked")).toHaveLength(0);

    expect((await patch(ids.target, { canViewPayroll: false, reason: "Ажлын чиг үүрэг өөрчлөгдсөн" })).status).toBe(200);
    const revoked = (await audits()).find((r) => JSON.parse(r.afterJson!).change === "revoked")!;
    expect(JSON.parse(revoked.afterJson!).reason).toBe("Ажлын чиг үүрэг өөрчлөгдсөн");
  });

  it("a wrong password is 401 and changes nothing (grant and revoke); five wrong attempts lock further tries (429), even with the right one", async () => {
    as("admin");
    expect((await patch(ids.target, { canViewPayroll: true, adminPassword: "wrong-1" })).status).toBe(401);
    expect(await flag()).toBe(false);
    await prisma.user.update({ where: { id: ids.target }, data: { canViewPayroll: true } });
    expect((await patch(ids.target, { canViewPayroll: false, adminPassword: "wrong-2" })).status).toBe(401);
    expect(await flag()).toBe(true);
    expect(await audits()).toHaveLength(0);
    for (const n of [3, 4, 5]) expect((await patch(ids.target, { canViewPayroll: false, adminPassword: `wrong-${n}` })).status).toBe(401);
    const locked = await patch(ids.target, { canViewPayroll: false }); // the RIGHT password, but the budget is spent
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await flag()).toBe(true);
    expect(await audits()).toHaveLength(0);
  });

  it("a request that changes nothing writes no audit row; bad input is 400; an unknown user is 404", async () => {
    as("admin");
    expect((await patch(ids.target, { canViewPayroll: false })).status).toBe(200);
    expect(await audits()).toHaveLength(0);
    expect((await patch(ids.target, { canViewPayroll: "yes" })).status).toBe(400);
    expect((await patch(ids.target, {})).status).toBe(400);
    expect((await patch(`${P}nobody`, { canViewPayroll: true })).status).toBe(404);
  });

  it("the flag is off by default, and the user list shows it (ADMIN only)", async () => {
    as("admin");
    const list = (await (await USERS()).json()) as { id: string; canViewPayroll: boolean }[];
    expect(list.find((u) => u.id === ids.target)?.canViewPayroll).toBe(false);
    await patch(ids.target, { canViewPayroll: true });
    expect(((await (await USERS()).json()) as { id: string; canViewPayroll: boolean }[]).find((u) => u.id === ids.target)?.canViewPayroll).toBe(true);
    as("director");
    expect((await USERS()).status).toBe(403);
  });
});
