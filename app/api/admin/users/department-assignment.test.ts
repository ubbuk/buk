import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ADMIN_TEST_HASH } from "@/app/api/procurement/step-up-support";

// The administrator's user screen end to end at the API level, on the isolated test database: a department that is
// created or chosen must end up in User.departmentId, show in the list, and a delete is covered separately.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as USERS_GET, POST as USERS_POST } from "./route";
import { PATCH as USER_PATCH } from "./[id]/route";
import { POST as DEPT_POST } from "../departments/route";

const P = "adm-dept-";
const TAG = Date.now().toString(36);
const admin = `${P}${TAG}-admin`;
let ipN = 0;
const ip = () => `10.77.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/x", { method, headers: { "Content-Type": "application/json", "x-forwarded-for": ip() }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const createDept = async (name: string, type: "OFFICE" | "FACTORY" = "FACTORY") => {
  const r = await DEPT_POST(req("POST", { name, type }));
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; name: string; type: string };
};
const createUser = async (n: string, departmentId?: string | null) => {
  const r = await USERS_POST(req("POST", { email: `${P}${TAG}-${n}@test.local`, name: `${P}${n}`, role: "EMPLOYEE", ...(departmentId === undefined ? {} : { departmentId }) }));
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string };
};
const stored = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).departmentId;
const listed = async (id: string) => ((await (await USERS_GET()).json()) as { id: string; departmentId: string | null; departmentName: string | null }[]).find((u) => u.id === id);

beforeAll(async () => {
  await prisma.user.create({ data: { id: admin, email: `${admin}@test.local`, name: admin, role: "ADMIN", passwordHash: ADMIN_TEST_HASH } });
  session.current = { user: { id: admin, role: "ADMIN", name: "a", email: `${admin}@test.local`, departmentId: null } };
});
afterAll(async () => {
  const users = (await prisma.user.findMany({ where: { name: { startsWith: P } }, select: { id: true } })).map((u) => u.id);
  const ids = [...users, admin];
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.department.updateMany({ where: { headId: { in: ids } }, data: { headId: null } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.department.deleteMany({ where: { name: { startsWith: P } } });
});

describe("a department given to a user is saved", () => {
  it("creating a user with a freshly created department stores that department's id and the list shows its name", async () => {
    const dept = await createDept(`${P}${TAG}-new`);
    const { id } = await createUser("new", dept.id);
    expect(await stored(id)).toBe(dept.id);
    expect(await listed(id)).toMatchObject({ departmentId: dept.id, departmentName: dept.name });
  });

  it("creating a user with an existing department stores it; with none stores null", async () => {
    const dept = await createDept(`${P}${TAG}-existing`, "OFFICE");
    expect(await stored((await createUser("existing", dept.id)).id)).toBe(dept.id);
    expect(await stored((await createUser("none")).id)).toBeNull();
    expect(await stored((await createUser("null", null)).id)).toBeNull();
  });

  it("editing changes the department, moves it to another and clears it again", async () => {
    const a = await createDept(`${P}${TAG}-a`);
    const b = await createDept(`${P}${TAG}-b`, "OFFICE");
    const { id } = await createUser("edit");
    const patch = (departmentId: string | null) => USER_PATCH(req("PATCH", { role: "EMPLOYEE", title: null, departmentId, isActive: true }), ctx(id));

    expect((await patch(a.id)).status).toBe(200);
    expect(await stored(id)).toBe(a.id);
    expect(await listed(id)).toMatchObject({ departmentName: a.name });

    expect((await patch(b.id)).status).toBe(200);
    expect(await stored(id)).toBe(b.id);
    expect(await listed(id)).toMatchObject({ departmentName: b.name });

    expect((await patch(null)).status).toBe(200);
    expect(await stored(id)).toBeNull();
    expect((await listed(id))?.departmentName).toBeNull();
  });

  it("a department id that does not exist is refused, not stored", async () => {
    const { id } = await createUser("ghost");
    const r = await USER_PATCH(req("PATCH", { departmentId: "no-such-department" }), ctx(id));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("DEPARTMENT_NOT_FOUND");
    expect(await stored(id)).toBeNull();
  });
});

// Deleting a user (responsibilities handed over, password, hard / soft delete) is covered in user-delete.test.ts.
