import bcrypt from "bcrypt";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";

// POLICY: the administrator grants authority DIRECTLY. The Stage 1.5 guard (own password, reason, confirmation, rate limit,
// before/after audit, notifications, one transaction, custody) is the whole protection of a grant; there is NO executive-director
// approval step, queue, page or table. Two Stage 3 rules stay: the ADMIN role is never granted through the application (one
// administrator), and nobody grants authority to themselves; the last administrator cannot be demoted or deactivated.
// Real handlers, throttle, audit and notifications on the isolated test database; only the session lookup is replaced.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { POST as ROLES_POST } from "@/app/api/admin/approval-roles/route";
import { PATCH as DEPT_PATCH } from "@/app/api/admin/departments/[id]/route";
import { PATCH as USER_PATCH } from "@/app/api/admin/users/[id]/route";
import { POST as USERS_POST } from "@/app/api/admin/users/route";

const P = "gp-";
const TAG = Date.now().toString(36);
const ADMIN_PASSWORD = "Admin-pw-1";
const EMP_PASSWORD = "Employee-pw-1";
const REASON = "Тушаал №12-ын дагуу шинэ албан тушаалд томилсон";
const STEP = { adminPassword: ADMIN_PASSWORD, reason: REASON, confirmed: true };
let adminHash = "";
let empHash = "";
let n = 0;
const created: string[] = [];
const departments: string[] = [];
let savedPositions: { id: string }[] = [];

type Role = "ADMIN" | "DIRECTOR" | "BOSS" | "EMPLOYEE" | "STOREKEEPER" | "ENGINEERING" | "MANAGER";
async function user(role: Role = "EMPLOYEE") {
  n += 1;
  const id = `${P}${TAG}-${n}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role, passwordHash: role === "ADMIN" ? adminHash : empHash } });
  created.push(id);
  return id;
}
async function department() {
  n += 1;
  const id = `${P}dept-${TAG}-${n}`;
  await prisma.department.create({ data: { id, name: id, type: "OFFICE" } });
  departments.push(id);
  return id;
}
const as = (id: string) => {
  session.current = { user: { id, role: "ADMIN", name: id, email: `${id}@test.local`, departmentId: null } };
};
const req = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const json = async (r: Response) => (await r.clone().json()) as Record<string, unknown>;

const patchUser = (admin: string, target: string, body: object) => (as(admin), USER_PATCH(req({ ...STEP, ...body }), ctx(target)));
const setPosition = (admin: string, role: string, userId: string, step: object = STEP) => (as(admin), ROLES_POST(req({ role, userId, ...step })));
const setHead = (admin: string, dept: string, headId: string) => (as(admin), DEPT_PATCH(req({ headId, ...STEP }), ctx(dept)));
const createAs = (admin: string, body: object) => {
  n += 1;
  as(admin);
  return USERS_POST(req({ email: `${P}new-${TAG}-${n}@test.local`, name: `New ${n}`, role: "EMPLOYEE", adminPassword: ADMIN_PASSWORD, ...body }));
};
const roleOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).role;
const grantAudit = (target: string) => prisma.auditLog.findMany({ where: { entityType: "AuthorityGrant", entityId: target } });

async function withConstraint<T>(table: string, name: string, check: string, fn: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${check}) NOT VALID`);
  try {
    return await fn();
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
  }
}

beforeAll(async () => {
  adminHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  empHash = await bcrypt.hash(EMP_PASSWORD, 4);
  await prisma.loginThrottle.deleteMany();
  // grants must not depend on any executive director: set the real ones (and the two positions used here) aside
  savedPositions = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: ["EXECUTIVE_DIRECTOR", "ENGINEERING_CHIEF"] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: savedPositions.map((p) => p.id) } }, data: { isActive: false, endedAt: new Date() } });
});
afterEach(async () => {
  await prisma.loginThrottle.deleteMany();
});
afterAll(async () => {
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

describe("the administrator grants directly, with no executive director in office", () => {
  it("ADMIN -> BOSS, DIRECTOR, MANAGER, STOREKEEPER: each takes effect at once and is audited", async () => {
    const admin = await user("ADMIN");
    expect(await prisma.approvalRoleAssignment.count({ where: { role: "EXECUTIVE_DIRECTOR", isActive: true } })).toBe(0);
    for (const role of ["BOSS", "DIRECTOR", "MANAGER", "STOREKEEPER"] as const) {
      const emp = await user();
      const res = await patchUser(admin, emp, { role });
      expect(res.status, role).toBe(200);
      expect(await roleOf(emp), role).toBe(role);
      const rows = await grantAudit(emp);
      expect(rows, role).toHaveLength(1);
      expect(JSON.parse(rows[0].beforeJson!)).toMatchObject({ role: "EMPLOYEE" });
      expect(JSON.parse(rows[0].afterJson!)).toMatchObject({ grantKind: "ROLE_ELEVATION", reason: REASON, confirmed: true, after: { role } });
    }
  });

  it("position, department head and a privileged new user are also direct", async () => {
    const admin = await user("ADMIN");
    const eng = await user("ENGINEERING");
    const boss = await user("BOSS");
    const dept = await department();
    expect((await setPosition(admin, "ENGINEERING_CHIEF", eng)).status).toBe(200);
    expect((await prisma.approvalRoleAssignment.findMany({ where: { role: "ENGINEERING_CHIEF", isActive: true } })).map((a) => a.userId)).toEqual([eng]);
    expect((await setHead(admin, dept, boss)).status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept } })).headId).toBe(boss);
    const make = await createAs(admin, { role: "STOREKEEPER", reason: REASON, confirmed: true });
    expect(make.status).toBe(201);
    const id = (await json(make)).id as string;
    expect(await roleOf(id)).toBe("STOREKEEPER");
    expect(await grantAudit(id)).toHaveLength(1);
  });

  it("the Stage 1.5 notifications still go out: the person, the other administrators and the executive director (who only hears of it)", async () => {
    const admin = await user("ADMIN");
    const otherAdmin = await user("ADMIN");
    const exec = await user("DIRECTOR");
    await prisma.approvalRoleAssignment.create({ data: { role: "EXECUTIVE_DIRECTOR", userId: exec, isActive: true } });
    const emp = await user();
    expect((await patchUser(admin, emp, { role: "BOSS" })).status).toBe(200); // not held up by the executive
    for (const who of [emp, otherAdmin, exec]) expect((await prisma.notification.findMany({ where: { userId: who } })).length, who).toBeGreaterThan(0);
    await prisma.approvalRoleAssignment.updateMany({ where: { userId: exec }, data: { isActive: false } });
  });
});

describe("the Stage 1.5 protection is still the whole gate", () => {
  it("a wrong or missing own password refuses the grant and changes nothing", async () => {
    const admin = await user("ADMIN");
    const emp = await user();
    const wrong = await patchUser(admin, emp, { role: "BOSS", adminPassword: "wrong-password" });
    expect(wrong.status).toBe(401);
    const none = await patchUser(admin, emp, { role: "BOSS", adminPassword: undefined });
    expect(none.status).toBe(400);
    expect((await json(none)).code).toBe("STEP_UP_REQUIRED");
    expect(await roleOf(emp)).toBe("EMPLOYEE");
    expect(await grantAudit(emp)).toHaveLength(0);
    expect((await patchUser(admin, emp, { role: "BOSS" })).status).toBe(200);
  });

  it("without a reason or the confirmation the grant is refused", async () => {
    const admin = await user("ADMIN");
    const emp = await user();
    for (const bad of [{ reason: "" }, { reason: "ab" }, { confirmed: false }, { confirmed: undefined }]) {
      expect((await patchUser(admin, emp, { role: "BOSS", ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await roleOf(emp)).toBe("EMPLOYEE");
  });

  it("if the grant record cannot be written, the grant rolls back (role, position, head)", async () => {
    const admin = await user("ADMIN");
    const emp = await user();
    const eng = await user("ENGINEERING");
    const boss = await user("BOSS");
    const dept = await department();
    const noGrantRow = `"entityType" <> 'AuthorityGrant'`;
    const r1 = await withConstraint("AuditLog", `gp_${TAG}_1`, noGrantRow, () => patchUser(admin, emp, { role: "BOSS" }));
    expect(r1.status).toBe(500);
    expect(await roleOf(emp)).toBe("EMPLOYEE");
    expect(await prisma.auditLog.count({ where: { entityType: "User", entityId: emp, action: "UPDATE_USER" } })).toBe(0);
    const r2 = await withConstraint("AuditLog", `gp_${TAG}_2`, noGrantRow, () => setPosition(admin, "ENGINEERING_CHIEF", eng));
    expect(r2.status).toBe(500);
    expect(await prisma.approvalRoleAssignment.count({ where: { role: "ENGINEERING_CHIEF", isActive: true, userId: eng } })).toBe(0);
    const r3 = await withConstraint("AuditLog", `gp_${TAG}_3`, noGrantRow, () => setHead(admin, dept, boss));
    expect(r3.status).toBe(500);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept } })).headId).toBeNull();
    expect((await patchUser(admin, emp, { role: "BOSS" })).status).toBe(200); // fine once the fault is gone
  });

  it("an account whose password an administrator issued and its owner has not changed still cannot receive authority (custody)", async () => {
    const admin = await user("ADMIN");
    const emp = await user();
    await prisma.auditLog.create({ data: { entityType: "User", entityId: emp, action: "RESET_CREDENTIALS", actorId: admin, afterJson: JSON.stringify({ kind: "PASSWORD_RESET", reason: "seed" }) } });
    const res = await patchUser(admin, emp, { role: "BOSS" });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe("CREDENTIAL_NOT_OWNER_HELD");
    expect(await roleOf(emp)).toBe("EMPLOYEE");
  });
});

describe("the rules that stay from Stage 3", () => {
  it("the ADMIN role can not be granted or created through the application", async () => {
    const admin = await user("ADMIN");
    const emp = await user();
    const promote = await patchUser(admin, emp, { role: "ADMIN" });
    expect(promote.status).toBe(403);
    expect((await json(promote)).code).toBe("ADMIN_ROLE_LOCKED");
    const make = await createAs(admin, { role: "ADMIN", reason: REASON, confirmed: true });
    expect(make.status).toBe(403);
    expect(await roleOf(emp)).toBe("EMPLOYEE");
  });

  it("nobody grants authority to themselves", async () => {
    const admin = await user("ADMIN");
    const res = await patchUser(admin, admin, { role: "DIRECTOR" });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("SELF_GRANT_FORBIDDEN");
    expect(await roleOf(admin)).toBe("ADMIN");
  });

  it("the last active administrator can be neither demoted nor deactivated", async () => {
    const others = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    const only = await user("ADMIN");
    await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
    try {
      for (const body of [{ role: "EMPLOYEE" }, { isActive: false }]) {
        const r = await patchUser(only, only, body);
        expect(r.status, JSON.stringify(body)).toBe(409);
        expect((await json(r)).code).toBe("LAST_ADMIN");
      }
      expect(await roleOf(only)).toBe("ADMIN");
    } finally {
      await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: true } });
    }
  });
});

describe("no executive approval mechanism is left", () => {
  it("there is no approval table, enum or route in the database or the source", async () => {
    const tables = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('public."PrivilegedActionRequest"')::text AS r`;
    expect(tables[0].r).toBeNull();
    const enums = await prisma.$queryRaw<{ n: string }[]>`SELECT typname AS n FROM pg_type WHERE typname = 'PrivilegedActionStatus'`;
    expect(enums).toHaveLength(0);

    const root = path.resolve(__dirname, "..");
    const forbidden = [["dual", "control"].join("-"), ["Privileged", "Action"].join(""), ["privileged", "approvals"].join("-"), ["privileged", "requests"].join("-"), ["DUAL", "CONTROL", "MODE"].join("_"), ["consume", "Approval"].join("")];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if ([".git", "node_modules", ".next", "results-security", "results-admin", "results-auth", "results-pin", "results-profile", "tsconfig.tsbuildinfo"].includes(name)) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|prisma|sql|md|example)$/.test(name) && full !== __filename) {
          const text = readFileSync(full, "utf8");
          for (const word of forbidden) if (text.includes(word)) hits.push(`${path.relative(root, full)}: ${word}`);
        }
      }
    };
    for (const dir of ["app", "components", "lib", "prisma", "e2e", "types"]) walk(path.join(root, dir));
    expect(hits).toEqual([]);
  });
});
