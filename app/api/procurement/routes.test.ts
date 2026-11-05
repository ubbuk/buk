import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Authorization of the Manager procurement endpoints, end to end through the
// route handlers (only the session lookup is replaced). Runs on the isolated
// test database.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as LIST } from "./route";
import { GET as DETAIL } from "../requests/[id]/procurement/route";
import { POST as PURCHASE } from "../requests/[id]/procurement/purchases/route";
import { POST as VOID } from "../requests/[id]/procurement/purchases/[purchaseId]/void/route";
import { POST as CORRECT } from "../requests/[id]/procurement/purchases/[purchaseId]/correct/route";
import { POST as COMPLETE } from "../requests/[id]/procurement/complete/route";
import { POST as ACCOUNTING } from "../requests/[id]/accounting-record/route";
import { POST as DEPT_APPROVE } from "../requests/[id]/department-approve/route";
import { POST as EXECUTIVE_APPROVE } from "../requests/[id]/executive-approve/route";

const P = "pq-";
const BETON = `${P}beton`;
const MECH = `${P}mech`;
const roster = {
  empA: { role: "EMPLOYEE", dept: BETON }, // requester
  empB: { role: "EMPLOYEE", dept: BETON }, // colleague
  betonHead: { role: "BOSS", dept: BETON },
  mechHead: { role: "BOSS", dept: MECH },
  mgr: { role: "MANAGER", dept: null },
  mgr2: { role: "MANAGER", dept: null },
  admin: { role: "ADMIN", dept: null },
  director: { role: "DIRECTOR", dept: null },
  store: { role: "STOREKEEPER", dept: null },
  eng: { role: "ENGINEERING", dept: null },
  acct: { role: "CHIEF_ACCOUNTANT", dept: null },
} as const;
type Who = keyof typeof roster;
const uid = (w: Who) => `${P}${w}`;
const as = (w: Who | null) => {
  session.current = w ? { user: { id: uid(w), role: roster[w].role, departmentId: roster[w].dept, name: uid(w), email: `${uid(w)}@t.local` } } : null;
};

let requestId = "";
let bearingId = "";
let washerId = "";
let version = 0;

const ctx = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: requestId, ...extra }) }) as never;
const post = (body?: unknown) => new Request("http://localhost/x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const get = (qs = "") => new Request(`http://localhost/api/procurement${qs}`);

async function cleanup() {
  await prisma.procurementPurchase.deleteMany({ where: { requestItem: { request: { requestNumber: { startsWith: "PQ-" } } } } });
  await prisma.warehouseCheck.deleteMany({ where: { request: { requestNumber: { startsWith: "PQ-" } } } });
  await prisma.approvalAction.deleteMany({ where: { approvalStep: { request: { requestNumber: { startsWith: "PQ-" } } } } });
  await prisma.accountingRecord.deleteMany({ where: { request: { requestNumber: { startsWith: "PQ-" } } } });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: { requestNumber: { startsWith: "PQ-" } } });
  await prisma.department.updateMany({ where: { id: { startsWith: P } }, data: { headId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.department.createMany({ data: [{ id: BETON, name: "pq Beton", type: "FACTORY" }, { id: MECH, name: "pq Mechanic", type: "FACTORY" }] });
  await prisma.user.createMany({
    data: (Object.keys(roster) as Who[]).map((w) => ({ id: uid(w), email: `${uid(w)}@test.local`, name: uid(w), passwordHash: "x", role: roster[w].role as never, departmentId: roster[w].dept })),
  });
  await prisma.department.update({ where: { id: BETON }, data: { headId: uid("betonHead") } });
  await prisma.department.update({ where: { id: MECH }, data: { headId: uid("mechHead") } });

  const approved = ["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL"] as const;
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber: "PQ-1",
      year: 9999,
      sequence: 1,
      departmentId: BETON,
      requestedById: uid("empA"),
      status: "PENDING_PROCUREMENT",
      version: 7,
      items: {
        create: [
          { lineNo: 1, unit: "ш", requestedQuantity: 12, unitPrice: 100, totalPrice: 1200, manualMaterialName: "pq Bearing" },
          { lineNo: 2, unit: "ш", requestedQuantity: 6, unitPrice: 10, totalPrice: 60, manualMaterialName: "pq Washer" },
        ],
      },
      approvalSteps: {
        create: [
          ...approved.map((type, i) => ({ type, sequence: i + 1, status: "APPROVED" as const, assignedUserId: uid("store") })),
          { type: "MANAGER_PROCUREMENT" as const, sequence: 6, status: "PENDING" as const, assignedUserId: null },
          { type: "ACCOUNTING_RECORD" as const, sequence: 7, status: "PENDING" as const, assignedUserId: uid("acct") },
        ],
      },
    },
    include: { items: { orderBy: { lineNo: "asc" } } },
  });
  requestId = created.id;
  bearingId = created.items[0].id;
  washerId = created.items[1].id;
  version = created.version;
  const check = await prisma.warehouseCheck.create({ data: { requestId, checkedById: uid("store") } });
  await prisma.warehouseCheckItem.createMany({
    data: [
      { warehouseCheckId: check.id, requestItemId: bearingId, availableQuantity: 0, allocatedQuantity: 0, missingQuantity: 12 },
      { warehouseCheckId: check.id, requestItemId: washerId, availableQuantity: 6, allocatedQuantity: 6, missingQuantity: 0 },
    ],
  });
});

afterAll(cleanup);

const snapshot = async () => ({
  status: (await prisma.materialRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
  purchases: await prisma.procurementPurchase.count({ where: { requestItem: { requestId } } }),
  voided: await prisma.procurementPurchase.count({ where: { requestItem: { requestId }, voidedAt: { not: null } } }),
  step: (await prisma.approvalStep.findFirstOrThrow({ where: { requestId, type: "MANAGER_PROCUREMENT" } })).status,
});

const NON_MANAGERS: Who[] = ["empA", "empB", "betonHead", "mechHead", "admin", "director", "store", "eng", "acct"];

describe("authentication", () => {
  it("rejects every procurement endpoint without a session", async () => {
    as(null);
    expect((await LIST(get())).status).toBe(401);
    expect((await DETAIL(get(), ctx())).status).toBe(401);
    expect((await PURCHASE(post({}), ctx())).status).toBe(401);
    expect((await VOID(post({}), ctx({ purchaseId: "x" }))).status).toBe(401);
    expect((await CORRECT(post({}), ctx({ purchaseId: "x" }))).status).toBe(401);
    expect((await COMPLETE(post(), ctx())).status).toBe(401);
  });
});

describe("only a MANAGER may write; nobody else inherits it", () => {
  it("returns 403 for every other role on every write endpoint, and changes nothing", async () => {
    const before = await snapshot();
    for (const who of NON_MANAGERS) {
      as(who);
      const body = { itemId: bearingId, quantity: 1, unitPrice: 10, clientRequestId: `denied-${who}-123456` };
      expect((await PURCHASE(post(body), ctx())).status, `purchase as ${who}`).toBe(403);
      expect((await VOID(post({ reason: "x" }), ctx({ purchaseId: "p" }))).status, `void as ${who}`).toBe(403);
      expect((await CORRECT(post({ reason: "x", quantity: 1 }), ctx({ purchaseId: "p" }))).status, `correct as ${who}`).toBe(403);
      expect((await COMPLETE(post(), ctx())).status, `complete as ${who}`).toBe(403);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("a MANAGER holds no approval power: every approval endpoint refuses them", async () => {
    as("mgr");
    const decide = { pin: "1234", expectedVersion: version };
    expect((await DEPT_APPROVE(post(decide), ctx())).status).toBe(403);
    expect((await EXECUTIVE_APPROVE(post(decide), ctx())).status).toBe(403);
    expect((await ACCOUNTING(post({ ledgerNumber: "1", recordDate: "2026-01-01", expectedVersion: version }), ctx())).status).toBe(403);
  });

  it("the Chief Accountant cannot register before the Manager completes", async () => {
    as("acct");
    const res = await ACCOUNTING(post({ ledgerNumber: "EARLY", recordDate: "2026-01-01", expectedVersion: version }), ctx());
    expect(res.status).toBe(409);
    expect(await prisma.accountingRecord.count({ where: { requestId } })).toBe(0);
  });
});

describe("the dashboard list is for MANAGER (and ADMIN to look) only", () => {
  it("403 for everyone else, 200 for MANAGER and ADMIN", async () => {
    for (const who of NON_MANAGERS.filter((w) => w !== "admin")) {
      as(who);
      expect((await LIST(get())).status, who).toBe(403);
    }
    for (const who of ["mgr", "admin"] as const) {
      as(who);
      const res = await LIST(get("?tab=awaiting&q=PQ-1"));
      expect(res.status, who).toBe(200);
      const body = await res.json();
      expect(body.rows.map((r: { requestNumber: string }) => r.requestNumber)).toEqual(["PQ-1"]);
      expect(body.counts).toHaveProperty("awaiting");
    }
  });

  it("validates paging and filters instead of failing", async () => {
    as("mgr");
    const res = await LIST(get("?tab=bogus&page=-4&pageSize=100000&qtyMin=abc&dateFrom=nope&itemStatus=NOPE&q=%25%27%3B--"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageSize).toBeLessThanOrEqual(100);
    expect(body.page).toBe(1);
  });
});

describe("reading one request's purchase progress follows request visibility", () => {
  it("the requester, their department head, the manager and admin can; a colleague and another department cannot", async () => {
    for (const who of ["empA", "betonHead", "mgr", "admin", "director", "store"] as const) {
      as(who);
      expect((await DETAIL(get(), ctx())).status, who).toBe(200);
    }
    for (const who of ["empB", "mechHead"] as const) {
      as(who);
      expect((await DETAIL(get(), ctx())).status, who).toBe(404);
    }
  });

  it("shows the shortfall, not the requested quantity, and no private user data", async () => {
    as("mgr");
    const body = await (await DETAIL(get(), ctx())).json();
    expect(body.items.map((i: { materialName: string; requiredQuantity: number; checked: boolean }) => [i.materialName, i.requiredQuantity, i.checked])).toEqual([
      ["pq Bearing", 12, false],
      ["pq Washer", 0, false],
    ]);
    expect(JSON.stringify(body)).not.toContain("@test.local");
  });
});

describe("the MANAGER's purchase workflow through the API", () => {
  it("validates input, caps at the shortfall, is idempotent and completes only when everything is bought", async () => {
    as("mgr");
    const post1 = (body: unknown) => PURCHASE(post(body), ctx());
    expect((await post1({ itemId: bearingId, quantity: -1, unitPrice: 10 })).status).toBe(400);
    expect((await post1({ itemId: bearingId, quantity: 1 })).status).toBe(400);
    expect((await post1({ itemId: bearingId, quantity: 13, unitPrice: 10 })).status).toBe(409);
    expect((await post1({ itemId: washerId, quantity: 1, unitPrice: 10 })).status).toBe(409); // covered by stock
    expect((await post1({ itemId: "no-such-item", quantity: 1, unitPrice: 10 })).status).toBe(404);

    const key = "retry-key-0001";
    const first = await post1({ itemId: bearingId, quantity: 5, unitPrice: 1250.5, clientRequestId: key });
    const again = await post1({ itemId: bearingId, quantity: 5, unitPrice: 1250.5, clientRequestId: key });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect((await again.json()).duplicate).toBe(true);
    expect((await snapshot()).purchases).toBe(1);

    // still 7 short: cannot complete
    expect((await COMPLETE(post(), ctx())).status).toBe(409);
    expect((await snapshot()).status).toBe("PENDING_PROCUREMENT");

    // a second manager finishes it
    as("mgr2");
    expect((await post1({ itemId: bearingId, quantity: 7, unitPrice: 1300 })).status).toBe(201);
    const done = await COMPLETE(post(), ctx());
    expect(done.status).toBe(200);
    expect((await done.json()).requestStatus).toBe("PENDING_ACCOUNTING");
    expect((await COMPLETE(post(), ctx())).status).toBe(409); // not twice
    expect((await post1({ itemId: bearingId, quantity: 1, unitPrice: 10 })).status).toBe(409); // closed

    // and now the accountant may register, with no PIN
    as("acct");
    const newVersion = (await prisma.materialRequest.findUniqueOrThrow({ where: { id: requestId } })).version;
    const reg = await ACCOUNTING(post({ ledgerNumber: "PQ-LEDGER", recordDate: "2026-01-01", expectedVersion: newVersion }), ctx());
    expect(reg.status).toBe(200);
  });
});
