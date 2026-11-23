import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ADMIN_TEST_HASH, ADMIN_TEST_PASSWORD } from "@/app/api/procurement/step-up-support";
import { categoryNameWarning } from "@/lib/department-name";

// Admin -> departments: create, rename / change type, remove (move the members first; delete with no history, archive with history).
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as LIST } from "@/app/api/departments/route";
import { POST as CREATE } from "./route";
import { DELETE, GET as INSPECT, PATCH } from "./[id]/route";
import { PATCH as USER_PATCH } from "@/app/api/admin/users/[id]/route";

const P = "adept-";
const TAG = Date.now().toString(36);
const ADMIN = `${P}${TAG}-admin`;
let ipN = 0;
const ip = () => `10.99.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const req = (method: string, body?: unknown) => new Request("http://localhost/x", { method, headers: { "Content-Type": "application/json", "x-forwarded-for": ip() }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const name = (n: string) => `${P}${TAG}-${n}`;
const mkDept = (n: string, type: "OFFICE" | "FACTORY" = "FACTORY") => prisma.department.create({ data: { name: name(n), type } });
const mkUser = (n: string, departmentId: string | null, role: "EMPLOYEE" | "BOSS" = "EMPLOYEE") => prisma.user.create({ data: { id: name(n), email: `${name(n)}@test.local`, name: `${P}${n}`, role, passwordHash: "x", departmentId } });
const del = (id: string, body: Record<string, unknown> = {}) => DELETE(req("DELETE", { adminPassword: ADMIN_TEST_PASSWORD, ...body }), ctx(id));
let seq = 0;
const mkRequest = (departmentId: string, requestedById: string, status: "COMPLETED" | "PENDING_DEPARTMENT_APPROVAL") =>
  prisma.materialRequest.create({ data: { requestNumber: `ADEPT-${TAG}-${++seq}`, year: 2096, sequence: 800_000 + seq, departmentId, requestedById, status } });

beforeAll(async () => {
  await prisma.user.create({ data: { id: ADMIN, email: `${ADMIN}@test.local`, name: ADMIN, role: "ADMIN", passwordHash: ADMIN_TEST_HASH } });
  session.current = { user: { id: ADMIN, role: "ADMIN", name: "a", email: `${ADMIN}@test.local`, departmentId: null } };
});
afterAll(async () => {
  const users = (await prisma.user.findMany({ where: { OR: [{ id: { startsWith: P } }, { name: { startsWith: P } }] }, select: { id: true } })).map((u) => u.id);
  await prisma.materialRequest.deleteMany({ where: { requestNumber: { startsWith: `ADEPT-${TAG}` } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: users } }] } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.department.deleteMany({ where: { name: { startsWith: P } } });
});

describe("name warning", () => {
  it("a category word in the name warns; a normal name does not", () => {
    for (const n of ["Үйлдвэр", "үйлдвэр 2", "Бетон үйлдвэр", "Оффис", "Main office", "FACTORY"]) expect(categoryNameWarning(n), n).not.toBeNull();
    for (const n of ["Бетон цех", "Үйлдвэрлэлийн хэлтэс", "Нягтлан", ""]) expect(categoryNameWarning(n), n).toBeNull();
  });
});

describe("create / rename / type", () => {
  it("creates (audited), rejects a duplicate, renames and changes the type (audited)", async () => {
    const r = await CREATE(req("POST", { name: name("new"), type: "OFFICE" }));
    expect(r.status).toBe(201);
    const created = await r.json();
    expect((await CREATE(req("POST", { name: name("new"), type: "OFFICE" }))).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { entityType: "Department", entityId: created.id, action: "CREATE", actorId: ADMIN } })).toBe(1);

    const p = await PATCH(req("PATCH", { name: name("renamed"), type: "FACTORY" }), ctx(created.id));
    expect(p.status).toBe(200);
    expect(await prisma.department.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ name: name("renamed"), type: "FACTORY" });
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "Department", entityId: created.id, action: "UPDATE" } });
    expect(JSON.parse(audit!.beforeJson!)).toMatchObject({ name: name("new"), type: "OFFICE" });

    const other = await mkDept("other");
    expect((await PATCH(req("PATCH", { name: other.name }), ctx(created.id))).status).toBe(409); // name taken
    expect((await PATCH(req("PATCH", {}), ctx(created.id))).status).toBe(400);
  });
});

describe("remove", () => {
  it("needs the password; the members must be moved first (explicit answer)", async () => {
    const d = await mkDept("members");
    await mkUser("m1", d.id);
    expect((await DELETE(req("DELETE", { moveTo: null }), ctx(d.id))).status).toBe(400); // no password
    expect((await del(d.id, { adminPassword: "wrong", moveTo: null })).status).toBe(401);
    const noAnswer = await del(d.id);
    expect(noAnswer.status).toBe(400);
    expect((await noAnswer.json()).code).toBe("MOVE_REQUIRED");
    expect(await prisma.department.count({ where: { id: d.id } })).toBe(1);
    const info = await (await INSPECT(req("GET"), ctx(d.id))).json();
    expect(info).toMatchObject({ members: 1, requests: 0, hasHistory: false });
  });

  it("no history: the members move to the chosen department and the department is erased", async () => {
    const d = await mkDept("gone");
    const target = await mkDept("target");
    await mkUser("m2", d.id);
    const r = await del(d.id, { moveTo: target.id });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, mode: "DELETED", moved: 1 });
    expect(await prisma.department.count({ where: { id: d.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: name("m2") } })).departmentId).toBe(target.id);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "Department", entityId: d.id, actorId: ADMIN } });
    expect(JSON.parse(audit!.afterJson!)).toMatchObject({ kind: "DEPARTMENT_REMOVE", mode: "DELETED", movedMembers: 1, movedTo: target.id });
  });

  it("members can also go to «no department»", async () => {
    const d = await mkDept("nodept");
    await mkUser("m3", d.id);
    expect((await del(d.id, { moveTo: null })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: name("m3") } })).departmentId).toBeNull();
  });

  it("an archived or unknown target is refused and nothing changes", async () => {
    const d = await mkDept("badtarget");
    await mkUser("m4", d.id);
    const r = await del(d.id, { moveTo: "no-such" });
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("TARGET_INVALID");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: name("m4") } })).departmentId).toBe(d.id);
  });

  it("request history: archived, not erased: hidden from the list, not selectable for a user, history intact", async () => {
    const d = await mkDept("history");
    const u = await mkUser("m5", d.id);
    const done = await mkRequest(d.id, u.id, "COMPLETED");
    const r = await del(d.id, { moveTo: null });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ mode: "ARCHIVED" });
    const row = await prisma.department.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.archivedAt).toBeInstanceOf(Date);
    expect(row.headId).toBeNull();
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: done.id } })).departmentId).toBe(d.id);
    const list = (await (await LIST()).json()) as { id: string }[];
    expect(list.some((x) => x.id === d.id)).toBe(false);
    const toArchived = await USER_PATCH(req("PATCH", { departmentId: d.id }), ctx(name("m5")));
    expect(toArchived.status).toBe(400);
    expect((await INSPECT(req("GET"), ctx(d.id))).status).toBe(404); // already gone for the admin
  });

  it("requests still in flight: refused (nobody could finish them)", async () => {
    const d = await mkDept("open");
    const u = await mkUser("m6", d.id);
    await mkRequest(d.id, u.id, "PENDING_DEPARTMENT_APPROVAL");
    const r = await del(d.id, { moveTo: null });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("OPEN_REQUESTS");
    expect((await prisma.department.findUniqueOrThrow({ where: { id: d.id } })).archivedAt).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: name("m6") } })).departmentId).toBe(d.id);
  });

  it("an archived name can be used again for a new department", async () => {
    const again = await CREATE(req("POST", { name: name("history"), type: "FACTORY" }));
    expect(again.status).toBe(201);
  });

  it("only an administrator", async () => {
    session.current = { user: { id: "someone", role: "EMPLOYEE", name: "x", email: "x@test.local", departmentId: null } };
    const d = await mkDept("guard");
    expect((await del(d.id, { moveTo: null })).status).toBe(403);
    expect((await CREATE(req("POST", { name: name("guard2"), type: "OFFICE" }))).status).toBe(403);
    session.current = { user: { id: ADMIN, role: "ADMIN", name: "a", email: `${ADMIN}@test.local`, departmentId: null } };
  });
});
