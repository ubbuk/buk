import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { addAttachments } from "@/lib/attachments";
import { isRequestHiddenFrom, requestScopeWhere } from "@/lib/request-visibility";
import { requestInclude } from "@/lib/serialize";

// Security regression suite for request visibility + RBAC. Only the session
// lookup is replaced; routes, authorization, workflow and queries run for real
// against the isolated test database (vitest.setup.ts refuses anything else).
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as LIST } from "./route";
import { GET as DETAIL } from "./[id]/route";
import { GET as DOWNLOAD } from "./[id]/attachments/[attachmentId]/route";
import { POST as UPLOAD } from "./[id]/attachments/route";
import { POST as DEPT_APPROVE } from "./[id]/department-approve/route";
import { POST as DEPT_RETURN } from "./[id]/department-return/route";
import { POST as WAREHOUSE_CHECK } from "./[id]/warehouse-check/route";
import { POST as BRANCH_APPROVE } from "./[id]/branch-approve/route";
import { POST as BRANCH_RETURN } from "./[id]/branch-return/route";
import { POST as FINANCE_APPROVE } from "./[id]/finance-approve/route";
import { POST as FINANCE_RETURN } from "./[id]/finance-return/route";
import { POST as EXECUTIVE_APPROVE } from "./[id]/executive-approve/route";
import { POST as EXECUTIVE_RETURN } from "./[id]/executive-return/route";
import { POST as ACCOUNTING } from "./[id]/accounting-record/route";
import { PATCH as PRICE } from "./[id]/items/[itemId]/price/route";
import { POST as RESUBMIT } from "./[id]/resubmit/route";
import { GET as SEARCH } from "../search/route";
import { GET as NOTIFICATIONS } from "../notifications/route";
import { POST as NOTIFICATION_READ } from "../notifications/[id]/read/route";

const P = "sx-";
const PIN = "1234";
const BETON = `${P}beton`;
const MECH = `${P}mech`;

const roster = {
  empA: { role: "EMPLOYEE", dept: BETON },
  empB: { role: "EMPLOYEE", dept: BETON },
  betonHead: { role: "BOSS", dept: BETON },
  betonBoss2: { role: "BOSS", dept: BETON }, // same department, not the head
  mechHead: { role: "BOSS", dept: MECH },
  mechEmp: { role: "EMPLOYEE", dept: MECH },
  store: { role: "STOREKEEPER", dept: null }, // assigned: warehouse
  store2: { role: "STOREKEEPER", dept: null },
  branch: { role: "ENGINEERING", dept: null }, // assigned: branch
  eng2: { role: "ENGINEERING", dept: null },
  fin: { role: "DIRECTOR", dept: null }, // assigned: finance
  exec: { role: "DIRECTOR", dept: null }, // assigned: executive
  director2: { role: "DIRECTOR", dept: null }, // reads everything, assigned nothing
  acct: { role: "CHIEF_ACCOUNTANT", dept: null }, // assigned: accounting
  acct2: { role: "CHIEF_ACCOUNTANT", dept: null },
  manager: { role: "MANAGER", dept: null },
  admin: { role: "ADMIN", dept: null },
} as const;
type Who = keyof typeof roster;
const id = (w: Who) => `${P}${w}`;
const as = (w: Who | null) => {
  session.current = w ? { user: { id: id(w), role: roster[w].role, departmentId: roster[w].dept, name: id(w), email: `${id(w)}@t.local` } } : null;
};

type ReqKey = "deptBeton" | "deptBetonOk" | "deptMech" | "empBReq" | "wh" | "branch" | "fin" | "exec" | "acct" | "returned" | "named";
const reqIds = {} as Record<ReqKey, string>;
const itemIds = {} as Record<ReqKey, string>;
let empBAttachmentId = "";

type Status =
  | "PENDING_DEPARTMENT_APPROVAL" | "PENDING_WAREHOUSE_CHECK" | "PENDING_BRANCH_APPROVAL" | "PENDING_FINANCE_APPROVAL"
  | "PENDING_EXECUTIVE_APPROVAL" | "PENDING_ACCOUNTING" | "RETURNED_BY_DEPARTMENT";
const ORDER = ["PENDING_DEPARTMENT_APPROVAL", "PENDING_WAREHOUSE_CHECK", "PENDING_BRANCH_APPROVAL", "PENDING_FINANCE_APPROVAL", "PENDING_EXECUTIVE_APPROVAL", "PENDING_ACCOUNTING"];

async function makeRequest(key: ReqKey, dept: string, head: Who, by: Who, status: Status) {
  const reached = status === "RETURNED_BY_DEPARTMENT" ? 0 : ORDER.indexOf(status);
  const types = ["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL", "ACCOUNTING_RECORD"] as const;
  const assignees: Who[] = [head, "store", "branch", "fin", "exec", "acct"];
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber: `SX-${key}`,
      year: 9999,
      sequence: Object.keys(reqIds).length + 1,
      departmentId: dept,
      requestedById: id(by),
      status,
      submittedAt: new Date(),
      items: { create: [{ lineNo: 1, unit: "ш", requestedQuantity: 1, unitPrice: 100, totalPrice: 100, manualMaterialName: "sx material" }] },
      approvalSteps: {
        create: types.map((type, i) => ({
          type,
          sequence: i + 1,
          assignedUserId: id(assignees[i]),
          status: status === "RETURNED_BY_DEPARTMENT" ? (i === 0 ? ("REJECTED" as const) : ("SKIPPED" as const)) : i < reached ? ("APPROVED" as const) : ("PENDING" as const),
        })),
      },
    },
    include: { items: true },
  });
  reqIds[key] = created.id;
  itemIds[key] = created.items[0].id;
}

async function cleanup() {
  await prisma.approvalAction.deleteMany({ where: { approvalStep: { request: { requestNumber: { startsWith: "SX-" } } } } });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: { requestNumber: { startsWith: "SX-" } } });
  await prisma.department.updateMany({ where: { id: { startsWith: P } }, data: { headId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.department.createMany({
    data: [
      { id: BETON, name: "sx Beton", type: "FACTORY" },
      { id: MECH, name: "sx Mechanic", type: "FACTORY" },
    ],
  });
  await prisma.user.createMany({
    data: (Object.keys(roster) as Who[]).map((w) => ({
      id: id(w),
      email: `${id(w)}@test.local`,
      name: id(w),
      passwordHash: "x",
      role: roster[w].role as never,
      departmentId: roster[w].dept,
    })),
  });
  await prisma.department.update({ where: { id: BETON }, data: { headId: id("betonHead") } });
  await prisma.department.update({ where: { id: MECH }, data: { headId: id("mechHead") } });
  await prisma.approvalPinCredential.create({ data: { userId: id("betonHead"), pinHash: await bcrypt.hash(PIN, 10) } });

  await makeRequest("deptBeton", BETON, "betonHead", "empA", "PENDING_DEPARTMENT_APPROVAL");
  await makeRequest("deptBetonOk", BETON, "betonHead", "empA", "PENDING_DEPARTMENT_APPROVAL");
  await makeRequest("empBReq", BETON, "betonHead", "empB", "PENDING_DEPARTMENT_APPROVAL");
  await makeRequest("deptMech", MECH, "mechHead", "mechEmp", "PENDING_DEPARTMENT_APPROVAL");
  await makeRequest("wh", BETON, "betonHead", "empA", "PENDING_WAREHOUSE_CHECK");
  await makeRequest("branch", BETON, "betonHead", "empA", "PENDING_BRANCH_APPROVAL");
  await makeRequest("fin", BETON, "betonHead", "empA", "PENDING_FINANCE_APPROVAL");
  await makeRequest("exec", BETON, "betonHead", "empA", "PENDING_EXECUTIVE_APPROVAL");
  await makeRequest("acct", BETON, "betonHead", "empA", "PENDING_ACCOUNTING");
  await makeRequest("returned", BETON, "betonHead", "empA", "RETURNED_BY_DEPARTMENT");
  // empA's request whose warehouse step names empB: being named on a step must not let an EMPLOYEE read it.
  await makeRequest("named", BETON, "betonHead", "empA", "PENDING_WAREHOUSE_CHECK");
  await prisma.approvalStep.updateMany({ where: { requestId: reqIds.named, type: "WAREHOUSE_CHECK" }, data: { assignedUserId: id("empB") } });

  const uploaded = await addAttachments(reqIds.empBReq, id("empB"), [
    { fileName: "b.pdf", mimeType: "application/pdf", sizeBytes: 4, buffer: Buffer.from("%PDF") },
  ]);
  if (!uploaded.ok) throw new Error(uploaded.error);
  empBAttachmentId = uploaded.data[0].id;

  await prisma.notification.create({
    data: { userId: id("empA"), type: "GENERIC", title: "for A", body: "for A", relatedRequestId: reqIds.deptBeton },
  });
});

afterAll(cleanup);

// --- helpers ---------------------------------------------------------------

type Handler = (req: Request, ctx: never) => Promise<Response> | Response;
const ctx = (extra: Record<string, string>) => ({ params: Promise.resolve(extra) }) as never;
const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

async function state(key: ReqKey) {
  const r = await prisma.materialRequest.findUniqueOrThrow({
    where: { id: reqIds[key] },
    include: { approvalSteps: { orderBy: { sequence: "asc" } }, items: true },
  });
  const actions = await prisma.approvalAction.count({ where: { approvalStep: { requestId: r.id } } });
  return {
    status: r.status,
    version: r.version,
    steps: r.approvalSteps.map((s) => `${s.type}:${s.status}:${s.decidedById ?? ""}`),
    prices: r.items.map((i) => String(i.unitPrice)),
    actions,
  };
}

// Calls a mutating endpoint as `who` and asserts the exact HTTP status and that
// nothing about the request changed.
async function expectDenied(handler: Handler, who: Who, key: ReqKey, body: unknown, status: number, extra: Record<string, string> = {}) {
  const before = await state(key);
  as(who);
  const res = await handler(json(body), ctx({ id: reqIds[key], ...extra }));
  expect(res.status, `${who} -> ${key}`).toBe(status);
  expect(await state(key)).toEqual(before);
}

const decide = { pin: PIN, expectedVersion: 1 };
const reason = { reason: "no", expectedVersion: 1 };

// --- 1. authentication -------------------------------------------------------

describe("unauthenticated access", () => {
  it("is rejected with 401 on every read endpoint", async () => {
    as(null);
    expect((await LIST()).status).toBe(401);
    expect((await DETAIL(new Request("http://x"), ctx({ id: reqIds.deptBeton }))).status).toBe(401);
    expect((await DOWNLOAD(new Request("http://x"), ctx({ id: reqIds.empBReq, attachmentId: empBAttachmentId }))).status).toBe(401);
    expect((await SEARCH(new Request("http://localhost/api/search?q=SX-") as never)).status).toBe(401);
    expect((await NOTIFICATIONS()).status).toBe(401);
  });
  it("is rejected with 401 on every mutating endpoint", async () => {
    as(null);
    const mutating: [string, Handler][] = [
      ["dept-approve", DEPT_APPROVE], ["dept-return", DEPT_RETURN], ["warehouse", WAREHOUSE_CHECK],
      ["branch-approve", BRANCH_APPROVE], ["branch-return", BRANCH_RETURN], ["finance-approve", FINANCE_APPROVE],
      ["finance-return", FINANCE_RETURN], ["exec-approve", EXECUTIVE_APPROVE], ["exec-return", EXECUTIVE_RETURN],
      ["accounting", ACCOUNTING], ["resubmit", RESUBMIT], ["upload", UPLOAD],
    ];
    for (const [name, h] of mutating) {
      expect((await h(json({}), ctx({ id: reqIds.deptBeton }))).status, name).toBe(401);
    }
    expect((await PRICE(json({}), ctx({ id: reqIds.deptBeton, itemId: itemIds.deptBeton }))).status).toBe(401);
  });
});

// --- 2. EMPLOYEE: IDOR (read / modify / attachments) --------------------------

describe("EMPLOYEE cannot read, change or download another employee's request", () => {
  it("cannot open it by id, find it by search, or see it in the list (colleague in the same department)", async () => {
    as("empA");
    expect((await DETAIL(new Request("http://x"), ctx({ id: reqIds.empBReq }))).status).toBe(404);

    const list: { requestNumber: string }[] = await (await LIST()).json();
    expect(list.map((r) => r.requestNumber).filter((n) => n.startsWith("SX-"))).not.toContain("SX-empBReq");

    for (const q of ["SX-empBReq", `${P}empB`]) {
      const body: { requests: { requestNumber: string }[] } = await (await SEARCH(new Request(`http://localhost/api/search?q=${q}`) as never)).json();
      expect(body.requests.map((r) => r.requestNumber), q).not.toContain("SX-empBReq");
    }
  });

  it("cannot read a request even when named as an assignee on one of its steps", async () => {
    as("empB");
    expect((await DETAIL(new Request("http://x"), ctx({ id: reqIds.named }))).status).toBe(404);
    const list: { requestNumber: string }[] = await (await LIST()).json();
    expect(list.map((r) => r.requestNumber)).not.toContain("SX-named");
  });

  it("cannot download the colleague's attachment, nor smuggle it through one of their own request ids", async () => {
    as("empA");
    expect((await DOWNLOAD(new Request("http://x"), ctx({ id: reqIds.empBReq, attachmentId: empBAttachmentId }))).status).toBe(404);
    // own, visible request id + someone else's attachment id: the attachment must belong to that request
    expect((await DOWNLOAD(new Request("http://x"), ctx({ id: reqIds.deptBeton, attachmentId: empBAttachmentId }))).status).toBe(404);
    as("empB");
    expect((await DOWNLOAD(new Request("http://x"), ctx({ id: reqIds.empBReq, attachmentId: empBAttachmentId }))).status).toBe(200);
  });

  it("cannot attach files to, resubmit or price someone else's request", async () => {
    const form = new FormData();
    form.append("files", new File([Buffer.from("%PDF")], "x.pdf", { type: "application/pdf" }));
    as("empA");
    const before = await prisma.attachment.count({ where: { requestId: reqIds.empBReq } });
    const upload = await UPLOAD(new Request("http://x", { method: "POST", body: form }), ctx({ id: reqIds.empBReq }));
    expect(upload.status).toBe(403);
    expect(await prisma.attachment.count({ where: { requestId: reqIds.empBReq } })).toBe(before);

    // a returned request can only be resubmitted by its own requester
    const item = { materialName: "x", unit: "ш", requestedQuantity: 1, unitPrice: 1 };
    await expectDenied(RESUBMIT, "empB", "returned", { expectedVersion: 1, items: [item] }, 403);
    await expectDenied(PRICE, "empA", "empBReq", { unitPrice: 5, expectedVersion: 1 }, 403, { itemId: itemIds.empBReq });
  });

  it("cannot approve, return, check stock, or record anything -- even on their own request", async () => {
    const calls: [string, Handler, unknown][] = [
      ["dept-approve", DEPT_APPROVE, decide], ["dept-return", DEPT_RETURN, reason],
      ["branch-approve", BRANCH_APPROVE, decide], ["branch-return", BRANCH_RETURN, reason],
      ["finance-approve", FINANCE_APPROVE, decide], ["finance-return", FINANCE_RETURN, reason],
      ["exec-approve", EXECUTIVE_APPROVE, decide], ["exec-return", EXECUTIVE_RETURN, reason],
      ["warehouse-check", WAREHOUSE_CHECK, { items: [], ...decide }],
      ["accounting", ACCOUNTING, { ledgerNumber: "1", recordDate: "2026-01-01", expectedVersion: 1 }],
    ];
    for (const [, handler, body] of calls) {
      await expectDenied(handler, "empA", "deptBeton", body, 403);
      await expectDenied(handler, "empB", "deptBeton", body, 403);
    }
    await expectDenied(PRICE, "empA", "deptBeton", { unitPrice: 5, expectedVersion: 1 }, 403, { itemId: itemIds.deptBeton });
  });

  it("cannot mark another user's notification as read", async () => {
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: id("empA") } });
    as("empB");
    const res = await NOTIFICATION_READ(new Request("http://x", { method: "POST" }), ctx({ id: note.id }));
    expect(res.status).toBe(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: note.id } })).isRead).toBe(false);
  });
});

// --- 3. BOSS: only their own department ---------------------------------------

describe("BOSS acts only on the department they head", () => {
  it("a same-department BOSS who is not the head, and other departments' heads, are denied", async () => {
    for (const who of ["betonBoss2", "mechHead"] as const) {
      await expectDenied(DEPT_APPROVE, who, "deptBeton", decide, 403);
      await expectDenied(DEPT_RETURN, who, "deptBeton", reason, 403);
    }
    await expectDenied(DEPT_APPROVE, "betonHead", "deptMech", decide, 403);
    await expectDenied(DEPT_RETURN, "betonHead", "deptMech", reason, 403);
  });

  it("a BOSS cannot read another department's request or its files", async () => {
    as("betonHead");
    expect((await DETAIL(new Request("http://x"), ctx({ id: reqIds.deptMech }))).status).toBe(404);
    as("betonBoss2");
    expect((await DETAIL(new Request("http://x"), ctx({ id: reqIds.deptBeton }))).status).toBe(404);
    expect((await DOWNLOAD(new Request("http://x"), ctx({ id: reqIds.empBReq, attachmentId: empBAttachmentId }))).status).toBe(404);
  });

  it("positive control: the real head can read and approve their own department's request", async () => {
    as("betonHead");
    expect((await DETAIL(new Request("http://x"), ctx({ id: reqIds.deptBetonOk }))).status).toBe(200);
    const res = await DEPT_APPROVE(json(decide), ctx({ id: reqIds.deptBetonOk }));
    expect(res.status).toBe(200);
    expect((await state("deptBetonOk")).status).toBe("PENDING_WAREHOUSE_CHECK");
  });
});

// --- 4. read access never grants write/approve --------------------------------

describe("global read roles can see requests but cannot decide them unless assigned", () => {
  it("lets them read", async () => {
    for (const who of ["director2", "eng2", "store2", "acct2", "manager", "admin"] as const) {
      as(who);
      expect((await DETAIL(new Request("http://x"), ctx({ id: reqIds.fin }))).status, who).toBe(200);
    }
  });

  it("DIRECTOR with no step is denied branch / finance / executive decisions", async () => {
    await expectDenied(BRANCH_APPROVE, "director2", "branch", decide, 403);
    await expectDenied(BRANCH_RETURN, "director2", "branch", reason, 403);
    await expectDenied(FINANCE_APPROVE, "director2", "fin", decide, 403);
    await expectDenied(FINANCE_RETURN, "director2", "fin", reason, 403);
    await expectDenied(EXECUTIVE_APPROVE, "director2", "exec", decide, 403);
    await expectDenied(EXECUTIVE_RETURN, "director2", "exec", reason, 403);
  });

  it("a DIRECTOR assigned to one stage cannot decide another stage's step", async () => {
    await expectDenied(EXECUTIVE_APPROVE, "fin", "exec", decide, 403);
    await expectDenied(FINANCE_APPROVE, "exec", "fin", decide, 403);
  });

  it("ENGINEERING, STOREKEEPER, CHIEF_ACCOUNTANT without the step are denied", async () => {
    await expectDenied(BRANCH_APPROVE, "eng2", "branch", decide, 403);
    await expectDenied(BRANCH_RETURN, "eng2", "branch", reason, 403);
    await expectDenied(WAREHOUSE_CHECK, "store2", "wh", { items: [], ...decide }, 403);
    await expectDenied(ACCOUNTING, "acct2", "acct", { ledgerNumber: "1", recordDate: "2026-01-01", expectedVersion: 1 }, 403);
  });

  it("a role-correct assignee is still blocked out of stage order (409), and the wrong role is blocked (403)", async () => {
    await expectDenied(FINANCE_APPROVE, "fin", "exec", decide, 409); // finance step already done, request is at executive
    await expectDenied(BRANCH_APPROVE, "fin", "branch", decide, 403); // DIRECTOR allowed by role gate, not assigned
    await expectDenied(FINANCE_APPROVE, "branch", "fin", decide, 403); // ENGINEERING role
    await expectDenied(ACCOUNTING, "fin", "acct", { ledgerNumber: "1", recordDate: "2026-01-01", expectedVersion: 1 }, 403);
  });

  it("MANAGER and ADMIN cannot approve; only MANAGER may edit a price", async () => {
    await expectDenied(DEPT_APPROVE, "manager", "deptBeton", decide, 403);
    await expectDenied(FINANCE_APPROVE, "manager", "fin", decide, 403);
    await expectDenied(DEPT_APPROVE, "admin", "deptBeton", decide, 403);
    await expectDenied(FINANCE_APPROVE, "admin", "fin", decide, 403);
    await expectDenied(PRICE, "admin", "fin", { unitPrice: 5, expectedVersion: 1 }, 403, { itemId: itemIds.fin });
    await expectDenied(PRICE, "director2", "fin", { unitPrice: 5, expectedVersion: 1 }, 403, { itemId: itemIds.fin });
  });

  it("a price edit cannot target an item of a different request", async () => {
    await expectDenied(PRICE, "manager", "fin", { unitPrice: 5, expectedVersion: 1 }, 404, { itemId: itemIds.exec });
  });
});

// --- 5. request visibility and requestScopeWhere agree ------------------------

describe("request visibility is consistent across list, detail, search and requestScopeWhere", () => {
  it("every request a user may open is inside their SQL scope, and the APIs agree with the predicate", async () => {
    const all = await prisma.materialRequest.findMany({ where: { requestNumber: { startsWith: "SX-" } }, include: requestInclude });
    expect(all.length).toBe(Object.keys(reqIds).length);

    for (const who of Object.keys(roster) as Who[]) {
      const { role } = roster[who];
      const visible = new Set(all.filter((r) => !isRequestHiddenFrom(r, id(who), role)).map((r) => r.requestNumber));

      // 1) SQL pre-filter is a superset of what the predicate allows
      const scope = requestScopeWhere(id(who), role);
      const scoped = new Set((await prisma.materialRequest.findMany({ where: { AND: [{ requestNumber: { startsWith: "SX-" } }, ...(scope ? [scope] : [])] }, select: { requestNumber: true } })).map((r) => r.requestNumber));
      for (const n of visible) expect(scoped.has(n), `${who} may open ${n} but it is outside requestScopeWhere`).toBe(true);

      // 2) list API == predicate
      as(who);
      const listed = new Set(((await (await LIST()).json()) as { requestNumber: string }[]).map((r) => r.requestNumber).filter((n) => n.startsWith("SX-")));
      expect([...listed].sort(), `list for ${who}`).toEqual([...visible].sort());

      // 3) detail API == predicate, for every request
      for (const r of all) {
        const res = await DETAIL(new Request("http://x"), ctx({ id: r.id }));
        expect(res.status, `${who} detail ${r.requestNumber}`).toBe(visible.has(r.requestNumber) ? 200 : 404);
      }

      // 4) search never returns something the predicate would hide
      const found: { requests: { requestNumber: string }[] } = await (await SEARCH(new Request("http://localhost/api/search?q=SX-") as never)).json();
      for (const r of found.requests) expect(visible.has(r.requestNumber), `${who} search leaked ${r.requestNumber}`).toBe(true);
    }
    // GET /api/requests loads every request, 17 users x (list + every detail): give it room as the shared test DB grows.
  }, 120_000);
});
