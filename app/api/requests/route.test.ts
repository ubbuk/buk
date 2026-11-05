import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { addAttachments } from "@/lib/attachments";

// Only the session lookup is replaced; the routes, authorization and queries
// run for real against the isolated test database (and the local-fs storage
// driver, pointed at a temp dir by vitest.setup.ts).
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET, POST } from "./route";
import { GET as GET_ONE } from "./[id]/route";
import { GET as GET_ATTACHMENT } from "./[id]/attachments/[attachmentId]/route";
import { GET as SEARCH } from "../search/route";
import { GET as NOTIFICATIONS } from "../notifications/route";

const P = "rt-";
const BETON = `${P}beton`;
const MECH = `${P}mech`;
const NO_HEAD = `${P}nohead`;
const users = {
  betonHead: { id: `${P}beton-head`, role: "BOSS", departmentId: BETON },
  betonEmp: { id: `${P}beton-emp`, role: "EMPLOYEE", departmentId: BETON },
  betonEmp2: { id: `${P}beton-emp2`, role: "EMPLOYEE", departmentId: BETON },
  mechHead: { id: `${P}mech-head`, role: "BOSS", departmentId: MECH },
  mechEmp: { id: `${P}mech-emp`, role: "EMPLOYEE", departmentId: MECH },
  loner: { id: `${P}loner`, role: "EMPLOYEE", departmentId: null },
  admin: { id: `${P}admin`, role: "ADMIN", departmentId: null },
  director: { id: `${P}director`, role: "DIRECTOR", departmentId: null },
  store: { id: `${P}store`, role: "STOREKEEPER", departmentId: null },
};
type TestUser = (typeof users)[keyof typeof users];

const as = (u: TestUser | null) => {
  session.current = u ? { user: { id: u.id, role: u.role, departmentId: u.departmentId, name: u.id, email: `${u.id}@t.local` } } : null;
};

const item = { materialName: "rt material", unit: "ш", requestedQuantity: 1, unitPrice: 100 };
const post = (departmentId: string) =>
  POST(new Request("http://localhost/api/requests", { method: "POST", body: JSON.stringify({ departmentId, items: [item] }) }));

// Beton has two employees (RT-beton by emp, RT-beton2 by emp2) so same-department isolation can be tested.
const requestIds = { beton: "", beton2: "", mech: "" };
let attachmentId = "";

async function cleanup() {
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  // addAttachments writes an audit row for its actor; it would block deleting the user.
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: { requestNumber: { startsWith: "RT-" } } });
  await prisma.department.updateMany({ where: { id: { startsWith: P } }, data: { headId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.department.createMany({
    data: [
      { id: BETON, name: "rt Beton", type: "FACTORY" },
      { id: MECH, name: "rt Mechanic", type: "FACTORY" },
      { id: NO_HEAD, name: "rt NoHead", type: "FACTORY" },
    ],
  });
  await prisma.user.createMany({
    data: Object.values(users).map((u) => ({
      id: u.id,
      email: `${u.id}@test.local`,
      name: u.id,
      passwordHash: "x",
      role: u.role as never,
      departmentId: u.departmentId,
    })),
  });
  await prisma.department.update({ where: { id: BETON }, data: { headId: users.betonHead.id } });
  await prisma.department.update({ where: { id: MECH }, data: { headId: users.mechHead.id } });

  let sequence = 0;
  for (const [key, number, dept, head, by] of [
    ["beton", "RT-beton", BETON, users.betonHead.id, users.betonEmp.id],
    ["beton2", "RT-beton2", BETON, users.betonHead.id, users.betonEmp2.id],
    ["mech", "RT-mech", MECH, users.mechHead.id, users.mechEmp.id],
  ] as const) {
    const created = await prisma.materialRequest.create({
      data: {
        requestNumber: number,
        year: 9999,
        sequence: ++sequence,
        departmentId: dept,
        requestedById: by,
        status: "PENDING_DEPARTMENT_APPROVAL",
        items: { create: [{ lineNo: 1, unit: "ш", requestedQuantity: 1, manualMaterialName: "rt material" }] },
        approvalSteps: {
          create: [
            { type: "DEPARTMENT_HEAD", sequence: 1, status: "PENDING", assignedUserId: head },
            { type: "WAREHOUSE_CHECK", sequence: 2, status: "PENDING", assignedUserId: users.store.id },
          ],
        },
      },
    });
    requestIds[key] = created.id;
  }

  // A file on emp2's request: emp must not be able to download it.
  const uploaded = await addAttachments(requestIds.beton2, users.betonEmp2.id, [
    { fileName: "secret.pdf", mimeType: "application/pdf", sizeBytes: 4, buffer: Buffer.from("%PDF") },
  ]);
  if (!uploaded.ok) throw new Error(uploaded.error);
  attachmentId = uploaded.data[0].id;

  // Two notifications for emp: one for their own request, one pointing at a colleague's.
  await prisma.notification.createMany({
    data: [
      { userId: users.betonEmp.id, type: "GENERIC", title: "own", body: "own", relatedRequestId: requestIds.beton },
      { userId: users.betonEmp.id, type: "GENERIC", title: "colleague", body: "colleague", relatedRequestId: requestIds.beton2 },
      { userId: users.betonEmp.id, type: "GENERIC", title: "no link", body: "no link" },
    ],
  });
});

afterAll(cleanup);

describe("POST /api/requests -- department authorization", () => {
  it("rejects a Beton employee filing for Mechanic (403) and writes nothing", async () => {
    as(users.betonEmp);
    const before = await prisma.materialRequest.count();
    const res = await post(MECH);
    expect(res.status).toBe(403);
    expect(await prisma.materialRequest.count()).toBe(before);
  });

  it("rejects a Beton head filing for Mechanic, and a user with no department", async () => {
    as(users.betonHead);
    expect((await post(MECH)).status).toBe(403);
    as(users.loner);
    expect((await post(MECH)).status).toBe(403);
  });

  it("lets a user through the gate for their own department", async () => {
    // NO_HEAD has no head, so a request that passed authorization stops at the
    // head check (400) -- a 403 here would mean the own-department gate failed.
    as({ ...users.betonEmp, departmentId: NO_HEAD });
    expect((await post(NO_HEAD)).status).toBe(400);
  });

  it("lets ADMIN through the gate for any department", async () => {
    as(users.admin);
    expect((await post(NO_HEAD)).status).toBe(400);
  });

  it("refuses to route a request to a head who is no longer an active BOSS", async () => {
    await prisma.user.update({ where: { id: users.mechHead.id }, data: { isActive: false } });
    try {
      as(users.mechEmp);
      const res = await post(MECH);
      expect(res.status).toBe(400);
    } finally {
      await prisma.user.update({ where: { id: users.mechHead.id }, data: { isActive: true } });
    }
  });
});

describe("GET /api/requests -- list", () => {
  const listed = async (u: TestUser) => {
    as(u);
    const rows: { requestNumber: string }[] = await (await GET()).json();
    return rows.map((r) => r.requestNumber).filter((n) => n.startsWith("RT-")).sort();
  };

  it("shows an employee only the requests they created, even with a same-department colleague", async () => {
    expect(await listed(users.betonEmp)).toEqual(["RT-beton"]);
    expect(await listed(users.betonEmp2)).toEqual(["RT-beton2"]);
    expect(await listed(users.mechEmp)).toEqual(["RT-mech"]);
    expect(await listed(users.loner)).toEqual([]);
  });

  it("shows a department head the requests of the department they head, and no other department's", async () => {
    expect(await listed(users.betonHead)).toEqual(["RT-beton", "RT-beton2"]);
    expect(await listed(users.mechHead)).toEqual(["RT-mech"]);
  });

  it("keeps cross-department access for admin, director and storekeeper", async () => {
    for (const u of [users.admin, users.director, users.store]) {
      expect(await listed(u)).toEqual(["RT-beton", "RT-beton2", "RT-mech"]);
    }
  });
});

describe("GET /api/requests/[id] -- direct access", () => {
  const open = (u: TestUser, id: string) => {
    as(u);
    return GET_ONE(new Request("http://localhost/api/requests/x") as never, { params: Promise.resolve({ id }) });
  };

  it("answers 404 when an employee opens a same-department colleague's request, 200 for their own", async () => {
    expect((await open(users.betonEmp, requestIds.beton2)).status).toBe(404);
    expect((await open(users.betonEmp2, requestIds.beton)).status).toBe(404);
    expect((await open(users.betonEmp, requestIds.beton)).status).toBe(200);
    expect((await open(users.betonEmp2, requestIds.beton2)).status).toBe(200);
  });

  it("answers 404 when the Beton head opens a Mechanic request, 200 for the owning head", async () => {
    expect((await open(users.betonHead, requestIds.mech)).status).toBe(404);
    expect((await open(users.mechHead, requestIds.mech)).status).toBe(200);
    expect((await open(users.betonHead, requestIds.beton2)).status).toBe(200);
  });

  it("lets admin open anything", async () => {
    expect((await open(users.admin, requestIds.mech)).status).toBe(200);
  });
});

describe("GET /api/requests/[id]/attachments/[attachmentId]", () => {
  const download = (u: TestUser) => {
    as(u);
    return GET_ATTACHMENT(new Request("http://localhost/x") as never, {
      params: Promise.resolve({ id: requestIds.beton2, attachmentId }),
    });
  };

  it("does not let a same-department colleague download another employee's file", async () => {
    expect((await download(users.betonEmp)).status).toBe(404);
  });
  it("does not let another department's head or employee download it", async () => {
    expect((await download(users.mechHead)).status).toBe(404);
    expect((await download(users.mechEmp)).status).toBe(404);
    expect((await download(users.loner)).status).toBe(404);
  });
  it("lets the owner, the department head and admin download it", async () => {
    for (const u of [users.betonEmp2, users.betonHead, users.admin]) {
      const res = await download(u);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF");
    }
  });
  it("requires a session", async () => {
    as(null);
    const res = await GET_ATTACHMENT(new Request("http://localhost/x") as never, {
      params: Promise.resolve({ id: requestIds.beton2, attachmentId }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/search -- requests", () => {
  const found = async (u: TestUser) => {
    as(u);
    const body: { requests: { requestNumber: string }[] } = await (await SEARCH(new Request("http://localhost/api/search?q=RT-beton") as never)).json();
    return body.requests.map((r) => r.requestNumber).sort();
  };

  it("surfaces only requests the caller may open", async () => {
    expect(await found(users.betonEmp)).toEqual(["RT-beton"]);
    expect(await found(users.betonEmp2)).toEqual(["RT-beton2"]);
    expect(await found(users.mechEmp)).toEqual([]);
    expect(await found(users.mechHead)).toEqual([]);
    expect(await found(users.betonHead)).toEqual(["RT-beton", "RT-beton2"]);
    expect(await found(users.admin)).toEqual(["RT-beton", "RT-beton2"]);
  });
});

describe("GET /api/notifications -- links", () => {
  it("drops notifications that point at a request the user can't open", async () => {
    as(users.betonEmp);
    const rows: { title: string }[] = await (await NOTIFICATIONS()).json();
    expect(rows.map((r) => r.title).sort()).toEqual(["no link", "own"]);
  });
});
