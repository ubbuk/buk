import bcrypt from "bcrypt";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { custodyOf } from "./authority-grant";
import { LIMITS } from "./login-throttle";
import { hashToken, setRecoveryDelivery, TOKEN_TTL_MS } from "./password-recovery";

// Stage 4: self-service password recovery. The administrator never sees a password or a token: the clear token goes only to
// the account owner through a delivery channel. Real routes, throttle, audit and notifications on the isolated test database;
// the delivery channel is a FAKE that records what would have been e-mailed (no provider is bundled with the application).
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { POST as REQUEST_ROUTE } from "@/app/api/auth/recovery/request/route";
import { POST as CONFIRM_ROUTE } from "@/app/api/auth/recovery/confirm/route";
import { POST as RESET_ROUTE } from "@/app/api/admin/users/[id]/reset-credentials/route";

const P = "rc-";
const TAG = Date.now().toString(36);
const OLD_PASSWORD = "Old-password-1";
const ADMIN_PASSWORD = "Admin-pw-1";
const NEW_PASSWORD = "Brand-new-pw-1";
let oldHash = "";
let n = 0;
const created: string[] = [];
let sent: { to: string; token: string; expiresAt: Date }[] = [];
let ipN = 0;
const ip = () => `10.77.${Math.floor(++ipN / 250)}.${ipN % 250}`;

async function user(role: "EMPLOYEE" | "BOSS" | "ADMIN" | "DIRECTOR" = "EMPLOYEE") {
  n += 1;
  const id = `${P}${TAG}-${n}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role, passwordHash: oldHash } });
  created.push(id);
  return id;
}
const emailOf = (id: string) => `${id}@test.local`;
const post = (handler: (r: Request) => Promise<Response>, body: unknown, address = ip()) =>
  handler(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": address }, body: JSON.stringify(body) }));
const requestRecovery = (email: string, address?: string) => post(REQUEST_ROUTE as never, { email }, address);
const confirm = (token: string, newPassword = NEW_PASSWORD, address?: string) => post(CONFIRM_ROUTE as never, { token, newPassword }, address);
const json = async (r: Response) => (await r.clone().json()) as Record<string, unknown>;
const hashOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY", "hops:1");
  oldHash = await bcrypt.hash(OLD_PASSWORD, 4);
  await prisma.loginThrottle.deleteMany();
});
beforeEach(() => {
  vi.stubEnv("SELF_SERVICE_RECOVERY", "on");
  sent = [];
  setRecoveryDelivery({ send: async (m) => void sent.push({ to: m.to, token: m.token, expiresAt: m.expiresAt }) });
});
afterEach(async () => {
  setRecoveryDelivery(null);
  await prisma.loginThrottle.deleteMany();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.loginThrottle.deleteMany();
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { in: created } } });
  await prisma.passwordRecoveryToken.deleteMany({ where: { userId: { in: created } } });
  await prisma.notification.deleteMany({ where: { userId: { in: created } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: created } }, { entityId: { in: created } }] } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe("disabled by default", () => {
  it("without SELF_SERVICE_RECOVERY=on both public routes answer 404 and nothing is sent or stored", async () => {
    vi.stubEnv("SELF_SERVICE_RECOVERY", "off");
    const id = await user();
    expect((await requestRecovery(emailOf(id))).status).toBe(404);
    expect((await confirm("x".repeat(20))).status).toBe(404);
    expect(sent).toHaveLength(0);
    expect(await prisma.passwordRecoveryToken.count({ where: { userId: id } })).toBe(0);
  });

  it("switched on but with no delivery channel registered it is inert: the same answer, no token, no mail", async () => {
    setRecoveryDelivery(null);
    const id = await user();
    const res = await requestRecovery(emailOf(id));
    expect(res.status).toBe(202);
    expect(await prisma.passwordRecoveryToken.count({ where: { userId: id } })).toBe(0);
    expect((await confirm("x".repeat(20))).status).toBe(404);
  });
});

describe("requesting recovery", () => {
  it("an ordinary employee gets a one-time token on the delivery channel; only its hash is stored; 30 minutes", async () => {
    const id = await user();
    const res = await requestRecovery(emailOf(id));
    expect(res.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(emailOf(id));
    const token = sent[0].token;
    expect(token.length).toBeGreaterThanOrEqual(40);
    const rows = await prisma.passwordRecoveryToken.findMany({ where: { userId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBeLessThanOrEqual(TOKEN_TTL_MS + 1000);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: id } }))).not.toContain(token);
  });

  it("an unknown address gets exactly the same answer and no mail (no way to find out who has an account)", async () => {
    const known = await requestRecovery(emailOf(await user()));
    const unknown = await requestRecovery(`${P}nobody-${TAG}@test.local`);
    expect(unknown.status).toBe(known.status);
    expect(await json(unknown)).toEqual(await json(known));
    expect(sent).toHaveLength(1);
  });

  it("a deactivated account gets nothing", async () => {
    const id = await user();
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    expect((await requestRecovery(emailOf(id))).status).toBe(202);
    expect(sent).toHaveLength(0);
  });

  it("is throttled per account and per address, and the throttle answers the same for unknown addresses", async () => {
    const id = await user();
    for (let i = 0; i < LIMITS.recoveryRequestAccount; i += 1) expect((await requestRecovery(emailOf(id))).status).toBe(202);
    const blocked = await requestRecovery(emailOf(id));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    const ghost = `${P}ghost-${TAG}@test.local`;
    for (let i = 0; i < LIMITS.recoveryRequestAccount; i += 1) expect((await requestRecovery(ghost)).status).toBe(202);
    expect((await requestRecovery(ghost)).status).toBe(429);
  });

  it("a new request voids the older token", async () => {
    const id = await user();
    await requestRecovery(emailOf(id));
    await requestRecovery(emailOf(id));
    expect(sent).toHaveLength(2);
    expect((await confirm(sent[0].token)).status).toBe(400);
    expect((await confirm(sent[1].token)).status).toBe(200);
  });

  it("an unavailable limiter refuses the request", async () => {
    const id = await user();
    await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle" RENAME TO "LoginThrottle_away"`);
    try {
      expect((await requestRecovery(emailOf(id))).status).toBe(503);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle_away" RENAME TO "LoginThrottle"`);
    }
    expect(sent).toHaveLength(0);
  });
});

describe("confirming recovery", () => {
  it("sets the owner's own password, revokes every session, records it as the owner's password change and notifies them", async () => {
    const id = await user();
    await requestRecovery(emailOf(id));
    const before = (await prisma.user.findUniqueOrThrow({ where: { id } })).sessionVersion;
    const res = await confirm(sent[0].token);
    expect(res.status).toBe(200);
    expect(await bcrypt.compare(NEW_PASSWORD, await hashOf(id))).toBe(true);
    expect(await bcrypt.compare(OLD_PASSWORD, await hashOf(id))).toBe(false);
    const after = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(after.sessionVersion).toBe(before + 1);
    expect(after.passwordChangedAt).not.toBeNull();
    const kinds = (await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(kinds).toEqual(expect.arrayContaining(["RESET_CREDENTIALS", "CHANGE_PASSWORD"]));
    expect((await prisma.notification.findMany({ where: { userId: id } })).some((x) => x.title.includes("нууц үг сэргээгдлээ"))).toBe(true);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: id } }))).not.toContain(NEW_PASSWORD);
  });

  it("a token works once; expired, unknown and malformed tokens all get the same refusal", async () => {
    const id = await user();
    await requestRecovery(emailOf(id));
    const token = sent[0].token;
    expect((await confirm(token)).status).toBe(200);
    const second = await confirm(token, "Another-pw-12");
    expect(second.status).toBe(400);
    expect(await bcrypt.compare(NEW_PASSWORD, await hashOf(id))).toBe(true);

    await requestRecovery(emailOf(id));
    const stale = sent[1].token;
    await prisma.passwordRecoveryToken.updateMany({ where: { tokenHash: hashToken(stale) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await confirm(stale, "Another-pw-12");
    const unknown = await confirm("not-a-real-token-".repeat(3), "Another-pw-12");
    expect(expired.status).toBe(400);
    expect(await json(expired)).toEqual(await json(unknown));
    expect(await json(second)).toEqual(await json(unknown));
  });

  it("a weak password is refused and the token is not spent", async () => {
    const id = await user();
    await requestRecovery(emailOf(id));
    expect((await confirm(sent[0].token, "short")).status).toBe(400);
    expect(await hashOf(id)).toBe(oldHash);
    expect((await confirm(sent[0].token)).status).toBe(200);
  });

  it("guessing is throttled per token and per address", async () => {
    const id = await user();
    await requestRecovery(emailOf(id));
    const guess = "g".repeat(43);
    const address = ip();
    for (let i = 0; i < LIMITS.recoveryConfirmToken; i += 1) expect((await confirm(guess, NEW_PASSWORD, address)).status).toBe(400);
    const blocked = await confirm(guess, NEW_PASSWORD, address);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("the owner holds the credential afterwards: the custody evidence of Stage 1.5 reads OWNER_HELD even after an admin reset", async () => {
    vi.stubEnv("SELF_SERVICE_RECOVERY", "off"); // the admin reset is only available while self-service is not ready
    const admin = await user("ADMIN");
    await prisma.user.update({ where: { id: admin }, data: { passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 4) } });
    const emp = await user();
    session.current = { user: { id: admin, role: "ADMIN" } };
    expect((await RESET_ROUTE(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: "Утсаар баталгаажуулсан, мартсан", identityVerified: true, adminPassword: ADMIN_PASSWORD }) }), ctx(emp))).status).toBe(200);
    expect((await custodyOf(prisma, emp)).state).toBe("ADMIN_ISSUED_UNCHANGED");
    vi.stubEnv("SELF_SERVICE_RECOVERY", "on");
    await requestRecovery(emailOf(emp));
    expect((await confirm(sent[0].token)).status).toBe(200);
    expect((await custodyOf(prisma, emp)).state).toBe("OWNER_HELD");
  });
});

describe("accounts that carry authority are not recoverable by e-mail alone", () => {
  it("BOSS, ADMIN and a department head get the same answer and NO token and NO mail", async () => {
    const boss = await user("BOSS");
    const admin = await user("ADMIN");
    const head = await user(); // an EMPLOYEE role that nevertheless heads a department
    const dept = `${P}dept-${TAG}`;
    await prisma.department.create({ data: { id: dept, name: dept, type: "OFFICE", headId: head } });
    try {
      const unknown = await json(await requestRecovery(`${P}nobody-${TAG}@test.local`));
      for (const id of [boss, admin, head]) {
        const res = await requestRecovery(emailOf(id));
        expect(res.status).toBe(202);
        expect(await json(res)).toEqual(unknown);
        expect(await prisma.passwordRecoveryToken.count({ where: { userId: id } })).toBe(0);
      }
      expect(sent).toHaveLength(0);
    } finally {
      await prisma.department.update({ where: { id: dept }, data: { headId: null } });
      await prisma.department.delete({ where: { id: dept } });
    }
  });

  it("a token issued to an ordinary employee stops working if the account gained authority in the meantime", async () => {
    const id = await user();
    await requestRecovery(emailOf(id));
    await prisma.user.update({ where: { id }, data: { role: "BOSS" } });
    expect((await confirm(sent[0].token)).status).toBe(400);
    expect(await hashOf(id)).toBe(oldHash);
  });
});

describe("the administrator is out of the loop once it is ready", () => {
  it("the Stage 1 temporary-password reset is refused with a pointer to self-service", async () => {
    const admin = await user("ADMIN");
    await prisma.user.update({ where: { id: admin }, data: { passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 4) } });
    const emp = await user();
    session.current = { user: { id: admin, role: "ADMIN" } };
    const res = await RESET_ROUTE(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: "Утсаар баталгаажуулсан, мартсан", identityVerified: true, adminPassword: ADMIN_PASSWORD }) }), ctx(emp));
    expect(res.status).toBe(409);
    expect(await hashOf(emp)).toBe(oldHash);
  });
});
