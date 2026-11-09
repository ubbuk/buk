import bcrypt from "bcrypt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { admit, LIMITS, passwordChangeBuckets } from "./login-throttle";
import { verifyPin } from "./pin";
import { resetPinAsAdmin, setOwnPin } from "./pin-management";
import { executiveApprove } from "./workflow";

// Creating, changing and resetting the approval PIN, against the isolated test database. Only the session lookup
// is replaced (for the route handlers); the services, the shared PostgreSQL throttle and the PIN attempt counter
// are real.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as PIN_GET, POST as PIN_POST } from "@/app/api/me/pin/route";
import { POST as RESET_POST } from "@/app/api/admin/users/[id]/reset-pin/route";

const P = "pm-";
const TAG = Date.now().toString(36);
const PASSWORD = "Account-pw-1";
const ADMIN_PASSWORD = "Admin-pw-1";
const PIN = "1234";
const NEW_PIN = "7777";
const WRONG = "0000";
let hash = "";
let adminHash = "";
let pinHash = "";
let n = 0;
let ipN = 0;
const created: string[] = [];
const ip = () => `10.88.${Math.floor(++ipN / 250)}.${ipN % 250}`;

async function user(opts: { role?: "EMPLOYEE" | "DIRECTOR" | "MANAGER" | "ADMIN"; pin?: boolean; active?: boolean } = {}) {
  n += 1;
  const id = `${P}${TAG}-${n}`;
  const role = opts.role ?? "EMPLOYEE";
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role, passwordHash: role === "ADMIN" ? adminHash : hash, isActive: opts.active ?? true } });
  created.push(id);
  if (opts.pin) await prisma.approvalPinCredential.create({ data: { userId: id, pinHash } });
  return id;
}
const credential = (userId: string) => prisma.approvalPinCredential.findUnique({ where: { userId } });
const as = (id: string | null, role = "EMPLOYEE") => {
  session.current = id ? { user: { id, role, name: id, email: `${id}@test.local` } } : null;
};
const setPin = (userId: string, pin = NEW_PIN, password = PASSWORD, from = ip()) => setOwnPin({ userId, currentPassword: password, pin, ip: from });
const reset = (adminId: string, targetUserId: string, over: Partial<Parameters<typeof resetPinAsAdmin>[0]> = {}) =>
  resetPinAsAdmin({ adminId, adminPassword: ADMIN_PASSWORD, targetUserId, reason: "Ажилтан PIN-ээ мартсан, биечлэн баталгаажуулсан", identityVerified: true, ip: ip(), ...over });
const status = (r: { ok: boolean } & { status?: number }) => (r.ok ? 200 : r.status);
const lock = async (userId: string) => {
  for (let i = 0; i < 5; i++) await verifyPin(userId, WRONG);
};

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY", "hops:1");
  hash = await bcrypt.hash(PASSWORD, 4);
  adminHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  pinHash = await bcrypt.hash(PIN, 4);
  await prisma.loginThrottle.deleteMany();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.stubEnv("TRUSTED_PROXY", "hops:1");
  await prisma.loginThrottle.deleteMany();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.loginThrottle.deleteMany();
  await prisma.materialRequest.deleteMany({ where: { requestNumber: { startsWith: `PMX-${TAG}` } } });
  await prisma.notification.deleteMany({ where: { userId: { in: created } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: created } }, { entityId: { in: created } }] } });
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { in: created } } });
  await prisma.department.deleteMany({ where: { id: { startsWith: `${P}dept-${TAG}` } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe("setting and changing a PIN needs the account password", () => {
  it("creates the first PIN with the right password; the PIN then verifies; the audit entry holds no secret", async () => {
    const u = await user();
    expect(await credential(u)).toBeNull();
    expect(status(await setPin(u, PIN, "wrong-password"))).toBe(401);
    expect(await credential(u)).toBeNull(); // a wrong password changes nothing
    const ok = await setPin(u, PIN);
    expect(ok).toEqual({ ok: true, created: true });
    expect(await verifyPin(u, PIN)).toEqual({ ok: true });
    const logs = await prisma.auditLog.findMany({ where: { actorId: u, action: "PIN_SETUP" } });
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].afterJson!)).toEqual({ event: "PIN_CREATED" });
    const row = await credential(u);
    for (const l of logs) for (const secret of [PIN, row!.pinHash, PASSWORD]) expect(JSON.stringify(l)).not.toContain(secret);
  });

  it("changes an existing PIN only with the password: the old PIN stops working, the new one works", async () => {
    const u = await user({ pin: true });
    const before = (await credential(u))!.pinHash;
    expect(status(await setPin(u, NEW_PIN, "wrong-password"))).toBe(401);
    expect((await credential(u))!.pinHash).toBe(before);
    expect(await setPin(u, NEW_PIN)).toEqual({ ok: true, created: false });
    expect(await verifyPin(u, PIN)).toMatchObject({ ok: false, status: 401 });
    expect(await verifyPin(u, NEW_PIN)).toEqual({ ok: true });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { actorId: u, action: "PIN_SETUP" } });
    expect(JSON.parse(log.afterJson!)).toEqual({ event: "PIN_CHANGED" });
  });

  it("a malformed PIN is refused before any password attempt or bcrypt work is spent", async () => {
    const u = await user();
    const compare = vi.spyOn(bcrypt, "compare");
    for (const bad of ["123", "12345", "abcd", "12 4", "", "１２３４"]) expect(status(await setPin(u, bad, PASSWORD)), JSON.stringify(bad)).toBe(400);
    expect(compare).not.toHaveBeenCalled();
    expect(await prisma.loginThrottle.count()).toBe(0);
    expect(await credential(u)).toBeNull();
  });

  it("guessing the password through PIN setup is limited, and the budget is shared with the password-change endpoint", async () => {
    const u = await user();
    const from = ip();
    for (let i = 0; i < 4; i++) expect(status(await setPin(u, NEW_PIN, "guess", from))).toBe(401);
    // one more guess elsewhere (the password-change endpoint draws on the same buckets) uses up the fifth unit
    expect((await admit(passwordChangeBuckets(u, from))).ok).toBe(true);
    const blocked = await setPin(u, NEW_PIN, PASSWORD, from);
    expect(blocked).toMatchObject({ ok: false, status: 429 });
    expect((blocked as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    expect(await credential(u)).toBeNull();
  });

  it("20 simultaneous password guesses: exactly 5 are evaluated", async () => {
    const u = await user();
    const compare = vi.spyOn(bcrypt, "compare");
    const results = await Promise.all(Array.from({ length: 20 }, () => setPin(u, NEW_PIN, "guess")));
    expect(results.filter((r) => status(r) === 401)).toHaveLength(LIMITS.passwordUser);
    expect(results.filter((r) => status(r) === 429)).toHaveLength(20 - LIMITS.passwordUser);
    expect(compare).toHaveBeenCalledTimes(LIMITS.passwordUser);
  });

  it("simultaneous first-time setups (within the password budget) end with exactly one credential and no error", async () => {
    const u = await user();
    const results = await Promise.all(Array.from({ length: LIMITS.passwordUser }, (_, i) => setPin(u, String(1000 + i), PASSWORD, ip())));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.created)).toHaveLength(1);
    expect(await prisma.approvalPinCredential.count({ where: { userId: u } })).toBe(1);
  });
});

describe("setting or changing a PIN cannot clear or bypass a lockout", () => {
  it("a locked account cannot change its PIN (423), and the lock, counter and hash stay exactly as they were", async () => {
    const u = await user({ pin: true });
    await lock(u);
    const locked = (await credential(u))!;
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const result = await setPin(u, NEW_PIN);
    expect(result).toMatchObject({ ok: false, status: 423 });
    const after = (await credential(u))!;
    expect(after.pinHash).toBe(locked.pinHash);
    expect(after.lockedUntil).toEqual(locked.lockedUntil);
    expect(after.failedAttempts).toBe(locked.failedAttempts);
    expect(await verifyPin(u, PIN)).toMatchObject({ ok: false, status: 423 }); // still locked, even for the right PIN
  });

  it("a locked account cannot even create a credential-less shortcut: the lock only ends by time or by an ADMIN reset", async () => {
    const u = await user({ pin: true });
    await lock(u);
    await prisma.approvalPinCredential.update({ where: { userId: u }, data: { lockedUntil: new Date(Date.now() - 60_000) } });
    expect(await setPin(u, NEW_PIN)).toEqual({ ok: true, created: false }); // expired lock: allowed
    expect(await verifyPin(u, NEW_PIN)).toEqual({ ok: true });
  });

  it("changing the PIN does not reset the failed-attempt counter", async () => {
    const u = await user({ pin: true });
    for (let i = 0; i < 3; i++) await verifyPin(u, WRONG);
    expect((await credential(u))!.failedAttempts).toBe(3);
    expect((await setPin(u)).ok).toBe(true);
    expect(await credential(u)).toMatchObject({ failedAttempts: 3, lockedUntil: null });
    // so the budget really is what is left: two more wrong guesses lock it
    await verifyPin(u, WRONG);
    await verifyPin(u, WRONG);
    expect(await verifyPin(u, NEW_PIN)).toMatchObject({ ok: false, status: 423 });
  });

  it("20 simultaneous changes against a locked account all fail and change nothing", async () => {
    const u = await user({ pin: true });
    await lock(u);
    const before = (await credential(u))!;
    const results = await Promise.all(Array.from({ length: 20 }, () => setPin(u, NEW_PIN, PASSWORD, ip())));
    // those within the password budget are refused because of the lock (423), the rest by the rate limit (429)
    expect(results.every((r) => !r.ok && (r.status === 423 || r.status === 429))).toBe(true);
    expect(results.filter((r) => status(r) === 423).length).toBeGreaterThan(0);
    const after = (await credential(u))!;
    expect(after.pinHash).toBe(before.pinHash);
    expect(after.lockedUntil).toEqual(before.lockedUntil);
  });

  it("changes racing a burst of wrong guesses never raise the number of guesses that get evaluated", async () => {
    for (let round = 0; round < 3; round++) {
      const u = await user({ pin: true });
      const guesses = Array.from({ length: 40 }, () => verifyPin(u, WRONG));
      const changes = Array.from({ length: 10 }, () => setPin(u, NEW_PIN, PASSWORD, ip()));
      const [verdicts] = await Promise.all([Promise.all(guesses), Promise.all(changes)]);
      const evaluated = verdicts.filter((r) => !r.ok && (r.status === 401 || (r.status === 423 && r.error.includes("түгжигдлээ"))));
      expect(evaluated.length).toBeLessThanOrEqual(5);
      expect((await credential(u))!.lockedUntil!.getTime()).toBeGreaterThan(Date.now()); // the account ends up locked
    }
  });
});

describe("ADMIN reset", () => {
  it("deletes the credential, records who/whom/why/when, tells the employee, and returns nothing about any PIN", async () => {
    const admin = await user({ role: "ADMIN" });
    const target = await user({ pin: true });
    const result = await reset(admin, target, { reason: "  Утсаар буцаж залгаж баталгаажуулсан  " });
    expect(result).toEqual({ ok: true, hadPin: true });
    expect(await credential(target)).toBeNull();
    expect(await verifyPin(target, PIN)).toMatchObject({ ok: false, status: 400 }); // "set a PIN first"
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: target, action: "RESET_CREDENTIALS" } });
    expect(log).toMatchObject({ actorId: admin, entityType: "User" });
    expect(log.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(JSON.parse(log.afterJson!)).toMatchObject({ kind: "PIN_RESET", reason: "Утсаар буцаж залгаж баталгаажуулсан", identityVerified: true, hadPin: true, targetUserId: target });
    expect(JSON.stringify(log)).not.toMatch(new RegExp(`${PIN}|\\$2[aby]\\$`));
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: target } });
    expect(note.title).toContain("PIN");
    expect(note.body).not.toContain(PIN);
    // the employee creates a new PIN with THEIR password; the admin's password does not work for that
    expect(status(await setPin(target, NEW_PIN, ADMIN_PASSWORD))).toBe(401);
    expect(await setPin(target, NEW_PIN)).toEqual({ ok: true, created: true });
    expect(await verifyPin(target, NEW_PIN)).toEqual({ ok: true });
  });

  it("clears a lockout (the designated recovery path) and a user without a PIN is reported honestly", async () => {
    const admin = await user({ role: "ADMIN" });
    const locked = await user({ pin: true });
    await lock(locked);
    expect(await reset(admin, locked)).toEqual({ ok: true, hadPin: true });
    expect(await setPin(locked)).toEqual({ ok: true, created: true });
    expect(await verifyPin(locked, NEW_PIN)).toEqual({ ok: true });
    const none = await user();
    expect(await reset(admin, none)).toEqual({ ok: true, hadPin: false });
  });

  it("needs a reason and the identity attestation; nothing is deleted otherwise", async () => {
    const admin = await user({ role: "ADMIN" });
    const target = await user({ pin: true });
    for (const over of [{ reason: "" }, { reason: "  ab " }, { reason: "x".repeat(501) }, { identityVerified: false }]) {
      expect(status(await reset(admin, target, over as never)), JSON.stringify(over).slice(0, 40)).toBe(400);
    }
    expect(await credential(target)).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: target, action: "RESET_CREDENTIALS" } })).toBe(0);
  });

  it("only an active ADMIN can do it, even if the caller's session claims otherwise", async () => {
    const target = await user({ pin: true });
    const director = await user({ role: "DIRECTOR" });
    const manager = await user({ role: "MANAGER" });
    const employee = await user();
    const inactiveAdmin = await user({ role: "ADMIN", active: false });
    for (const actor of [director, manager, employee, inactiveAdmin, target]) {
      const r = await reset(actor, target, { adminPassword: actor === inactiveAdmin ? ADMIN_PASSWORD : PASSWORD });
      expect(status(r), actor).toBe(403);
    }
    expect(await credential(target)).not.toBeNull();
  });

  it("an administrator cannot reset their own PIN (that would sidestep a lockout with only a password); an unknown user is a 404", async () => {
    const admin = await user({ role: "ADMIN", pin: true });
    expect(status(await reset(admin, admin))).toBe(400);
    expect(await credential(admin)).not.toBeNull();
    expect(status(await reset(admin, `${P}no-such-user`))).toBe(404);
  });

  it("re-authenticates the administrator: a wrong password deletes nothing, and guessing it is limited", async () => {
    const admin = await user({ role: "ADMIN" });
    const target = await user({ pin: true });
    const from = ip();
    for (let i = 0; i < LIMITS.passwordUser; i++) expect(status(await reset(admin, target, { adminPassword: "guess", ip: from })), `guess ${i + 1}`).toBe(401);
    expect(await credential(target)).not.toBeNull();
    const blocked = await reset(admin, target, { ip: from }); // even the right password is refused while limited
    expect(status(blocked)).toBe(429);
    expect(await credential(target)).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: target, action: "RESET_CREDENTIALS" } })).toBe(0);
  });

  it("is rate limited per employee (3) and per administrator (20) so resets cannot be used to harass or mass-disable", async () => {
    const admin = await user({ role: "ADMIN" });
    const target = await user({ pin: true });
    for (let i = 0; i < LIMITS.pinResetTarget; i++) {
      await prisma.approvalPinCredential.upsert({ where: { userId: target }, update: { pinHash }, create: { userId: target, pinHash } });
      expect(status(await reset(admin, target)), `reset ${i + 1}`).toBe(200);
    }
    expect(status(await reset(admin, target))).toBe(429);
    // a different administrator's reset of the same person is not blocked by the first one's password budget, but the person limit still holds
    const other = await user({ role: "ADMIN" });
    expect(status(await reset(other, target))).toBe(429);

    const busy = await user({ role: "ADMIN" });
    const targets = await Promise.all(Array.from({ length: LIMITS.pinResetAdmin + 1 }, () => user({ pin: true })));
    const verdicts: number[] = [];
    for (const t of targets) verdicts.push(status(await reset(busy, t)) as number);
    expect(verdicts.slice(0, LIMITS.pinResetAdmin).every((s) => s === 200)).toBe(true);
    expect(verdicts[LIMITS.pinResetAdmin]).toBe(429);
  });

  it("5 simultaneous resets of one employee: only the allowed number go through, and each leaves a record", async () => {
    const admin = await user({ role: "ADMIN" });
    const target = await user({ pin: true });
    const results = await Promise.all(Array.from({ length: 5 }, () => reset(admin, target)));
    expect(results.filter((r) => r.ok)).toHaveLength(LIMITS.pinResetTarget);
    expect(await prisma.auditLog.count({ where: { entityId: target, action: "RESET_CREDENTIALS" } })).toBe(LIMITS.pinResetTarget);
  });

  it("a reset racing the employee's own PIN change leaves a consistent state: no credential, or the employee's new PIN", async () => {
    for (let round = 0; round < 6; round++) {
      const admin = await user({ role: "ADMIN" });
      const target = await user({ pin: true });
      const [r, s] = await Promise.all([reset(admin, target), setPin(target, NEW_PIN, PASSWORD, ip())]);
      expect(r.ok && s.ok).toBe(true);
      const row = await credential(target);
      if (row) expect(await bcrypt.compare(NEW_PIN, row.pinHash)).toBe(true); // the change landed after the reset
      expect(await prisma.auditLog.count({ where: { entityId: target, action: "RESET_CREDENTIALS" } })).toBe(1);
    }
  });

  it("gives the ADMIN no approval authority: after resetting an approver's PIN the admin still cannot approve for them", async () => {
    const admin = await user({ role: "ADMIN" });
    const exec = await user({ role: "DIRECTOR", pin: true });
    const dept = `${P}dept-${TAG}`;
    await prisma.department.create({ data: { id: dept, name: `D ${TAG}`, type: "OFFICE" } });
    const request = await prisma.materialRequest.create({
      data: {
        requestNumber: `PMX-${TAG}`,
        year: 9996,
        sequence: 1,
        departmentId: dept,
        requestedById: exec,
        status: "PENDING_EXECUTIVE_APPROVAL",
        approvalSteps: { create: [{ type: "EXECUTIVE_APPROVAL", sequence: 1, status: "PENDING", assignedUserId: exec }] },
      },
    });
    expect((await reset(admin, exec)).ok).toBe(true);
    // the admin holds no PIN and the approval still belongs to the assigned executive
    const attempt = await executiveApprove(request.id, admin, PIN, request.version);
    expect(attempt).toMatchObject({ ok: false, status: 403 });
    expect(await verifyPin(admin, PIN)).toMatchObject({ ok: false, status: 400 });
    expect(await credential(admin)).toBeNull();
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING_EXECUTIVE_APPROVAL");
    // and the executive cannot approve until they create a new PIN with their own password
    expect(await executiveApprove(request.id, exec, PIN, request.version)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("the limiter failing is safe", () => {
  it("setup and reset are refused with a generic 503 and change nothing when the throttle table is unavailable", async () => {
    const admin = await user({ role: "ADMIN" });
    const target = await user({ pin: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hashSpy = vi.spyOn(bcrypt, "hash");
    await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle" RENAME TO "LoginThrottle_away"`);
    let setResult, resetResult;
    try {
      setResult = await setPin(target, NEW_PIN);
      resetResult = await reset(admin, target);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle_away" RENAME TO "LoginThrottle"`);
    }
    expect(setResult).toMatchObject({ ok: false, status: 503 });
    expect(resetResult).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify([setResult, resetResult])).not.toMatch(/LoginThrottle|relation|postgres|SELECT|INSERT/i);
    expect(hashSpy).not.toHaveBeenCalled();
    expect((await credential(target))!.pinHash).toBe(pinHash);
  });
});

describe("routes", () => {
  const body = (data: unknown, from = ip()) => new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": from }, body: JSON.stringify(data) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

  it("GET /api/me/pin is unchanged: 401 without a session, otherwise {hasPin}", async () => {
    as(null);
    expect((await PIN_GET()).status).toBe(401);
    const u = await user({ pin: true });
    as(u);
    expect(await (await PIN_GET()).json()).toEqual({ hasPin: true });
  });

  it("POST /api/me/pin: 401 without a session; 400 for a missing password, a bad PIN or a mismatch; the user comes from the session only", async () => {
    as(null);
    expect((await PIN_POST(body({ pin: PIN, confirmPin: PIN, currentPassword: PASSWORD }))).status).toBe(401);
    const u = await user();
    const victim = await user({ pin: true });
    const victimBefore = (await credential(victim))!.pinHash;
    as(u);
    expect((await PIN_POST(body({ pin: PIN, confirmPin: PIN }))).status).toBe(400); // no password
    expect((await PIN_POST(body({ pin: "12", confirmPin: "12", currentPassword: PASSWORD }))).status).toBe(400);
    expect((await PIN_POST(body({ pin: PIN, confirmPin: "4321", currentPassword: PASSWORD }))).status).toBe(400);
    expect(await credential(u)).toBeNull();
    // a body naming somebody else is ignored: it is always the session's user who is changed
    const res = await PIN_POST(body({ pin: PIN, confirmPin: PIN, currentPassword: PASSWORD, userId: victim }));
    expect(res.status).toBe(200);
    expect(await credential(u)).not.toBeNull();
    expect((await credential(victim))!.pinHash).toBe(victimBefore);
    expect((await PIN_POST(body({ pin: PIN, confirmPin: PIN, currentPassword: "nope" }))).status).toBe(401);
  });

  it("POST /api/me/pin answers 423 for a locked account and 429 (with Retry-After) when the password is guessed too often", async () => {
    const u = await user({ pin: true });
    as(u);
    await lock(u);
    const locked = await PIN_POST(body({ pin: NEW_PIN, confirmPin: NEW_PIN, currentPassword: PASSWORD }));
    expect(locked.status).toBe(423);
    const v = await user();
    as(v);
    for (let i = 0; i < LIMITS.passwordUser; i++) await PIN_POST(body({ pin: PIN, confirmPin: PIN, currentPassword: "guess" }, "203.0.113.5"));
    const limited = await PIN_POST(body({ pin: PIN, confirmPin: PIN, currentPassword: PASSWORD }, "203.0.113.5"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("POST /api/admin/users/[id]/reset-pin: 403 for everyone but an ADMIN, 400 without the attestation/reason/password, 200 for a proper request", async () => {
    const admin = await user({ role: "ADMIN" });
    const target = await user({ pin: true });
    const good = { reason: "Биечлэн баталгаажуулсан", identityVerified: true, adminPassword: ADMIN_PASSWORD };
    as(null);
    expect((await RESET_POST(body(good), ctx(target))).status).toBe(403);
    for (const role of ["EMPLOYEE", "DIRECTOR", "MANAGER", "BOSS"]) {
      as(await user(), role);
      expect((await RESET_POST(body(good), ctx(target))).status, role).toBe(403);
    }
    as(admin, "ADMIN");
    for (const bad of [{ ...good, identityVerified: false }, { ...good, identityVerified: undefined }, { ...good, reason: "" }, { ...good, adminPassword: "" }, {}]) {
      expect((await RESET_POST(body(bad), ctx(target))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await credential(target)).not.toBeNull();
    const ok = await RESET_POST(body(good), ctx(target));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, hadPin: true }); // nothing about any PIN
    expect(await credential(target)).toBeNull();
  });
});
