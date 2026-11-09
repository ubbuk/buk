import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Domestic / International assignment as seen through the route handlers (only
// the session lookup is replaced). Runs on the isolated test database; the two
// procurement positions are configured here and restored afterwards.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as LIST } from "./route";
import { GET as DETAIL } from "../requests/[id]/procurement/route";
import { POST as CLASSIFY } from "../requests/[id]/procurement/classify/route";
import { POST as REASSIGN } from "../requests/[id]/procurement/items/[itemId]/reassign/route";
import { POST as PURCHASE } from "../requests/[id]/procurement/purchases/route";
import { POST as VOID } from "../requests/[id]/procurement/purchases/[purchaseId]/void/route";
import { POST as CORRECT } from "../requests/[id]/procurement/purchases/[purchaseId]/correct/route";
import { POST as COMPLETE } from "../requests/[id]/procurement/complete/route";
import { GET as ROLES_GET, POST as ROLES_POST } from "../admin/approval-roles/route";
import { ADMIN_TEST_HASH, withStepUp } from "./step-up-support";

const P = "pr2-";
const TAG = Date.now().toString(36);
const DEPT = `${P}dept-${TAG}`;
const OTHER_DEPT = `${P}other-${TAG}`;
const roster = {
  emp: { role: "EMPLOYEE", dept: DEPT }, // requester
  empOther: { role: "EMPLOYEE", dept: DEPT }, // colleague
  bossOther: { role: "BOSS", dept: OTHER_DEPT },
  mgrA: { role: "MANAGER", dept: null }, // domestic
  mgrB: { role: "MANAGER", dept: null }, // international
  mgrC: { role: "MANAGER", dept: null },
  admin: { role: "ADMIN", dept: null },
  director: { role: "DIRECTOR", dept: null },
  store: { role: "STOREKEEPER", dept: null },
  acct: { role: "CHIEF_ACCOUNTANT", dept: null },
  inactiveMgr: { role: "MANAGER", dept: null },
} as const;
type Who = keyof typeof roster;
const uid = (w: Who) => `${P}${w}`;
const as = (w: Who | null) => {
  session.current = w ? { user: { id: uid(w), role: roster[w].role, departmentId: roster[w].dept, name: uid(w), email: `${uid(w)}@t.local` } } : null;
};
const POSITIONS = ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] as const;
let previouslyActive: { id: string }[] = [];
let counter = 0;

const post = (body?: unknown) => new Request("http://localhost/x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const get = (qs = "") => new Request(`http://localhost/api/procurement${qs}`);

interface Built {
  id: string;
  number: string;
  item: { cement: string; bearing: string; washer: string };
}
const ctx = (b: Built, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: b.id, ...extra }) }) as never;

async function configure(domestic: Who | null, international: Who | null) {
  await prisma.approvalRoleAssignment.updateMany({ where: { role: { in: [...POSITIONS] }, isActive: true }, data: { isActive: false, endedAt: new Date() } });
  if (domestic) await prisma.approvalRoleAssignment.create({ data: { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: uid(domestic) } });
  if (international) await prisma.approvalRoleAssignment.create({ data: { role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: uid(international) } });
}

async function cleanup() {
  const mine = { requestNumber: { startsWith: "PR2-" } };
  await prisma.procurementPurchase.deleteMany({ where: { requestItem: { request: mine } } });
  await prisma.warehouseCheck.deleteMany({ where: { request: mine } });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: mine });
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.updateMany({ where: { id: { startsWith: P } }, data: { departmentId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  previouslyActive = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: [...POSITIONS] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: false, endedAt: new Date() } });
  await prisma.department.createMany({ data: [{ id: DEPT, name: `PR2 ${TAG} dept`, type: "FACTORY" }, { id: OTHER_DEPT, name: `PR2 ${TAG} other`, type: "FACTORY" }] });
  await prisma.user.createMany({
    data: (Object.keys(roster) as Who[]).map((w) => ({
      id: uid(w), email: `${uid(w)}@test.local`, name: uid(w), passwordHash: w === "admin" ? ADMIN_TEST_HASH : "x", role: roster[w].role as never, departmentId: roster[w].dept, isActive: w !== "inactiveMgr",
    })),
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: true, endedAt: null } });
});

async function build(): Promise<Built> {
  counter += 1;
  const number = `PR2-${TAG}-${counter}`;
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber: number,
      year: 9999,
      sequence: counter,
      departmentId: DEPT,
      requestedById: uid("emp"),
      status: "PENDING_PROCUREMENT",
      version: 5,
      items: {
        create: [
          { lineNo: 1, unit: "ш", requestedQuantity: 20, manualMaterialName: `PR2 ${TAG} cement` },
          { lineNo: 2, unit: "ш", requestedQuantity: 12, manualMaterialName: `PR2 ${TAG} bearing` },
          { lineNo: 3, unit: "ш", requestedQuantity: 6, manualMaterialName: `PR2 ${TAG} washer` },
        ],
      },
      approvalSteps: {
        create: [
          ...(["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL"] as const).map((type, i) => ({ type, sequence: i + 1, status: "APPROVED" as const, assignedUserId: uid("store") })),
          { type: "MANAGER_PROCUREMENT" as const, sequence: 6, status: "PENDING" as const, assignedUserId: null },
          { type: "ACCOUNTING_RECORD" as const, sequence: 7, status: "PENDING" as const, assignedUserId: uid("acct") },
        ],
      },
    },
    include: { items: { orderBy: { lineNo: "asc" } } },
  });
  const [cement, bearing, washer] = created.items.map((i) => i.id);
  const check = await prisma.warehouseCheck.create({ data: { requestId: created.id, checkedById: uid("store") } });
  await prisma.warehouseCheckItem.createMany({
    data: [
      { warehouseCheckId: check.id, requestItemId: cement, availableQuantity: 0, allocatedQuantity: 0, missingQuantity: 20 },
      { warehouseCheckId: check.id, requestItemId: bearing, availableQuantity: 0, allocatedQuantity: 0, missingQuantity: 12 },
      { warehouseCheckId: check.id, requestItemId: washer, availableQuantity: 6, allocatedQuantity: 6, missingQuantity: 0 },
    ],
  });
  return { id: created.id, number, item: { cement, bearing, washer } };
}

const buy = (b: Built, who: Who, item: keyof Built["item"], quantity: number, key?: string) => {
  as(who);
  return PURCHASE(post({ itemId: b.item[item], quantity, unitPrice: 100, clientRequestId: key }), ctx(b));
};
const classify = (b: Built, who: Who, international: (keyof Built["item"])[]) => {
  as(who);
  return CLASSIFY(post({ internationalItemIds: international.map((k) => b.item[k]) }), ctx(b));
};
async function classified() {
  await configure("mgrA", "mgrB");
  const b = await build();
  expect((await classify(b, "mgrB", ["bearing"])).status).toBe(201);
  return b;
}
const stateOf = async (b: Built) => ({
  status: (await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.id } })).status,
  purchases: await prisma.procurementPurchase.count({ where: { requestItem: { requestId: b.id } } }),
  assignments: await prisma.procurementItemAssignment.count({ where: { requestItem: { requestId: b.id } } }),
});

describe("authentication and role gates", () => {
  it("rejects classify / reassign without a session", async () => {
    await configure("mgrA", "mgrB");
    const b = await build();
    as(null);
    expect((await CLASSIFY(post({ internationalItemIds: [] }), ctx(b))).status).toBe(401);
    expect((await REASSIGN(post({ kind: "DOMESTIC", reason: "x" }), ctx(b, { itemId: b.item.cement }))).status).toBe(401);
  });

  it("only MANAGER-role users reach classify, reassign, purchase, void, correct and complete", async () => {
    await configure("mgrA", "mgrB");
    const b = await build();
    const before = await stateOf(b);
    for (const who of ["emp", "empOther", "bossOther", "admin", "director", "store", "acct"] as Who[]) {
      as(who);
      expect((await CLASSIFY(post({ internationalItemIds: [] }), ctx(b))).status, `classify as ${who}`).toBe(403);
      expect((await REASSIGN(post({ kind: "DOMESTIC", reason: "x" }), ctx(b, { itemId: b.item.cement }))).status, `reassign as ${who}`).toBe(403);
      expect((await PURCHASE(post({ itemId: b.item.cement, quantity: 1, unitPrice: 1 }), ctx(b))).status, `purchase as ${who}`).toBe(403);
      expect((await VOID(post({ reason: "x" }), ctx(b, { purchaseId: "p" }))).status, `void as ${who}`).toBe(403);
      expect((await CORRECT(post({ reason: "x", quantity: 1 }), ctx(b, { purchaseId: "p" }))).status, `correct as ${who}`).toBe(403);
      expect((await COMPLETE(post(), ctx(b))).status, `complete as ${who}`).toBe(403);
    }
    expect(await stateOf(b)).toEqual(before);
  });
});

describe("classification through the API", () => {
  it("only the configured International manager may confirm; repeats are idempotent, conflicts are refused", async () => {
    await configure("mgrA", "mgrB");
    const b = await build();
    expect((await classify(b, "mgrA", ["bearing"])).status).toBe(403); // the Domestic manager
    expect((await classify(b, "mgrC", ["bearing"])).status).toBe(403); // a MANAGER holding no position
    expect((await classify(b, "mgrB", ["bearing", "washer"])).status).toBe(400); // washer is covered by stock
    expect((await stateOf(b)).assignments).toBe(0);

    const first = await classify(b, "mgrB", ["bearing"]);
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body.classified).toBe(true);
    expect(body.items.map((i: { materialName: string; assignment: { kind: string } | null }) => [i.materialName.replace(`PR2 ${TAG} `, ""), i.assignment?.kind ?? null])).toEqual([
      ["cement", "DOMESTIC"], ["bearing", "INTERNATIONAL"], ["washer", null],
    ]);
    expect((await classify(b, "mgrB", ["bearing"])).status).toBe(200);
    expect((await classify(b, "mgrB", ["cement"])).status).toBe(409);
    expect((await classify(b, "mgrB", [])).status).toBe(409);
    expect((await stateOf(b)).assignments).toBe(2);
  });

  it("answers 409 while the positions are not configured", async () => {
    await configure(null, null);
    const b = await build();
    expect((await classify(b, "mgrB", [])).status).toBe(409);
  });
});

describe("each manager acts only on their own items", () => {
  it("purchase: 409 before classification; afterwards 403 across managers, 201 for the owner", async () => {
    await configure("mgrA", "mgrB");
    const b = await build();
    expect((await buy(b, "mgrA", "cement", 1)).status).toBe(409);
    expect((await buy(b, "mgrB", "bearing", 1)).status).toBe(409);
    expect((await classify(b, "mgrB", ["bearing"])).status).toBe(201);

    expect((await buy(b, "mgrA", "bearing", 1)).status).toBe(403);
    expect((await buy(b, "mgrB", "cement", 1)).status).toBe(403);
    expect((await buy(b, "mgrC", "cement", 1)).status).toBe(403);
    expect((await buy(b, "mgrA", "washer", 1)).status).toBe(409); // stock-covered
    expect((await buy(b, "mgrA", "cement", 5, `k-${TAG}-1234`)).status).toBe(201);
    expect((await buy(b, "mgrA", "cement", 5, `k-${TAG}-1234`)).status).toBe(200); // same key: acknowledged, not counted
    expect((await buy(b, "mgrB", "bearing", 5)).status).toBe(201);
    expect((await stateOf(b)).purchases).toBe(2);
  });

  it("void and correct: refused across managers, accepted for the owner", async () => {
    const b = await classified();
    const bought = await (await buy(b, "mgrB", "bearing", 4)).json();
    const purchaseId = bought.items.find((i: { materialName: string }) => i.materialName.endsWith("bearing")).purchases[0].id;

    as("mgrA");
    expect((await VOID(post({ reason: "x" }), ctx(b, { purchaseId }))).status).toBe(403);
    expect((await CORRECT(post({ reason: "x", unitPrice: 1 }), ctx(b, { purchaseId }))).status).toBe(403);
    as("mgrB");
    expect((await CORRECT(post({ reason: "price typo", unitPrice: 123.45 }), ctx(b, { purchaseId }))).status).toBe(200);
    expect(await prisma.procurementPurchase.count({ where: { requestItemId: b.item.bearing, voidedAt: { not: null } } })).toBe(1);
  });
});

describe("reassignment through the API", () => {
  it("requires the International manager and a reason", async () => {
    const b = await classified();
    const call = (who: Who, body: unknown) => {
      as(who);
      return REASSIGN(post(body), ctx(b, { itemId: b.item.bearing }));
    };
    expect((await call("mgrA", { kind: "DOMESTIC", reason: "x" })).status).toBe(403);
    expect((await call("mgrB", { kind: "DOMESTIC" })).status).toBe(400);
    expect((await call("mgrB", { kind: "DOMESTIC", reason: "   " })).status).toBe(400);
    expect((await call("mgrB", { kind: "ELSEWHERE", reason: "x" })).status).toBe(400);
    expect((await call("mgrB", { kind: "DOMESTIC", reason: "local supplier" })).status).toBe(200);
    expect((await prisma.procurementItemAssignment.findUniqueOrThrow({ where: { requestItemId: b.item.bearing } })).assignedManagerId).toBe(uid("mgrA"));
    expect(await prisma.auditLog.count({ where: { entityType: "ProcurementItemAssignment", entityId: b.item.bearing, action: "PROCUREMENT_REASSIGN" } })).toBe(1);
  });

  it("is refused (409) while the responsible manager holds active purchases", async () => {
    const b = await classified();
    expect((await buy(b, "mgrB", "bearing", 3)).status).toBe(201);
    as("mgrB");
    expect((await REASSIGN(post({ kind: "DOMESTIC", reason: "too late" }), ctx(b, { itemId: b.item.bearing }))).status).toBe(409);
    expect((await prisma.procurementItemAssignment.findUniqueOrThrow({ where: { requestItemId: b.item.bearing } })).kind).toBe("INTERNATIONAL");
  });
});

describe("completion needs both groups", () => {
  it("one manager finishing their items does not move the request; the last purchase lets it go once", async () => {
    const b = await classified();
    expect((await buy(b, "mgrA", "cement", 20)).status).toBe(201);
    as("mgrA");
    expect((await COMPLETE(post(), ctx(b))).status).toBe(409); // bearing still open
    expect((await stateOf(b)).status).toBe("PENDING_PROCUREMENT");

    expect((await buy(b, "mgrB", "bearing", 12)).status).toBe(201);
    as("mgrC");
    expect((await COMPLETE(post(), ctx(b))).status).toBe(403); // not involved
    as("mgrB");
    expect((await COMPLETE(post(), ctx(b))).status).toBe(200);
    expect((await stateOf(b)).status).toBe("PENDING_ACCOUNTING");
    as("mgrA");
    expect((await COMPLETE(post(), ctx(b))).status).toBe(409); // not twice
    expect(await prisma.notification.count({ where: { userId: uid("acct"), relatedRequestId: b.id } })).toBe(1);
  });
});

describe("the dashboard and request visibility", () => {
  it("lists a manager's own work, shared context on request, everything for ADMIN, and nothing for other roles", async () => {
    const b = await classified();
    const numbers = async (who: Who, qs: string) => {
      as(who);
      const res = await LIST(get(`?tab=all&q=${b.number}${qs}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      return { body, rows: (body.rows as { requestNumber: string }[]).map((r) => r.requestNumber) };
    };
    expect((await numbers("mgrA", "")).rows).toEqual([b.number]);
    expect((await numbers("mgrB", "")).rows).toEqual([b.number]);
    expect((await numbers("mgrC", "")).rows).toEqual([]);
    expect((await numbers("mgrC", "&scope=all")).rows).toEqual([b.number]);
    expect((await numbers("admin", "")).rows).toEqual([b.number]);
    expect((await numbers("mgrA", "&kind=INTERNATIONAL")).rows).toEqual([]);
    expect((await numbers("mgrB", "&kind=INTERNATIONAL")).rows).toEqual([b.number]);

    const info = (await numbers("mgrB", "")).body;
    expect(info).toMatchObject({ mode: "ASSIGNED", viewer: { isInternational: true, isDomestic: false, isAdmin: false } });
    expect(info.managers.domestic.id).toBe(uid("mgrA"));
    for (const who of ["emp", "empOther", "bossOther", "director", "store", "acct"] as Who[]) {
      as(who);
      expect((await LIST(get())).status, who).toBe(403);
    }
  });

  it("the classify queue is the International manager's", async () => {
    await configure("mgrA", "mgrB");
    const b = await build();
    const queue = async (who: Who) => {
      as(who);
      const body = await (await LIST(get(`?tab=classify&q=${b.number}`))).json();
      return body.rows.map((r: { requestNumber: string }) => r.requestNumber);
    };
    expect(await queue("mgrB")).toEqual([b.number]);
    expect(await queue("mgrA")).toEqual([]);
    expect(await queue("mgrC")).toEqual([]);
  });

  it("request detail keeps the employee/department visibility policy, and tells each viewer what they may do", async () => {
    const b = await classified();
    const detail = async (who: Who) => {
      as(who);
      return DETAIL(get(), ctx(b));
    };
    expect((await detail("empOther")).status).toBe(404); // colleague
    expect((await detail("bossOther")).status).toBe(404); // another department's head
    expect((await detail("emp")).status).toBe(200); // the requester
    for (const who of ["mgrA", "mgrB", "mgrC", "admin"] as Who[]) expect((await detail(who)).status, who).toBe(200);

    const canAct = async (who: Who) =>
      ((await (await detail(who)).json()).items as { materialName: string; canAct: boolean }[]).filter((i) => i.canAct).map((i) => i.materialName.replace(`PR2 ${TAG} `, ""));
    expect(await canAct("mgrA")).toEqual(["cement"]);
    expect(await canAct("mgrB")).toEqual(["bearing"]);
    expect(await canAct("mgrC")).toEqual([]);
    expect(await canAct("admin")).toEqual([]);
    expect(await canAct("emp")).toEqual([]);
  });
});

describe("admin configuration of the two positions", () => {
  const set = (who: Who, role: string, target: Who | "ghost") => {
    as(who);
    return ROLES_POST(post(withStepUp({ role, userId: target === "ghost" ? "no-such-user" : uid(target) })));
  };

  it("is ADMIN only", async () => {
    for (const who of ["mgrA", "mgrB", "director", "emp"] as Who[]) {
      expect((await set(who, "DOMESTIC_PROCUREMENT_MANAGER", "mgrA")).status, who).toBe(403);
    }
  });

  it("accepts only an active MANAGER and never the same person in both positions", async () => {
    await configure(null, null);
    expect((await set("admin", "DOMESTIC_PROCUREMENT_MANAGER", "emp")).status).toBe(400); // not a MANAGER
    expect((await set("admin", "INTERNATIONAL_PROCUREMENT_MANAGER", "director")).status).toBe(400);
    expect((await set("admin", "DOMESTIC_PROCUREMENT_MANAGER", "inactiveMgr")).status).toBe(400); // deactivated
    expect((await set("admin", "DOMESTIC_PROCUREMENT_MANAGER", "ghost")).status).toBe(404);

    expect((await set("admin", "DOMESTIC_PROCUREMENT_MANAGER", "mgrA")).status).toBe(200);
    expect((await set("admin", "INTERNATIONAL_PROCUREMENT_MANAGER", "mgrA")).status).toBe(409); // duplicate holder
    expect((await set("admin", "INTERNATIONAL_PROCUREMENT_MANAGER", "mgrB")).status).toBe(200);

    as("admin");
    const listed: { role: string; userId: string }[] = await (await ROLES_GET()).json();
    expect(listed.filter((r) => r.role.endsWith("PROCUREMENT_MANAGER")).map((r) => [r.role, r.userId]).sort()).toEqual([
      ["DOMESTIC_PROCUREMENT_MANAGER", uid("mgrA")],
      ["INTERNATIONAL_PROCUREMENT_MANAGER", uid("mgrB")],
    ]);
  });

  it("replacing a manager who still has unfinished items is refused (HANDOVER_REQUIRED): nothing moves silently", async () => {
    const b = await classified(); // A domestic, B international
    expect((await buy(b, "mgrA", "cement", 4)).status).toBe(201);
    const res = await set("admin", "DOMESTIC_PROCUREMENT_MANAGER", "mgrC");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "HANDOVER_REQUIRED" });

    const rows = await prisma.approvalRoleAssignment.findMany({ where: { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: { startsWith: P }, isActive: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(uid("mgrA"));
    expect((await prisma.procurementItemAssignment.findUniqueOrThrow({ where: { requestItemId: b.item.cement } })).assignedManagerId).toBe(uid("mgrA"));
    expect((await buy(b, "mgrC", "cement", 1)).status).toBe(403); // the would-be replacement has no claim on it
    expect((await buy(b, "mgrA", "cement", 1)).status).toBe(201); // and the holder keeps working
  });
});
