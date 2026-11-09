import bcrypt from "bcrypt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { approvalCapability, approvalCapabilityOrUnknown } from "./credential-guard";
import { createUserAsAdmin, resetPasswordAsAdmin } from "./credential-reset";
import { LIMITS, WINDOW_MS } from "./login-throttle";

// ADMIN password reset and user creation (Stage 1 hardening), against the isolated test database. Only the session
// lookup is replaced (for the route handlers); the services, the shared PostgreSQL throttle, the audit log and the
// notifications are real.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { POST as RESET_ROUTE } from "@/app/api/admin/users/[id]/reset-credentials/route";
import { GET as USERS_GET, POST as USERS_POST } from "@/app/api/admin/users/route";

const P = "cr-";
const TAG = Date.now().toString(36);
const ADMIN_PASSWORD = "Admin-pw-1";
const EMP_PASSWORD = "Employee-pw-1";
const REASON = "Ажилтан нууц үгээ мартсан, утсаар буцаж залгаж баталгаажуулсан";
let adminHash = "";
let empHash = "";
let n = 0;
let ipN = 0;
const ip = () => `10.99.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const created: string[] = [];
const extraCleanup = { departments: [] as string[], requests: [] as string[] };

type Role = "ADMIN" | "DIRECTOR" | "BOSS" | "MANAGER" | "STOREKEEPER" | "EMPLOYEE" | "ENGINEERING" | "CHIEF_ACCOUNTANT";
async function user(role: Role = "EMPLOYEE", opts: { active?: boolean } = {}) {
  n += 1;
  const id = `${P}${TAG}-${n}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role, passwordHash: role === "ADMIN" ? adminHash : empHash, isActive: opts.active ?? true } });
  created.push(id);
  return id;
}
const hashOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash;
const resetAudit = (target: string) => prisma.auditLog.findMany({ where: { entityId: target, action: "RESET_CREDENTIALS" } });
const refusals = (admin: string) => prisma.auditLog.findMany({ where: { actorId: admin, action: "REJECT", entityType: "UserCredentialReset" } });
const notes = (target: string) => prisma.notification.findMany({ where: { userId: target } });
const status = (r: { ok: boolean } & { status?: number }) => (r.ok ? 200 : r.status);

const reset = (admin: string, target: string, over: Partial<Parameters<typeof resetPasswordAsAdmin>[0]> = {}) =>
  resetPasswordAsAdmin({ adminId: admin, adminPassword: ADMIN_PASSWORD, targetUserId: target, reason: REASON, identityVerified: true, ip: ip(), ...over });
const create = (admin: string, over: Partial<Parameters<typeof createUserAsAdmin>[0]> = {}, data: Partial<Parameters<typeof createUserAsAdmin>[0]["data"]> = {}) => {
  n += 1;
  return createUserAsAdmin({
    adminId: admin,
    adminPassword: ADMIN_PASSWORD,
    ip: ip(),
    data: { email: `${P}new-${TAG}-${n}@test.local`, name: `New ${n}`, role: "EMPLOYEE", ...data },
    ...over,
  });
};

async function withoutTable<T>(table: string, fn: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME TO "${table}_away"`);
  try {
    return await fn();
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}_away" RENAME TO "${table}"`);
  }
}
async function withConstraint<T>(table: string, name: string, check: string, fn: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${check}) NOT VALID`);
  try {
    return await fn();
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
  }
}

/** A department (optionally headed by someone) and a request with one open step / one item, for the capability checks. */
async function scaffold() {
  const dept = `${P}dept-${TAG}-${++n}`;
  await prisma.department.create({ data: { id: dept, name: dept, type: "OFFICE" } });
  extraCleanup.departments.push(dept);
  return dept;
}
async function request(dept: string, requester: string, assignee: string | null, itemAssignee?: string) {
  const req = await prisma.materialRequest.create({
    data: {
      requestNumber: `CRX-${TAG}-${++n}`,
      year: 9995,
      sequence: n,
      departmentId: dept,
      requestedById: requester,
      status: "PENDING_FINANCE_APPROVAL",
      items: { create: [{ lineNo: 1, manualMaterialName: "x", unit: "ш", requestedQuantity: 1 }] },
      ...(assignee ? { approvalSteps: { create: [{ type: "FINANCE_APPROVAL" as const, sequence: 1, status: "PENDING" as const, assignedUserId: assignee }] } } : {}),
    },
    include: { items: true },
  });
  extraCleanup.requests.push(req.id);
  if (itemAssignee) await prisma.procurementItemAssignment.create({ data: { requestItemId: req.items[0].id, kind: "DOMESTIC", assignedManagerId: itemAssignee } });
  return req;
}

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY", "hops:1");
  adminHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  empHash = await bcrypt.hash(EMP_PASSWORD, 4);
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
  const made = (await prisma.user.findMany({ where: { email: { startsWith: `${P}new-${TAG}` } }, select: { id: true } })).map((u) => u.id);
  const all = [...created, ...made];
  await prisma.materialRequest.deleteMany({ where: { id: { in: extraCleanup.requests } } });
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { in: all } } });
  await prisma.department.updateMany({ where: { id: { in: extraCleanup.departments } }, data: { headId: null } });
  await prisma.department.deleteMany({ where: { id: { in: extraCleanup.departments } } });
  await prisma.notification.deleteMany({ where: { userId: { in: all } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: all } }, { entityId: { in: all } }] } });
  await prisma.user.deleteMany({ where: { id: { in: all } } });
});

describe("approval-capable accounts cannot be reset", () => {
  it("any role other than EMPLOYEE/ADMIN is refused (403): hash, notifications and the success audit stay untouched", async () => {
    const admin = await user("ADMIN");
    for (const role of ["BOSS", "DIRECTOR", "MANAGER", "STOREKEEPER", "ENGINEERING", "CHIEF_ACCOUNTANT"] as const) {
      const target = await user(role);
      const before = await hashOf(target);
      const r = await reset(admin, target);
      expect(status(r), role).toBe(403);
      if (!r.ok) expect(r.error).toContain("Батлах эрхтэй");
      expect(await hashOf(target)).toBe(before);
      expect(await notes(target)).toHaveLength(0);
      expect((await resetAudit(target)).filter((a) => (JSON.parse(a.afterJson!) as { kind: string }).kind === "PASSWORD_RESET")).toHaveLength(0);
      await prisma.loginThrottle.deleteMany(); // each role is a separate scenario with a fresh budget
    }
  });

  it("an EMPLOYEE who nevertheless holds authority is protected: department head, active position, open step, procurement items", async () => {
    const admin = await user("ADMIN");
    const dept = await scaffold();

    const head = await user();
    await prisma.department.update({ where: { id: dept }, data: { headId: head } });
    const position = await user();
    await prisma.approvalRoleAssignment.create({ data: { role: "ENGINEERING_CHIEF", userId: position, isActive: true } });
    const assignee = await user();
    await request(dept, head, assignee);
    const buyer = await user();
    await request(dept, head, null, buyer);

    for (const [label, target] of [["department head", head], ["active position", position], ["open approval step", assignee], ["procurement items", buyer]] as const) {
      const before = await hashOf(target);
      expect(status(await reset(admin, target)), label).toBe(403);
      expect(await hashOf(target), label).toBe(before);
      await prisma.loginThrottle.deleteMany();
    }
    const reasons = Object.fromEntries(await Promise.all([[head, "DEPARTMENT_HEAD"], [position, "POSITION"], [assignee, "PENDING_STEP"], [buyer, "PROCUREMENT"]].map(async ([id, code]) => [code, (await approvalCapability(prisma, id)).reasons])));
    expect(reasons).toEqual({ DEPARTMENT_HEAD: ["DEPARTMENT_HEAD"], POSITION: ["POSITION"], PENDING_STEP: ["PENDING_STEP"], PROCUREMENT: ["PROCUREMENT"] });
    await prisma.approvalRoleAssignment.deleteMany({ where: { userId: position } });
  });

  it("an INACTIVE account that keeps a sensitive assignment is still protected", async () => {
    const admin = await user("ADMIN");
    const dept = await scaffold();
    const gone = await user("EMPLOYEE", { active: false });
    await prisma.department.update({ where: { id: dept }, data: { headId: gone } });
    const before = await hashOf(gone);
    expect(status(await reset(admin, gone))).toBe(403);
    expect(await hashOf(gone)).toBe(before);
    // an inactive approver by role as well
    const retired = await user("DIRECTOR", { active: false });
    expect(status(await reset(admin, retired))).toBe(403);
  });

  it("a plain EMPLOYEE (and an ended position) can be reset; another ADMIN can be too (documented)", async () => {
    const admin = await user("ADMIN");
    const plain = await user();
    expect(status(await reset(admin, plain))).toBe(200);
    const ended = await user();
    await prisma.approvalRoleAssignment.create({ data: { role: "STOREKEEPER_LEAD", userId: ended, isActive: false, endedAt: new Date() } });
    expect(status(await reset(admin, ended))).toBe(200);
    const otherAdmin = await user("ADMIN");
    expect(status(await reset(admin, otherAdmin))).toBe(200);
    expect((await approvalCapability(prisma, plain)).capable).toBe(false);
  });

  it("fails closed: if authority cannot be determined the reset is refused and nothing changes", async () => {
    const admin = await user("ADMIN");
    const target = await user();
    const before = await hashOf(target);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await withoutTable("ApprovalRoleAssignment", () => reset(admin, target));
    expect(status(r)).toBe(403);
    expect(await hashOf(target)).toBe(before);
    expect(await notes(target)).toHaveLength(0);
    // the guard itself: an unknown user and a broken database both read as capable
    expect(await approvalCapabilityOrUnknown(prisma, `${P}nobody`)).toEqual({ capable: true, reasons: ["UNDETERMINED"] });
    const broken = await withoutTable("Department", () => approvalCapabilityOrUnknown(prisma, target));
    expect(broken).toEqual({ capable: true, reasons: ["UNDETERMINED"] });
  });

  it("the payload cannot argue the restriction away: only the path decides the target, extra fields are ignored", async () => {
    const admin = await user("ADMIN");
    const boss = await user("BOSS");
    const before = await hashOf(boss);
    session.current = { user: { id: admin, role: "ADMIN" } };
    const res = await RESET_ROUTE(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: REASON, identityVerified: true, adminPassword: ADMIN_PASSWORD, role: "EMPLOYEE", approvalCapable: false, targetUserId: "someone-else", force: true, skipChecks: true }) }),
      { params: Promise.resolve({ id: boss }) } as never
    );
    expect(res.status).toBe(403);
    expect(await hashOf(boss)).toBe(before);
  });
});

describe("who may reset", () => {
  it("non-ADMIN roles, an inactive ADMIN and the ADMIN themselves are refused with 403", async () => {
    const target = await user();
    const before = await hashOf(target);
    for (const role of ["EMPLOYEE", "DIRECTOR", "MANAGER", "BOSS"] as const) {
      const actor = await user(role);
      expect(status(await reset(actor, target, { adminPassword: EMP_PASSWORD })), role).toBe(403);
    }
    const inactive = await user("ADMIN", { active: false });
    expect(status(await reset(inactive, target))).toBe(403); // the session may still claim ADMIN; the database decides
    const admin = await user("ADMIN");
    const self = await reset(admin, admin);
    expect(status(self)).toBe(403);
    if (!self.ok) expect(self.error).toContain("Өөрийн нууц үгийг");
    expect(await hashOf(target)).toBe(before);
    expect(await resetAudit(target)).toHaveLength(0);
  });

  it("route: 403 for any non-ADMIN session and for no session, and a stale ADMIN claim does not help an inactive ADMIN", async () => {
    const target = await user();
    const body = () => new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: REASON, identityVerified: true, adminPassword: ADMIN_PASSWORD }) });
    const ctx = { params: Promise.resolve({ id: target }) } as never;
    session.current = null;
    expect((await RESET_ROUTE(body(), ctx)).status).toBe(403);
    for (const role of ["EMPLOYEE", "DIRECTOR", "MANAGER", "BOSS", "STOREKEEPER"]) {
      session.current = { user: { id: await user(), role } };
      expect((await RESET_ROUTE(body(), ctx)).status, role).toBe(403);
    }
    const inactive = await user("ADMIN", { active: false });
    session.current = { user: { id: inactive, role: "ADMIN" } };
    expect((await RESET_ROUTE(body(), ctx)).status).toBe(403);
    expect((await resetAudit(target)).length).toBe(0);
  });
});

describe("re-authentication and required fields", () => {
  it("needs the ADMIN's own password: missing or wrong is rejected, another person's password is not accepted", async () => {
    const admin = await user("ADMIN");
    const target = await user();
    const before = await hashOf(target);
    expect(status(await reset(admin, target, { adminPassword: "" }))).toBe(400);
    expect(status(await reset(admin, target, { adminPassword: "wrong" }))).toBe(401);
    expect(status(await reset(admin, target, { adminPassword: EMP_PASSWORD }))).toBe(401); // the employee's own password is not the admin's
    expect(await hashOf(target)).toBe(before);
    expect(await notes(target)).toHaveLength(0);
  });

  it("needs a reason of 3-500 characters and the identity attestation", async () => {
    const admin = await user("ADMIN");
    const target = await user();
    const before = await hashOf(target);
    for (const over of [{ reason: "" }, { reason: "  ab  " }, { reason: "x".repeat(501) }, { identityVerified: false }, { identityVerified: undefined as never }, { identityVerified: "true" as never }]) {
      expect(status(await reset(admin, target, over)), JSON.stringify(over).slice(0, 50)).toBe(400);
    }
    expect(await hashOf(target)).toBe(before);
    expect(await prisma.loginThrottle.count()).toBe(0); // malformed requests cost no attempt
  });

  it("route validation: missing fields are 400, a mismatched attestation type is 400", async () => {
    const admin = await user("ADMIN");
    const target = await user();
    session.current = { user: { id: admin, role: "ADMIN" } };
    const call = (b: unknown) => RESET_ROUTE(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(b) }), { params: Promise.resolve({ id: target }) } as never);
    for (const bad of [{}, { reason: REASON }, { reason: REASON, identityVerified: true }, { reason: REASON, adminPassword: ADMIN_PASSWORD }, { reason: "", identityVerified: true, adminPassword: ADMIN_PASSWORD }, { reason: REASON, identityVerified: "yes", adminPassword: ADMIN_PASSWORD }]) {
      expect((await call(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("guessing the admin password is limited by the shared password budget", async () => {
    const admin = await user("ADMIN");
    const from = ip();
    const targets = await Promise.all(Array.from({ length: 6 }, () => user()));
    const verdicts: (number | undefined)[] = [];
    for (const t of targets) verdicts.push(status(await reset(admin, t, { adminPassword: "guess", ip: from })));
    // 5 attempts per administrator per window (the reset limit); the sixth never reaches a password check
    expect(verdicts.slice(0, LIMITS.credentialResetAdmin)).toEqual([401, 401, 401, 401, 401]);
    expect(verdicts[LIMITS.credentialResetAdmin]).toBe(429);
  });
});

describe("rate limits (every attempt counts, failed or not)", () => {
  it("5 attempts per administrator per window: failures and refusals use the same budget as successes", async () => {
    const admin = await user("ADMIN");
    const plain = await Promise.all(Array.from({ length: 6 }, () => user()));
    const boss = await user("BOSS");
    const verdicts = [
      status(await reset(admin, plain[0], { adminPassword: "wrong" })), // failed
      status(await reset(admin, boss)), // refused (approval-capable)
      status(await reset(admin, plain[1])), // success
      status(await reset(admin, plain[2], { adminPassword: "wrong" })), // failed
      status(await reset(admin, plain[3])), // success
      status(await reset(admin, plain[4])), // would succeed: the budget is spent
    ];
    expect(verdicts).toEqual([401, 403, 200, 401, 200, 429]);
    expect(await resetAudit(plain[4])).toHaveLength(0);
  });

  it("3 attempts per employee per window, whichever administrator makes them", async () => {
    const [a1, a2, a3] = [await user("ADMIN"), await user("ADMIN"), await user("ADMIN")];
    const target = await user();
    expect([status(await reset(a1, target, { adminPassword: "wrong" })), status(await reset(a2, target, { adminPassword: "wrong" })), status(await reset(a1, target))]).toEqual([401, 401, 200]);
    const fourth = await reset(a3, target);
    expect(status(fourth)).toBe(429);
    if (!fourth.ok) expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("the limits end by themselves when the window passes", async () => {
    const admin = await user("ADMIN");
    const targets = await Promise.all(Array.from({ length: 6 }, () => user()));
    for (let i = 0; i < LIMITS.credentialResetAdmin; i++) await reset(admin, targets[i]);
    expect(status(await reset(admin, targets[5]))).toBe(429);
    await prisma.$executeRaw`UPDATE "LoginThrottle" SET "windowStart" = "windowStart" - ${WINDOW_MS / 1000 + 60} * interval '1 second'`;
    expect(status(await reset(admin, targets[5]))).toBe(200);
  });

  it("12 simultaneous resets by one administrator: exactly 5 are evaluated, the rest are refused unevaluated", async () => {
    const admin = await user("ADMIN");
    const targets = await Promise.all(Array.from({ length: 12 }, () => user()));
    const results = await Promise.all(targets.map((t) => reset(admin, t, { ip: ip() })));
    expect(results.filter((r) => status(r) === 429)).toHaveLength(12 - LIMITS.credentialResetAdmin);
    expect(results.filter((r) => status(r) !== 429)).toHaveLength(LIMITS.credentialResetAdmin);
    let changed = 0;
    for (const t of targets) if ((await hashOf(t)) !== empHash) changed++;
    expect(changed).toBe(results.filter((r) => r.ok).length);
    expect(changed).toBeLessThanOrEqual(LIMITS.credentialResetAdmin);
  });

  it("10 simultaneous resets of one employee by several administrators: at most 3 are evaluated", async () => {
    const admins = await Promise.all(Array.from({ length: 4 }, () => user("ADMIN")));
    const target = await user();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => reset(admins[i % 4], target, { ip: ip() })));
    expect(results.filter((r) => status(r) !== 429).length).toBeLessThanOrEqual(LIMITS.credentialResetTarget);
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(LIMITS.credentialResetTarget);
    expect((await resetAudit(target)).filter((a) => (JSON.parse(a.afterJson!) as { kind: string }).kind === "PASSWORD_RESET").length).toBe(results.filter((r) => r.ok).length);
  });

  it("limiter unavailable: refused (503) with nothing changed and no bcrypt work on a temporary password", async () => {
    const admin = await user("ADMIN");
    const target = await user();
    const before = await hashOf(target);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hashSpy = vi.spyOn(bcrypt, "hash");
    const r = await withoutTable("LoginThrottle", () => reset(admin, target));
    expect(status(r)).toBe(503);
    expect(JSON.stringify(r)).not.toMatch(/LoginThrottle|relation|postgres|SELECT|INSERT/i);
    expect(hashSpy).not.toHaveBeenCalled();
    expect(await hashOf(target)).toBe(before);
    expect(await resetAudit(target)).toHaveLength(0);
    // and it works again once the table is back
    expect(status(await reset(admin, target))).toBe(200);
  });

  it("refusals are monitored without flooding the audit table: at most the rate-limit budget of rows per administrator", async () => {
    const admin = await user("ADMIN");
    const boss = await user("BOSS");
    const results = await Promise.all(Array.from({ length: 30 }, () => reset(admin, boss, { ip: ip() })));
    const rows = await refusals(admin);
    expect(rows.length).toBeLessThanOrEqual(LIMITS.credentialResetAdmin);
    expect(results.filter((r) => status(r) === 403)).toHaveLength(rows.length);
    for (const row of rows) expect(JSON.parse(row.afterJson!)).toMatchObject({ kind: "PASSWORD_RESET_REFUSED", code: "APPROVAL_CAPABLE_TARGET" });
    expect(rows.every((r) => !/password|hash|\$2/i.test(r.afterJson!.replace(/PASSWORD_RESET_REFUSED/, "")))).toBe(true);
  });
});

describe("a successful reset", () => {
  it("returns a working temporary password, records who/whom/why/when without any secret, and tells the employee", async () => {
    const admin = await user("ADMIN");
    const target = await user();
    const result = await reset(admin, target);
    expect(result.ok).toBe(true);
    const temp = result.ok ? result.tempPassword : "";
    expect(temp.length).toBeGreaterThanOrEqual(12);
    const stored = await hashOf(target);
    expect(await bcrypt.compare(temp, stored)).toBe(true);
    expect(await bcrypt.compare(EMP_PASSWORD, stored)).toBe(false); // the old password is gone

    const [audit] = await resetAudit(target);
    expect(audit).toMatchObject({ actorId: admin, entityType: "User", action: "RESET_CREDENTIALS" });
    expect(audit.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(JSON.parse(audit.afterJson!)).toEqual({ kind: "PASSWORD_RESET", reason: REASON, identityVerified: true, targetUserId: target });
    for (const secret of [temp, stored, ADMIN_PASSWORD, EMP_PASSWORD, "$2b$", "$2a$"]) expect(JSON.stringify(audit), secret).not.toContain(secret);

    const [note] = await notes(target);
    expect(note).toMatchObject({ type: "GENERIC", title: "Таны нууц үг сэргээгдлээ", isRead: false });
    expect(note.body).toContain("Админ");
    expect(note.body).toMatch(/\d{4}/); // when it happened
    expect(note.body).toContain("хүсээгүй бол");
    for (const secret of [temp, stored, ADMIN_PASSWORD]) expect(note.body).not.toContain(secret);
  });

  it("route: 200 with the temporary password and no-store, and the audit/notification exist", async () => {
    const admin = await user("ADMIN");
    const target = await user();
    session.current = { user: { id: admin, role: "ADMIN" } };
    const res = await RESET_ROUTE(
      new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": ip() }, body: JSON.stringify({ reason: REASON, identityVerified: true, adminPassword: ADMIN_PASSWORD }) }),
      { params: Promise.resolve({ id: target }) } as never
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["tempPassword"]);
    expect(await bcrypt.compare(body.tempPassword, await hashOf(target))).toBe(true);
    expect(await notes(target)).toHaveLength(1);
  });

  it("a notification that cannot be written rolls the whole reset back: password unchanged, no audit, no temporary password", async () => {
    const admin = await user("ADMIN");
    const target = await user();
    const before = await hashOf(target);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await withConstraint("Notification", "tmp_no_reset_notice", `"title" <> 'Таны нууц үг сэргээгдлээ'`, () => reset(admin, target));
    expect(status(r)).toBe(500);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/tempPassword|Notification|constraint|\$2/i);
    expect(await hashOf(target)).toBe(before);
    expect((await resetAudit(target)).filter((a) => (JSON.parse(a.afterJson!) as { kind: string }).kind === "PASSWORD_RESET")).toHaveLength(0);
    expect(await notes(target)).toHaveLength(0);
  });

  it("an audit entry that cannot be written rolls the reset back too, and sends no notification", async () => {
    const admin = await user("ADMIN");
    const target = await user();
    const before = await hashOf(target);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await withConstraint("AuditLog", "tmp_no_reset_audit", `"afterJson" IS NULL OR "afterJson" NOT LIKE '%"kind":"PASSWORD_RESET",%'`, () => reset(admin, target));
    expect(status(r)).toBe(500);
    expect(await hashOf(target)).toBe(before);
    expect(await notes(target)).toHaveLength(0);
  });
});

describe("user creation", () => {
  it("creates a user for an active ADMIN with their own password; the audit entry holds no secret", async () => {
    const admin = await user("ADMIN");
    // a privileged role is a grant (Stage 1.5): without the reason and confirmation the service refuses and creates nothing
    const refused = await create(admin, {}, { role: "DIRECTOR", title: "Захирал" });
    expect(status(refused)).toBe(400);
    const result = await create(admin, { grant: { reason: "Шинэ захирал томилогдсон", confirmed: true } }, { role: "DIRECTOR", title: "Захирал" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await prisma.user.findUniqueOrThrow({ where: { id: result.id } });
    expect(row).toMatchObject({ role: "DIRECTOR", title: "Захирал", isActive: true });
    expect(await bcrypt.compare(result.tempPassword, row.passwordHash)).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: result.id, action: "CREATE_USER" } });
    expect(audit.actorId).toBe(admin);
    expect(JSON.parse(audit.afterJson!)).toEqual({ kind: "USER_CREATE", role: "DIRECTOR", departmentId: null, roleCarriesAuthority: true });
    for (const secret of [result.tempPassword, row.passwordHash, ADMIN_PASSWORD]) expect(JSON.stringify(audit), secret).not.toContain(secret);
    const plain = await create(admin, {}, { role: "EMPLOYEE" });
    if (plain.ok) {
      const a2 = await prisma.auditLog.findFirstOrThrow({ where: { entityId: plain.id, action: "CREATE_USER" } });
      expect(JSON.parse(a2.afterJson!).roleCarriesAuthority).toBe(false);
    }
  });

  it("refuses non-ADMIN, inactive ADMIN, a missing or wrong password, and a duplicate e-mail; nothing is created", async () => {
    const admin = await user("ADMIN");
    const before = await prisma.user.count({ where: { email: { startsWith: `${P}new-${TAG}` } } });
    expect(status(await create(await user("DIRECTOR")))).toBe(403);
    expect(status(await create(await user("ADMIN", { active: false })))).toBe(403);
    expect(status(await create(admin, { adminPassword: "" }))).toBe(400);
    expect(status(await create(admin, { adminPassword: "wrong" }))).toBe(401);
    expect(status(await create(admin, { adminPassword: EMP_PASSWORD }))).toBe(401);
    expect(await prisma.user.count({ where: { email: { startsWith: `${P}new-${TAG}` } } })).toBe(before);
    const first = await create(admin);
    expect(first.ok).toBe(true);
    if (first.ok) expect(status(await create(admin, {}, { email: first.email }))).toBe(409);
  });

  it("20 creations per administrator per window; 30 simultaneous attempts evaluate at most 20", async () => {
    const admin = await user("ADMIN");
    const results = await Promise.all(Array.from({ length: 30 }, () => create(admin, { ip: ip() })));
    expect(results.filter((r) => status(r) !== 429).length).toBeLessThanOrEqual(LIMITS.userCreateAdmin);
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(LIMITS.userCreateAdmin);
    expect(results.some((r) => status(r) === 429)).toBe(true);
  });

  it("limiter unavailable: refused with a generic 503 and no user is created", async () => {
    const admin = await user("ADMIN");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const email = `${P}new-${TAG}-limiter@test.local`;
    const r = await withoutTable("LoginThrottle", () => create(admin, {}, { email }));
    expect(status(r)).toBe(503);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("routes: POST needs the admin password (400 without), is ADMIN-only, and GET is unchanged", async () => {
    const admin = await user("ADMIN");
    const email = `${P}new-${TAG}-route@test.local`;
    const post = (b: unknown) => USERS_POST(new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": ip() }, body: JSON.stringify(b) }));
    session.current = { user: { id: await user("MANAGER"), role: "MANAGER" } };
    expect((await post({ email, name: "N", role: "EMPLOYEE", adminPassword: ADMIN_PASSWORD })).status).toBe(403);
    expect((await USERS_GET()).status).toBe(403);
    session.current = { user: { id: admin, role: "ADMIN" } };
    expect((await post({ email, name: "N", role: "EMPLOYEE" })).status).toBe(400);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    const ok = await post({ email, name: "N", role: "EMPLOYEE", adminPassword: ADMIN_PASSWORD });
    expect(ok.status).toBe(201);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(Object.keys(await ok.json()).sort()).toEqual(["email", "id", "tempPassword"]);
    expect((await USERS_GET()).status).toBe(200);
  });
});
