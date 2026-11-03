import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { logMonitoringDenied } from "./audit";
import { getActivity, getDepartments, getEmployees, getOverview, getPending, getReturned } from "./queries";
import { resolveRange } from "./time";

// Runs against the isolated test database (see vitest.setup.ts) with real
// rows -- no mocked data layer. Fixture ids are prefixed so cleanup is exact.
const P = "mon-t-";
const ASOF = new Date("2026-11-03T10:00:00Z");
const h = (hoursAgo: number) => new Date(ASOF.getTime() - hoursAgo * 3600_000);

const ids = {
  deptA: `${P}dept-a`,
  deptB: `${P}dept-b`,
  empA: `${P}emp-a`,
  empB: `${P}emp-b`,
  approver: `${P}approver`,
  req: (n: number) => `${P}req-${n}`,
};

async function mkRequest(n: number, status: string, dept: string, by: string, createdAt: Date, submittedAt: Date | null = null) {
  return prisma.materialRequest.create({
    data: {
      id: ids.req(n),
      requestNumber: `${P}${n}`,
      year: 2026,
      sequence: 900 + n,
      departmentId: dept,
      requestedById: by,
      status: status as never,
      createdAt,
      submittedAt,
    },
  });
}

async function cleanup() {
  await prisma.approvalAction.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ id: { startsWith: P } }, { actorId: { startsWith: P } }] } });
  await prisma.approvalStep.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.department.createMany({
    data: [
      { id: ids.deptA, name: "Monitoring тест A", type: "FACTORY" },
      { id: ids.deptB, name: "Monitoring тест B", type: "OFFICE" },
    ],
  });
  const base = { passwordHash: "x", isActive: true };
  await prisma.user.createMany({
    data: [
      { id: ids.empA, email: `${P}a@test.local`, name: "Тест Ажилтан А", role: "EMPLOYEE", departmentId: ids.deptA, ...base },
      { id: ids.empB, email: `${P}b@test.local`, name: "Тест Ажилтан Б", role: "EMPLOYEE", departmentId: ids.deptB, ...base },
      { id: ids.approver, email: `${P}ap@test.local`, name: "Тест Батлагч", role: "MANAGER", departmentId: ids.deptA, ...base },
    ],
  });

  // 1: pending dept approval, submitted 30h ago, no audit rows -> falls back to submittedAt
  await mkRequest(1, "PENDING_DEPARTMENT_APPROVAL", ids.deptA, ids.empA, h(40), h(30));
  // 2: pending finance; SUBMIT 20h ago, APPROVE 5h ago -> pending since 5h ago
  await mkRequest(2, "PENDING_FINANCE_APPROVAL", ids.deptA, ids.empA, h(21), h(20));
  // 3: returned by department; returns 10h and 2h ago
  await mkRequest(3, "RETURNED_BY_DEPARTMENT", ids.deptB, ids.empB, h(48), h(47));
  // 4: completed
  await mkRequest(4, "COMPLETED", ids.deptB, ids.empB, h(60), h(59));
  // 5: very old (outside 7d) pending request
  await mkRequest(5, "PENDING_ACCOUNTING", ids.deptB, ids.empB, new Date("2026-08-01T00:00:00Z"), new Date("2026-08-01T00:00:00Z"));
  // 7: created 2026-11-02T17:30Z = 01:30 on Nov 3 in Ulaanbaatar (UTC day would be Nov 2)
  await mkRequest(7, "DRAFT", ids.deptA, ids.empA, new Date("2026-11-02T17:30:00Z"));

  const step = (n: number, seq: number, status: string, assignee: string | null) => ({
    id: `${P}step-${n}-${seq}`,
    requestId: ids.req(n),
    type: "DEPARTMENT_HEAD" as const,
    sequence: seq,
    status: status as never,
    assignedUserId: assignee,
  });
  await prisma.approvalStep.createMany({
    data: [
      step(1, 1, "PENDING", ids.approver),
      step(2, 1, "APPROVED", ids.approver),
      step(2, 2, "PENDING", null),
      step(3, 1, "REJECTED", ids.approver),
    ],
  });

  const audit = (n: number, action: string, at: Date, actor: string) => ({
    id: `${P}audit-${n}-${action}-${at.getTime()}`,
    entityType: "MaterialRequest",
    entityId: ids.req(n),
    action: action as never,
    actorId: actor,
    createdAt: at,
  });
  await prisma.auditLog.createMany({
    data: [
      audit(2, "SUBMIT", h(20), ids.empA),
      audit(2, "APPROVE", h(5), ids.approver),
      audit(3, "RETURN", h(10), ids.approver),
      audit(3, "RETURN", h(2), ids.approver),
    ],
  });
  await prisma.approvalAction.createMany({
    data: [
      { id: `${P}act-1`, approvalStepId: `${P}step-3-1`, actorId: ids.approver, action: "RETURN", reason: "Хуучин шалтгаан", createdAt: h(10) },
      { id: `${P}act-2`, approvalStepId: `${P}step-3-1`, actorId: ids.approver, action: "RETURN", reason: "Үнэ дутуу байна", createdAt: h(2) },
    ],
  });
});

afterAll(cleanup);

describe("getPending", () => {
  it("measures waiting time from the latest status transition, falling back to submittedAt", async () => {
    const data = await getPending(ASOF, 1, 100);
    const byNo = new Map(data.list.rows.map((r) => [r.requestNumber, r]));

    expect(byNo.get(`${P}1`)?.waitingSeconds).toBe(30 * 3600); // submittedAt fallback
    expect(byNo.get(`${P}2`)?.waitingSeconds).toBe(5 * 3600); // last APPROVE, not the older SUBMIT
    expect(byNo.get(`${P}2`)?.since).toBe(h(5).toISOString());
    expect(byNo.get(`${P}1`)?.assignee).toBe("Тест Батлагч");
    expect(byNo.get(`${P}2`)?.assignee).toBeNull(); // pending step has no assignee
    expect(byNo.has(`${P}3`)).toBe(false); // returned is not "pending"
    expect(byNo.has(`${P}4`)).toBe(false); // completed is not pending
  });

  it("orders longest-waiting first and paginates", async () => {
    const all = await getPending(ASOF, 1, 100);
    const secs = all.list.rows.map((r) => r.waitingSeconds);
    expect(secs).toEqual([...secs].sort((a, b) => b - a));
    expect(all.list.rows[0].requestNumber).toBe(`${P}5`); // the August request is the oldest

    const p1 = await getPending(ASOF, 1, 1);
    const p2 = await getPending(ASOF, 2, 1);
    expect(p1.list.rows).toHaveLength(1);
    expect(p1.list.total).toBe(all.list.total);
    expect(p2.list.rows[0].id).toBe(all.list.rows[1].id);
  });

  it("ranks bottleneck stages and assignees from real waits", async () => {
    const data = await getPending(ASOF, 1, 1);
    const stage = data.stages.find((s) => s.status === "PENDING_DEPARTMENT_APPROVAL")!;
    expect(stage.count).toBeGreaterThanOrEqual(1);
    expect(stage.maxSeconds).toBeGreaterThanOrEqual(30 * 3600);
    // The 3-month-old accounting request dominates total waiting time.
    expect(data.stages[0].status).toBe("PENDING_ACCOUNTING");
    expect(data.assignees.length).toBeGreaterThan(0);
    for (const s of data.stages) expect(s.avgSeconds).toBeLessThanOrEqual(s.maxSeconds);
  });
});

describe("getDepartments / getEmployees", () => {
  const range = resolveRange("7d", ASOF);

  it("counts requests per department by bucket within the range", async () => {
    const depts = await getDepartments(range, 1, 100);
    const a = depts.rows.find((d) => d.id === ids.deptA)!;
    const b = depts.rows.find((d) => d.id === ids.deptB)!;
    expect(a).toMatchObject({ total: 3, pending: 2, returned: 0, completed: 0, activeMembers: 2 }); // reqs 1,2,7
    expect(b).toMatchObject({ total: 2, pending: 0, returned: 1, completed: 1, activeMembers: 1 }); // req 5 is outside 7d
  });

  it("includes older requests with the 'all' range", async () => {
    const depts = await getDepartments(resolveRange("all", ASOF), 1, 100);
    expect(depts.rows.find((d) => d.id === ids.deptB)).toMatchObject({ total: 3, pending: 1 });
  });

  it("counts requests per employee and paginates", async () => {
    const all = await getEmployees(range, 1, 100);
    expect(all.rows.find((e) => e.id === ids.empA)).toMatchObject({ total: 3, pending: 2 });
    expect(all.rows.find((e) => e.id === ids.empB)).toMatchObject({ total: 2, returned: 1, completed: 1 });
    const first = await getEmployees(range, 1, 1);
    expect(first.rows).toHaveLength(1);
    expect(first.total).toBe(all.total);
  });
});

describe("getReturned", () => {
  it("shows the latest return decision (who, why, when)", async () => {
    const data = await getReturned(resolveRange("all", ASOF), 1, 100);
    const row = data.rows.find((r) => r.requestNumber === `${P}3`)!;
    expect(row).toMatchObject({ status: "RETURNED_BY_DEPARTMENT", returnedBy: "Тест Батлагч", reason: "Үнэ дутуу байна" });
    expect(row.returnedAt).toBe(h(2).toISOString());
    expect(data.rows.every((r) => r.status.startsWith("RETURNED_BY"))).toBe(true);
  });
});

describe("getActivity", () => {
  it("filters by action, paginates, resolves request numbers and omits payloads", async () => {
    const range = resolveRange("all", ASOF);
    const returns = await getActivity(range, 1, 100, { action: "RETURN" });
    const mine = returns.rows.filter((r) => r.actorId === ids.approver);
    expect(mine).toHaveLength(2);
    expect(mine[0].entityLabel).toBe(`№${P}3`);
    expect(mine[0].actorName).toBe("Тест Батлагч");
    expect(new Date(mine[0].createdAt).getTime()).toBeGreaterThan(new Date(mine[1].createdAt).getTime()); // newest first
    expect(mine[0]).not.toHaveProperty("beforeJson");
    expect(mine[0]).not.toHaveProperty("afterJson");

    const p1 = await getActivity(range, 1, 1, {});
    expect(p1.rows).toHaveLength(1);
    expect(p1.total).toBeGreaterThanOrEqual(4);
  });

  it("ignores an unknown action filter value instead of erroring", async () => {
    const data = await getActivity(resolveRange("all", ASOF), 1, 5, { action: "NOT_A_REAL_ACTION" });
    expect(data.total).toBeGreaterThanOrEqual(4);
  });
});

describe("getOverview", () => {
  it("buckets the daily series by Ulaanbaatar calendar day", async () => {
    const data = await getOverview(resolveRange("7d", ASOF), ASOF);
    // Request 7 was created 2026-11-02T17:30Z => 01:30 on Nov 3 in UB.
    expect(data.daily.find((d) => d.day === "2026-11-03")?.count).toBeGreaterThanOrEqual(1);
    expect(data.requests.total).toBe(Object.values(data.byStatus).reduce((a, b) => a + b, 0));
    expect(data.users.active).toBeGreaterThanOrEqual(3);
    expect(data.users.acted24h).toBeGreaterThanOrEqual(1);
  });
});

describe("schema support", () => {
  it("has the monitoring indexes", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('AuditLog', 'ApprovalAction')`;
    const names = rows.map((r) => r.indexname);
    for (const n of [
      "AuditLog_createdAt_idx",
      "AuditLog_action_createdAt_idx",
      "AuditLog_entityType_entityId_createdAt_idx",
      "ApprovalAction_createdAt_idx",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("de-duplicates repeated access-denied entries per actor", async () => {
    const req = new Request("http://localhost/api/admin/monitoring/overview");
    await logMonitoringDenied(req, ids.empA, "EMPLOYEE");
    await logMonitoringDenied(req, ids.empA, "EMPLOYEE");
    const n = await prisma.auditLog.count({ where: { actorId: ids.empA, action: "MONITORING_ACCESS_DENIED" } });
    expect(n).toBe(1);
  });
});
