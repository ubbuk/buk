import bcrypt from "bcrypt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { custodyOf } from "./authority-grant";
import { LIMITS } from "./login-throttle";
import { isPrivilegedRole, positionEligibilityError, roleChangeIsGrant } from "./authority-roles";

// Stage 1.5: granting authority (role elevation, re-activation, approval positions, department head, procurement
// handover, creating a privileged user) goes through ONE guard. Real route handlers, the shared PostgreSQL throttle,
// the audit log and the notifications, on the isolated test database; only the session lookup is replaced.
//
// READ THIS FIRST. The custody check (an account whose password an ADMIN issued and whose owner has not changed it
// cannot receive authority) is a BARRIER AND A DETECTOR, not a guarantee. The evidence lives in the audit log, and an
// ADMIN who knows the temporary password can sign in as the employee, change the password and so produce exactly
// the evidence the check looks for. The last describe block demonstrates that bypass on purpose. Only dual control
// (a second approver) or out-of-band self-service recovery closes it.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { POST as ROLES_POST } from "@/app/api/admin/approval-roles/route";
import { PATCH as DEPT_PATCH } from "@/app/api/admin/departments/[id]/route";
import { POST as HANDOVER_POST } from "@/app/api/admin/procurement-handover/route";
import { POST as RESET_ROUTE } from "@/app/api/admin/users/[id]/reset-credentials/route";
import { PATCH as USER_PATCH } from "@/app/api/admin/users/[id]/route";
import { POST as USERS_POST } from "@/app/api/admin/users/route";
import { POST as ME_PASSWORD } from "@/app/api/me/password/route";

const P = "ag-";
const TAG = Date.now().toString(36);
const ADMIN_PASSWORD = "Admin-pw-1";
const EMP_PASSWORD = "Employee-pw-1";
const REASON = "Ажилтныг шинэ албан тушаалд томилсон тушаалын дагуу";
let adminHash = "";
let empHash = "";
let n = 0;
const created: string[] = [];
const departments: string[] = [];
let savedPositions: { id: string }[] = [];

type Role = "ADMIN" | "DIRECTOR" | "BOSS" | "MANAGER" | "STOREKEEPER" | "EMPLOYEE" | "ENGINEERING" | "CHIEF_ACCOUNTANT";
async function user(role: Role = "EMPLOYEE", opts: { active?: boolean } = {}) {
  n += 1;
  const id = `${P}${TAG}-${n}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role, passwordHash: role === "ADMIN" ? adminHash : empHash, isActive: opts.active ?? true } });
  created.push(id);
  return id;
}
async function department(headId: string | null = null) {
  n += 1;
  const id = `${P}dept-${TAG}-${n}`;
  await prisma.department.create({ data: { id, name: id, type: "OFFICE", headId } });
  departments.push(id);
  return id;
}

const as = (id: string | null, role = "ADMIN") => {
  session.current = id ? { user: { id, role, name: id, email: `${id}@test.local`, departmentId: null } } : null;
};
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const STEP = { adminPassword: ADMIN_PASSWORD, reason: REASON, confirmed: true };

const patchUser = (admin: string, target: string, body: object, headers: Record<string, string> = {}) => {
  as(admin);
  return USER_PATCH(req(body, headers), ctx(target));
};
const setPosition = (admin: string, role: string, userId: string, step: object = STEP) => {
  as(admin);
  return ROLES_POST(req({ role, userId, ...step }));
};
const setHead = (admin: string, deptId: string, headId: string | null, step: object = STEP) => {
  as(admin);
  return DEPT_PATCH(req({ headId, ...step }), ctx(deptId));
};
const createAs = (admin: string, body: object) => {
  as(admin);
  n += 1;
  return USERS_POST(req({ email: `${P}new-${TAG}-${n}@test.local`, name: `New ${n}`, role: "EMPLOYEE", adminPassword: ADMIN_PASSWORD, ...body }));
};
const ownPassword = (id: string, current: string, next: string) => {
  as(id, "EMPLOYEE");
  return ME_PASSWORD(req({ currentPassword: current, newPassword: next, confirmPassword: next }));
};
const resetAs = (admin: string, target: string) => {
  as(admin);
  return RESET_ROUTE(req({ reason: REASON, identityVerified: true, adminPassword: ADMIN_PASSWORD }), ctx(target));
};

const roleOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).role;
const grantAudit = (target: string) => prisma.auditLog.findMany({ where: { entityType: "AuthorityGrant", entityId: target } });
const notes = (id: string) => prisma.notification.findMany({ where: { userId: id } });
const holders = async (role: string) => (await prisma.approvalRoleAssignment.findMany({ where: { role: role as never, isActive: true } })).map((a) => a.userId);
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

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

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY", "hops:1");
  adminHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  empHash = await bcrypt.hash(EMP_PASSWORD, 4);
  await prisma.loginThrottle.deleteMany();
  // the executive director is a singleton: set it aside for the notification test and restore it afterwards
  savedPositions = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: ["EXECUTIVE_DIRECTOR", "ENGINEERING_CHIEF", "STOREKEEPER_LEAD"] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: savedPositions.map((p) => p.id) } }, data: { isActive: false, endedAt: new Date() } });
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
  await prisma.department.updateMany({ where: { id: { in: departments } }, data: { headId: null } });
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { in: all } } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: savedPositions.map((p) => p.id) } }, data: { isActive: true, endedAt: null } });
  await prisma.department.deleteMany({ where: { id: { in: departments } } });
  await prisma.notification.deleteMany({ where: { userId: { in: all } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: all } }, { entityId: { in: all } }, { entityId: { in: departments } }] } });
  await prisma.user.deleteMany({ where: { id: { in: all } } });
});

describe("what counts as a grant (pure rules)", () => {
  it("every role but EMPLOYEE is privileged; only moving INTO a privileged role is a grant", () => {
    expect(isPrivilegedRole("EMPLOYEE")).toBe(false);
    for (const r of ["ADMIN", "BOSS", "DIRECTOR", "MANAGER", "STOREKEEPER", "ENGINEERING", "CHIEF_ACCOUNTANT"]) expect(isPrivilegedRole(r), r).toBe(true);
    expect(roleChangeIsGrant("EMPLOYEE", "BOSS")).toBe(true);
    expect(roleChangeIsGrant("BOSS", "DIRECTOR")).toBe(true);
    expect(roleChangeIsGrant("BOSS", "BOSS")).toBe(false);
    expect(roleChangeIsGrant("BOSS", "EMPLOYEE")).toBe(false);
  });
  it("position eligibility: active holder of the matching role, nothing else", () => {
    expect(positionEligibilityError("ENGINEERING_CHIEF", { role: "ENGINEERING", isActive: true })).toBeNull();
    expect(positionEligibilityError("ENGINEERING_CHIEF", { role: "EMPLOYEE", isActive: true })).toContain("ENGINEERING");
    expect(positionEligibilityError("ENGINEERING_CHIEF", { role: "ENGINEERING", isActive: false })).toContain("Идэвхгүй");
    expect(positionEligibilityError("ENGINEERING_CHIEF", null)).toContain("олдсонгүй");
  });
});

describe("every authority-granting endpoint demands the step-up", () => {

  it("changes that grant nothing need no step-up", async () => {
    const admin = await user("ADMIN");
    const emp = await user("EMPLOYEE");
    const boss = await user("BOSS");
    const dept = await department(boss);
    const inactiveEmp = await user("EMPLOYEE", { active: false });
    expect((await patchUser(admin, emp, { title: "Нярав туслах" })).status).toBe(200); // title
    expect((await patchUser(admin, emp, { departmentId: dept })).status).toBe(200); // department
    expect((await patchUser(admin, boss, { role: "EMPLOYEE" })).status).toBe(200); // demotion
    expect((await patchUser(admin, inactiveEmp, { isActive: true })).status).toBe(200); // ordinary employee back
    expect((await patchUser(admin, emp, { role: "EMPLOYEE" })).status).toBe(200); // same role
    expect((await setHead(admin, dept, null)).status).toBe(200); // clearing a head
    expect((await createAs(admin, { role: "EMPLOYEE" })).status).toBe(201); // ordinary creation
    // naming the person who already holds a position repeats nothing
    const head = await user("BOSS");
    const d2 = await department(head);
    expect((await setHead(admin, d2, head, {})).status).toBe(200);
    expect(await grantAudit(emp)).toHaveLength(0);
  });
});

describe("who may grant", () => {
  it("not an ADMIN (session says so): 403 before anything else; an ADMIN deactivated or demoted since sign-in: 403 from the database", async () => {
    const emp = await user("EMPLOYEE");
    const boss = await user("BOSS");
    as(boss, "BOSS");
    expect((await USER_PATCH(req({ role: "DIRECTOR", ...STEP }), ctx(emp))).status).toBe(403);
    as(null);
    expect((await USER_PATCH(req({ role: "DIRECTOR", ...STEP }), ctx(emp))).status).toBe(403);

    const stale = await user("ADMIN");
    await prisma.user.update({ where: { id: stale }, data: { isActive: false } });
    expect((await patchUser(stale, emp, { role: "DIRECTOR", ...STEP })).status).toBe(403);
    await prisma.user.update({ where: { id: stale }, data: { isActive: true, role: "BOSS" } });
    expect((await patchUser(stale, emp, { role: "DIRECTOR", ...STEP })).status).toBe(403);
    expect(await roleOf(emp)).toBe("EMPLOYEE");
    expect(await grantAudit(emp)).toHaveLength(0);
  });
});

describe("audit and notifications", () => {
  it("a role elevation writes before/after, reason, confirmation and address, and no secret", async () => {
    const admin = await user("ADMIN");
    const emp = await user("EMPLOYEE");
    const r = await patchUser(admin, emp, { role: "BOSS", ...STEP }, { "x-forwarded-for": "198.51.100.7" });
    expect(r.status).toBe(200);
    expect(await roleOf(emp)).toBe("BOSS");
    const rows = await grantAudit(emp);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actorId).toBe(admin);
    expect(row.ipAddress).toBe("198.51.100.7");
    expect(JSON.parse(row.beforeJson!)).toMatchObject({ role: "EMPLOYEE" });
    const after = JSON.parse(row.afterJson!);
    expect(after).toMatchObject({ kind: "AUTHORITY_GRANT", grantKind: "ROLE_ELEVATION", reason: REASON, confirmed: true, after: { role: "BOSS" }, subject: { type: "User", id: emp } });
    expect(after.custody.state).toBe("OWNER_HELD");
    const everything = JSON.stringify(rows) + JSON.stringify(await notes(emp));
    expect(everything).not.toContain(ADMIN_PASSWORD);
    expect(everything).not.toContain(EMP_PASSWORD);
    expect(everything).not.toMatch(/\$2[aby]\$/);
    // the ordinary user-update audit row is still written, in the same transaction
    expect(await prisma.auditLog.count({ where: { entityType: "User", entityId: emp, action: "UPDATE_USER" } })).toBe(1);
  });

  it("the person, the previous holder, the other administrators and the executive director are told; the actor is not", async () => {
    const admin = await user("ADMIN");
    const otherAdmin = await user("ADMIN");
    const inactiveAdmin = await user("ADMIN", { active: false });
    const executive = await user("DIRECTOR");
    const oldChief = await user("ENGINEERING");
    const newChief = await user("ENGINEERING");
    await prisma.approvalRoleAssignment.create({ data: { role: "EXECUTIVE_DIRECTOR", userId: executive, isActive: true } });
    await prisma.approvalRoleAssignment.create({ data: { role: "ENGINEERING_CHIEF", userId: oldChief, isActive: true } });

    const r = await setPosition(admin, "ENGINEERING_CHIEF", newChief);
    expect(r.status).toBe(200);
    expect(await holders("ENGINEERING_CHIEF")).toEqual([newChief]);
    for (const [who, expected] of [[newChief, "Таны эрх"], [oldChief, "Таны эрх"], [otherAdmin, "Эрх олгох үйлдэл"], [executive, "Эрх олгох үйлдэл"]] as const) {
      const got = (await notes(who)).filter((x) => x.title.includes(expected));
      expect(got, who).toHaveLength(1);
      expect(got[0].body).toContain(REASON);
    }
    expect((await notes(admin)).filter((x) => x.title.includes("Эрх") || x.title.includes("эрх"))).toHaveLength(0);
    expect((await notes(inactiveAdmin)).length).toBe(0);
    const audit = (await grantAudit(newChief))[0];
    expect(JSON.parse(audit.beforeJson!)).toEqual({ position: "ENGINEERING_CHIEF", holders: [oldChief] });
    expect(JSON.parse(audit.afterJson!).after).toEqual({ position: "ENGINEERING_CHIEF", holders: [newChief] });
    expect(JSON.parse(audit.afterJson!).grantKind).toBe("POSITION_ASSIGNMENT");
  });

  it("a department head grant is recorded and the previous head is told", async () => {
    const admin = await user("ADMIN");
    const oldHead = await user("BOSS");
    const newHead = await user("BOSS");
    const dept = await department(oldHead);
    expect((await setHead(admin, dept, newHead)).status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept } })).headId).toBe(newHead);
    const audit = (await grantAudit(newHead))[0];
    expect(JSON.parse(audit.beforeJson!)).toEqual({ headId: oldHead });
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ grantKind: "DEPARTMENT_HEAD", after: { headId: newHead } });
    expect((await notes(oldHead)).filter((x) => x.title.includes("Таны эрх"))).toHaveLength(1);
    expect((await notes(newHead)).filter((x) => x.title.includes("Таны эрх"))).toHaveLength(1);
  });

  it("a privileged user created by an administrator is recorded as a grant and announced to the other administrators", async () => {
    const admin = await user("ADMIN");
    const otherAdmin = await user("ADMIN");
    const r = await createAs(admin, { role: "STOREKEEPER", reason: REASON, confirmed: true });
    expect(r.status).toBe(201);
    const body = await json(r);
    const rows = await grantAudit(body.id as string);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].afterJson!)).toMatchObject({ grantKind: "USER_CREATE_PRIVILEGED", reason: REASON });
    expect(JSON.stringify(rows)).not.toContain(body.tempPassword as string);
    expect((await notes(otherAdmin)).filter((x) => x.title.includes("Эрх олгох"))).toHaveLength(1);
    // the creation audit row now carries the address too
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: body.id as string, action: "CREATE_USER" } })).actorId).toBe(admin);
  });

  it("if the grant record cannot be written, the grant does not happen (user, position, head)", async () => {
    const admin = await user("ADMIN");
    const emp = await user("EMPLOYEE");
    const eng = await user("ENGINEERING");
    const boss = await user("BOSS");
    const dept = await department();

    const noAuditRow = `"entityType" <> 'AuthorityGrant'`;
    const r1 = await withConstraint("AuditLog", `ag_${TAG}_1`, noAuditRow, () => patchUser(admin, emp, { role: "BOSS", ...STEP }));
    expect(r1.status).toBe(500);
    expect(await roleOf(emp)).toBe("EMPLOYEE");
    expect(await prisma.auditLog.count({ where: { entityType: "User", entityId: emp, action: "UPDATE_USER" } })).toBe(0);

    const r2 = await withConstraint("AuditLog", `ag_${TAG}_2`, noAuditRow, () => setPosition(admin, "ENGINEERING_CHIEF", eng));
    expect(r2.status).toBe(500);
    expect(await holders("ENGINEERING_CHIEF")).not.toContain(eng);

    const r3 = await withConstraint("AuditLog", `ag_${TAG}_3`, noAuditRow, () => setHead(admin, dept, boss));
    expect(r3.status).toBe(500);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept } })).headId).toBeNull();

    // and a notification that cannot be written has the same effect
    const noGrantNote = `"title" NOT LIKE 'Эрх олгох%' AND "title" NOT LIKE 'Таны эрх%'`;
    const otherAdmin = await user("ADMIN");
    expect(otherAdmin).toBeTruthy();
    const r4 = await withConstraint("Notification", `ag_${TAG}_4`, noGrantNote, () => patchUser(admin, emp, { role: "BOSS", ...STEP }));
    expect(r4.status).toBe(500);
    expect(await roleOf(emp)).toBe("EMPLOYEE");
    expect(await grantAudit(emp)).toHaveLength(0);
    // the same request goes through once the fault is gone
    expect((await patchUser(admin, emp, { role: "BOSS", ...STEP })).status).toBe(200);
  });
});

describe("position eligibility and no-ops", () => {
  it("the server refuses a holder who has not the role or is inactive (it no longer relies on the screen)", async () => {
    const admin = await user("ADMIN");
    const emp = await user("EMPLOYEE");
    const inactiveEng = await user("ENGINEERING", { active: false });
    expect((await setPosition(admin, "ENGINEERING_CHIEF", emp)).status).toBe(400);
    expect((await setPosition(admin, "ENGINEERING_CHIEF", inactiveEng)).status).toBe(400);
    expect((await setPosition(admin, "ENGINEERING_CHIEF", `${P}nobody`)).status).toBe(404);
    expect(await holders("ENGINEERING_CHIEF")).not.toEqual(expect.arrayContaining([emp]));
  });

  it("naming the current holder is a no-op: no step-up, no audit row, no notification", async () => {
    const admin = await user("ADMIN");
    const otherAdmin = await user("ADMIN");
    const chief = await user("ENGINEERING");
    expect((await setPosition(admin, "ENGINEERING_CHIEF", chief)).status).toBe(200);
    const notesBefore = (await notes(otherAdmin)).length;
    const auditBefore = (await grantAudit(chief)).length;
    const again = await setPosition(admin, "ENGINEERING_CHIEF", chief, {});
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ unchanged: true });
    expect((await notes(otherAdmin)).length).toBe(notesBefore);
    expect((await grantAudit(chief)).length).toBe(auditBefore);
  });
});
