import { AuditAction, Prisma, type RequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { STEP_ORDER } from "@/lib/serialize";
import { createdAtFilter, MONITORING_TZ, type Range } from "./time";
import type {
  ActivityRow,
  AssigneeBottleneck,
  DailyCount,
  DepartmentRow,
  EmployeeRow,
  OverviewData,
  Paged,
  PendingData,
  PendingRow,
  ReturnedRow,
  StageBottleneck,
} from "./types";

// Every function takes `asOf` (the "now" it measures against) instead of
// reading the clock itself. Today callers pass `new Date()`; the planned Time
// Machine section passes a historical instant so the same code can be replayed
// -- and tests can pin the clock. (Reconstructing the *status* a request had at
// a past instant needs a status-history table that does not exist yet; see
// app/(app)/admin/monitoring/time-machine/page.tsx.)

export const PENDING_STATUSES: RequestStatus[] = [
  "PENDING_DEPARTMENT_APPROVAL",
  "PENDING_WAREHOUSE_CHECK",
  "PENDING_BRANCH_APPROVAL",
  "PENDING_FINANCE_APPROVAL",
  "PENDING_EXECUTIVE_APPROVAL",
  "PENDING_PROCUREMENT",
  "PENDING_ACCOUNTING",
];
export const RETURNED_STATUSES: RequestStatus[] = [
  "RETURNED_BY_DEPARTMENT",
  "RETURNED_BY_BRANCH_APPROVER",
  "RETURNED_BY_FINANCE",
  "RETURNED_BY_EXECUTIVE",
];
// Same definition the dashboard's selectKpis() uses for "completed".
export const COMPLETED_STATUSES: RequestStatus[] = ["COMPLETED", "ACCOUNTING_COMPLETED"];

// Audit actions that move a request into a new status (see lib/workflow.ts and
// app/api/requests/route.ts) -- the latest of these is "pending since".
const TRANSITION_ACTIONS = ["SUBMIT", "APPROVE", "RETURN", "REJECT", "RESUBMIT", "RESERVE_STOCK", "ACCOUNTING_RECORD", "PROCUREMENT_COMPLETE"];

// "Current step" of a request = its first PENDING step in the workflow's effective order (by type,
// see STEP_ORDER), not by stored sequence: legacy requests have the procurement step stored after
// the accounting step. Built from a constant list, so Prisma.raw is safe.
const STEP_RANK = Prisma.raw(`CASE s.type::text ${STEP_ORDER.map((t, i) => `WHEN '${t}' THEN ${i}`).join(" ")} ELSE ${STEP_ORDER.length} END`);

/** Upper bound on pending rows loaded for the aggregates (bottlenecks). */
export const PENDING_AGGREGATE_CAP = 5000;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export function parsePaging(params: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
  const requested = Math.floor(Number(params.get("pageSize"))) || DEFAULT_PAGE_SIZE;
  return { page, pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, requested)) };
}

function paged<T>(all: T[], page: number, pageSize: number): Paged<T> {
  return { rows: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
}

const bucket = (statuses: RequestStatus[], byStatus: Record<string, number>) =>
  statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);

async function statusCounts(range: Range) {
  const groups = await prisma.materialRequest.groupBy({
    by: ["status"],
    where: { createdAt: createdAtFilter(range) },
    _count: { _all: true },
  });
  const byStatus: Record<string, number> = {};
  for (const g of groups) byStatus[g.status] = g._count._all;
  return byStatus;
}

async function dailyCounts(range: Range): Promise<DailyCount[]> {
  // timestamp(3) columns hold UTC: tag as UTC, then convert to Ulaanbaatar wall
  // time before truncating to a day.
  const lower = range.from ? Prisma.sql`AND "createdAt" >= ${range.from}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ day: string; count: bigint }[]>`
    SELECT to_char(date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${MONITORING_TZ}), 'YYYY-MM-DD') AS day,
           COUNT(*) AS count
    FROM "MaterialRequest"
    WHERE "createdAt" < ${range.to} ${lower}
    GROUP BY 1
    ORDER BY 1`;
  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

export async function getOverview(range: Range, asOf: Date): Promise<OverviewData> {
  const dayAgo = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);
  const [activeUsers, totalUsers, loggedIn24h, actors24h, departments, byStatus, daily] = await Promise.all([
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true, lastLoginAt: { gte: dayAgo, lte: asOf } } }),
    prisma.auditLog.groupBy({ by: ["actorId"], where: { createdAt: { gte: dayAgo, lte: asOf } } }),
    prisma.department.count(),
    statusCounts(range),
    dailyCounts(range),
  ]);

  return {
    asOf: asOf.toISOString(),
    range: range.key,
    users: { active: activeUsers, total: totalUsers, loggedIn24h, acted24h: actors24h.length },
    departments,
    requests: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      pending: bucket(PENDING_STATUSES, byStatus),
      returned: bucket(RETURNED_STATUSES, byStatus),
      completed: bucket(COMPLETED_STATUSES, byStatus),
      cancelled: byStatus.CANCELLED ?? 0,
    },
    byStatus,
    daily,
  };
}

interface CountRow {
  pending: number;
  returned: number;
  completed: number;
  total: number;
}
const emptyCounts = (): CountRow => ({ pending: 0, returned: 0, completed: 0, total: 0 });
function addStatus(row: CountRow, status: RequestStatus, n: number) {
  row.total += n;
  if (PENDING_STATUSES.includes(status)) row.pending += n;
  else if (RETURNED_STATUSES.includes(status)) row.returned += n;
  else if (COMPLETED_STATUSES.includes(status)) row.completed += n;
}

export async function getDepartments(range: Range, page: number, pageSize: number): Promise<Paged<DepartmentRow>> {
  const [departments, groups, members] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true, type: true } }),
    prisma.materialRequest.groupBy({
      by: ["departmentId", "status"],
      where: { createdAt: createdAtFilter(range) },
      _count: { _all: true },
    }),
    prisma.user.groupBy({ by: ["departmentId"], where: { isActive: true }, _count: { _all: true } }),
  ]);

  const counts = new Map<string, CountRow>();
  for (const g of groups) {
    const row = counts.get(g.departmentId) ?? emptyCounts();
    addStatus(row, g.status, g._count._all);
    counts.set(g.departmentId, row);
  }
  const memberCount = new Map(members.map((m) => [m.departmentId, m._count._all]));

  const rows: DepartmentRow[] = departments
    .map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      activeMembers: memberCount.get(d.id) ?? 0,
      ...(counts.get(d.id) ?? emptyCounts()),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "mn"));
  return paged(rows, page, pageSize);
}

export async function getEmployees(range: Range, page: number, pageSize: number): Promise<Paged<EmployeeRow>> {
  const groups = await prisma.materialRequest.groupBy({
    by: ["requestedById", "status"],
    where: { createdAt: createdAtFilter(range) },
    _count: { _all: true },
  });
  const counts = new Map<string, CountRow>();
  for (const g of groups) {
    const row = counts.get(g.requestedById) ?? emptyCounts();
    addStatus(row, g.status, g._count._all);
    counts.set(g.requestedById, row);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...counts.keys()] } },
    select: { id: true, name: true, role: true, isActive: true, department: { select: { name: true } } },
  });
  const rows: EmployeeRow[] = users
    .map((u) => ({
      id: u.id,
      name: u.name,
      department: u.department?.name ?? null,
      role: u.role,
      isActive: u.isActive,
      ...counts.get(u.id)!,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "mn"));
  return paged(rows, page, pageSize);
}

interface RawPending {
  id: string;
  requestNumber: string;
  status: string;
  department: string;
  requestedBy: string;
  assigneeId: string | null;
  assignee: string | null;
  since: Date;
}

type PendingWithAssignee = PendingRow & { assigneeId: string | null };

// One pass over the (small, status-indexed) set of open requests; the
// per-request "last transition" is a lateral lookup on AuditLog's
// (entityType, entityId, createdAt) index.
async function loadPending(asOf: Date): Promise<{ rows: PendingWithAssignee[]; truncated: boolean }> {
  const raw = await prisma.$queryRaw<RawPending[]>`
    SELECT r.id,
           r."requestNumber",
           r.status::text AS status,
           d.name AS department,
           u.name AS "requestedBy",
           st."assignedUserId" AS "assigneeId",
           au.name AS assignee,
           COALESCE(t.at, r."submittedAt", r."createdAt") AS since
    FROM "MaterialRequest" r
    JOIN "Department" d ON d.id = r."departmentId"
    JOIN "User" u ON u.id = r."requestedById"
    LEFT JOIN LATERAL (
      SELECT MAX(a."createdAt") AS at
      FROM "AuditLog" a
      WHERE a."entityType" = 'MaterialRequest'
        AND a."entityId" = r.id
        AND a.action::text = ANY(${TRANSITION_ACTIONS})
        AND a."createdAt" <= ${asOf}
    ) t ON TRUE
    LEFT JOIN LATERAL (
      SELECT s."assignedUserId"
      FROM "ApprovalStep" s
      WHERE s."requestId" = r.id AND s.status = 'PENDING'
      ORDER BY ${STEP_RANK}, s.sequence
      LIMIT 1
    ) st ON TRUE
    LEFT JOIN "User" au ON au.id = st."assignedUserId"
    WHERE r.status::text = ANY(${PENDING_STATUSES as string[]})
    ORDER BY since ASC
    LIMIT ${PENDING_AGGREGATE_CAP + 1}`;

  const truncated = raw.length > PENDING_AGGREGATE_CAP;
  const rows = raw.slice(0, PENDING_AGGREGATE_CAP).map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    status: r.status,
    department: r.department,
    requestedBy: r.requestedBy,
    assigneeId: r.assigneeId,
    assignee: r.assignee,
    since: r.since.toISOString(),
    // Clamp: a request can never have waited a negative time.
    waitingSeconds: Math.max(0, Math.round((asOf.getTime() - r.since.getTime()) / 1000)),
  }));
  return { rows, truncated };
}

function median(sorted: number[]) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export async function getPending(asOf: Date, page: number, pageSize: number): Promise<PendingData> {
  const { rows, truncated } = await loadPending(asOf);

  const byStage = new Map<string, number[]>();
  const byAssignee = new Map<string, { name: string; userId: string | null; waits: number[] }>();
  for (const r of rows) {
    const stage = byStage.get(r.status) ?? [];
    stage.push(r.waitingSeconds);
    byStage.set(r.status, stage);

    const key = r.assigneeId ?? "unassigned";
    const entry = byAssignee.get(key) ?? { name: r.assignee ?? "Хариуцагчгүй", userId: r.assigneeId, waits: [] };
    entry.waits.push(r.waitingSeconds);
    byAssignee.set(key, entry);
  }

  // Bottleneck ranking: where the most waiting time is piling up.
  const stages: StageBottleneck[] = [...byStage.entries()]
    .map(([status, waits]) => {
      const sorted = [...waits].sort((a, b) => a - b);
      return {
        status,
        count: waits.length,
        avgSeconds: Math.round(sum(waits) / waits.length),
        medianSeconds: median(sorted),
        maxSeconds: sorted[sorted.length - 1],
        totalSeconds: sum(waits),
      };
    })
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  const assignees: AssigneeBottleneck[] = [...byAssignee.values()]
    .map((e) => ({
      userId: e.userId,
      name: e.name,
      count: e.waits.length,
      avgSeconds: Math.round(sum(e.waits) / e.waits.length),
      maxSeconds: Math.max(...e.waits),
      total: sum(e.waits),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((e) => ({ userId: e.userId, name: e.name, count: e.count, avgSeconds: e.avgSeconds, maxSeconds: e.maxSeconds }));

  // Longest-waiting first.
  const ordered: PendingRow[] = rows
    .map((r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      status: r.status,
      department: r.department,
      requestedBy: r.requestedBy,
      assignee: r.assignee,
      since: r.since,
      waitingSeconds: r.waitingSeconds,
    }))
    .sort((a, b) => b.waitingSeconds - a.waitingSeconds);
  return { asOf: asOf.toISOString(), stages, assignees, list: paged(ordered, page, pageSize), truncated };
}

export async function getReturned(range: Range, page: number, pageSize: number): Promise<Paged<ReturnedRow>> {
  const where: Prisma.MaterialRequestWhereInput = { status: { in: RETURNED_STATUSES }, createdAt: createdAtFilter(range) };
  const [total, requests] = await Promise.all([
    prisma.materialRequest.count({ where }),
    prisma.materialRequest.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        requestNumber: true,
        status: true,
        department: { select: { name: true } },
        requestedBy: { select: { name: true } },
      },
    }),
  ]);

  // Latest RETURN decision per request on this page.
  const actions = await prisma.approvalAction.findMany({
    where: { action: "RETURN", approvalStep: { requestId: { in: requests.map((r) => r.id) } } },
    orderBy: { createdAt: "desc" },
    select: { reason: true, createdAt: true, actor: { select: { name: true } }, approvalStep: { select: { requestId: true } } },
  });
  const latest = new Map<string, (typeof actions)[number]>();
  for (const a of actions) if (!latest.has(a.approvalStep.requestId)) latest.set(a.approvalStep.requestId, a);

  return {
    total,
    page,
    pageSize,
    rows: requests.map((r) => {
      const a = latest.get(r.id);
      return {
        id: r.id,
        requestNumber: r.requestNumber,
        status: r.status,
        department: r.department.name,
        requestedBy: r.requestedBy.name,
        returnedBy: a?.actor.name ?? null,
        reason: a?.reason ?? null,
        returnedAt: a?.createdAt.toISOString() ?? null,
      };
    }),
  };
}

export const AUDIT_ACTIONS = Object.values(AuditAction) as string[];

export async function getActivity(
  range: Range,
  page: number,
  pageSize: number,
  filters: { action?: string | null; entityType?: string | null }
): Promise<Paged<ActivityRow>> {
  const where: Prisma.AuditLogWhereInput = {
    createdAt: createdAtFilter(range),
    ...(filters.action && AUDIT_ACTIONS.includes(filters.action) ? { action: filters.action as AuditAction } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
  };
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      // before/after JSON deliberately not selected: the feed shows who did
      // what and when, not the payload.
      select: {
        id: true,
        action: true,
        actorId: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    }),
  ]);

  const requestIds = [...new Set(logs.filter((l) => l.entityType === "MaterialRequest").map((l) => l.entityId))];
  const requests = requestIds.length
    ? await prisma.materialRequest.findMany({ where: { id: { in: requestIds } }, select: { id: true, requestNumber: true } })
    : [];
  const numberById = new Map(requests.map((r) => [r.id, r.requestNumber]));

  return {
    total,
    page,
    pageSize,
    rows: logs.map((l) => ({
      id: l.id,
      action: l.action,
      actorId: l.actorId,
      actorName: l.actor.name,
      entityType: l.entityType,
      entityId: l.entityId,
      entityLabel:
        l.entityType === "MaterialRequest" && numberById.has(l.entityId) ? `№${numberById.get(l.entityId)}` : null,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}
