import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getProcurementManagers } from "@/lib/procurement";
import {
  computeCompletion,
  deriveStage,
  itemStatus,
  remainingOf,
  secondsBetween,
  sumByUnit,
  type ProcurementStage,
} from "./procurement-calc";
import type {
  HandoverEvent,
  ManagerLoad,
  MonitoredItem,
  MonitoredPurchase,
  ProcurementDetail,
  ProcurementFilter,
  ProcurementList,
  ProcurementOverview,
  ProcurementRow,
  ProcurementScope,
  TimelineEvent,
  TrackKind,
  TrackSummary,
} from "./procurement-types";
import type { Range } from "./time";

// Read-only, set-based SQL over the existing procurement tables. Nothing here
// writes, and nothing needs a schema change: the aggregation runs in PostgreSQL
// (one pass over the items of the requests under inspection), pages are cut in
// SQL, and the per-row detail is loaded for the page's request ids in ONE extra
// query (no N+1). Like the rest of lib/monitoring, every function takes `asOf`.

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// --- SQL building blocks ------------------------------------------------------

const LATEST_CHECK = (col: string) =>
  Prisma.raw(`(SELECT wci."${col}" FROM "WarehouseCheckItem" wci JOIN "WarehouseCheck" wc ON wc.id = wci."warehouseCheckId"
               WHERE wci."requestItemId" = i.id ORDER BY wc."checkedAt" DESC LIMIT 1)`);

/** One row per item of the requests selected by `cond` (a predicate over alias `r`). */
function facts(cond: Prisma.Sql) {
  return Prisma.sql`
    SELECT i.id AS item_id, i."requestId" AS request_id, i."lineNo" AS line_no,
           COALESCE(i."manualMaterialName", m.name, '—') AS name, i.unit AS unit,
           i."requestedQuantity" AS requested, i."unitPrice" AS est_unit_price,
           wc.required AS required, wc.issued AS issued,
           COALESCE(pp.purchased, 0) AS purchased, COALESCE(pp.cost, 0) AS cost,
           COALESCE(pp.active_purchases, 0) AS active_purchases, pp.last_purchase_at AS last_purchase_at,
           a.kind::text AS kind, a."assignedManagerId" AS manager_id, au.name AS manager_name, a."assignedAt" AS assigned_at
    FROM "MaterialRequestItem" i
    JOIN "MaterialRequest" r ON r.id = i."requestId" AND (${cond})
    LEFT JOIN "Material" m ON m.id = i."materialId"
    LEFT JOIN "ProcurementItemAssignment" a ON a."requestItemId" = i.id
    LEFT JOIN "User" au ON au.id = a."assignedManagerId"
    CROSS JOIN LATERAL (
      SELECT COALESCE(${LATEST_CHECK("missingQuantity")}, i."requestedQuantity") AS required,
             COALESCE(${LATEST_CHECK("allocatedQuantity")}, 0) AS issued
    ) wc
    LEFT JOIN LATERAL (
      SELECT SUM(p.quantity) FILTER (WHERE p."voidedAt" IS NULL) AS purchased,
             SUM(p.quantity * p."unitPrice") FILTER (WHERE p."voidedAt" IS NULL) AS cost,
             COUNT(*) FILTER (WHERE p."voidedAt" IS NULL) AS active_purchases,
             MAX(GREATEST(p."purchasedAt", COALESCE(p."voidedAt", p."purchasedAt"))) AS last_purchase_at
      FROM "ProcurementPurchase" p WHERE p."requestItemId" = i.id
    ) pp ON true`;
}

/** One row per request (aggregated from `f`), for the requests selected by `cond`. */
function requests(cond: Prisma.Sql) {
  return Prisma.sql`
    SELECT r.id AS request_id, r."requestNumber" AS request_number, r.status::text AS status,
           d.name AS department, ru.name AS requested_by, r."createdAt" AS created_at,
           ceo."decidedAt" AS entered_at, c."confirmedAt" AS classified_at,
           ms."decidedAt" AS completed_at, COALESCE(ms.status = 'APPROVED', false) AS approved,
           COUNT(f.item_id) FILTER (WHERE f.required > 0) AS required_items,
           COUNT(f.item_id) FILTER (WHERE f.required > 0 AND f.purchased >= f.required) AS complete_items,
           COUNT(f.item_id) FILTER (WHERE f.required > 0 AND f.purchased > 0 AND f.purchased < f.required) AS partial_items,
           COUNT(f.item_id) FILTER (WHERE f.required > 0 AND f.purchased < f.required AND f.kind = 'DOMESTIC') AS dom_open,
           COUNT(f.item_id) FILTER (WHERE f.required > 0 AND f.purchased < f.required AND f.kind = 'INTERNATIONAL') AS intl_open,
           COUNT(f.item_id) FILTER (WHERE f.required > 0 AND f.purchased < f.required AND f.kind IS NULL) AS unassigned_open,
           COUNT(f.item_id) FILTER (WHERE f.required <= 0) AS warehouse_items,
           COALESCE(SUM(f.cost), 0) AS cost,
           GREATEST(ceo."decidedAt", c."confirmedAt", MAX(f.last_purchase_at), MAX(f.assigned_at)) AS last_activity
    FROM "MaterialRequest" r
    JOIN "Department" d ON d.id = r."departmentId"
    JOIN "User" ru ON ru.id = r."requestedById"
    LEFT JOIN f ON f.request_id = r.id
    LEFT JOIN LATERAL (SELECT s."decidedAt" FROM "ApprovalStep" s WHERE s."requestId" = r.id AND s.type = 'EXECUTIVE_APPROVAL' AND s.status = 'APPROVED' ORDER BY s."decidedAt" DESC LIMIT 1) ceo ON true
    LEFT JOIN LATERAL (SELECT s."decidedAt", s.status FROM "ApprovalStep" s WHERE s."requestId" = r.id AND s.type = 'MANAGER_PROCUREMENT' LIMIT 1) ms ON true
    LEFT JOIN "ProcurementClassification" c ON c."requestId" = r.id
    WHERE ${cond}
    GROUP BY r.id, d.name, ru.name, ceo."decidedAt", c."confirmedAt", ms."decidedAt", ms.status`;
}

const ACTIVE = Prisma.sql`r.status = 'PENDING_PROCUREMENT' AND EXISTS (SELECT 1 FROM "ApprovalStep" s0 WHERE s0."requestId" = r.id AND s0.type = 'MANAGER_PROCUREMENT')`;
const ids = (requestIds: string[]) => Prisma.sql`r.id = ANY(${requestIds}::text[])`;

interface RqRow {
  request_id: string;
  request_number: string;
  status: string;
  department: string;
  requested_by: string;
  created_at: Date;
  entered_at: Date | null;
  classified_at: Date | null;
  completed_at: Date | null;
  approved: boolean;
  required_items: bigint;
  complete_items: bigint;
  partial_items: bigint;
  dom_open: bigint;
  intl_open: bigint;
  unassigned_open: bigint;
  warehouse_items: bigint;
  cost: Prisma.Decimal;
  last_activity: Date | null;
}

interface FactRow {
  item_id: string;
  request_id: string;
  line_no: number;
  name: string;
  unit: string;
  requested: Prisma.Decimal;
  est_unit_price: Prisma.Decimal | null;
  required: Prisma.Decimal;
  issued: Prisma.Decimal;
  purchased: Prisma.Decimal;
  cost: Prisma.Decimal;
  active_purchases: bigint;
  last_purchase_at: Date | null;
  kind: TrackKind | null;
  manager_id: string | null;
  manager_name: string | null;
  assigned_at: Date | null;
}

function toItem(f: FactRow): MonitoredItem {
  const required = num(f.required);
  const purchased = num(f.purchased);
  const lastActivity = [f.last_purchase_at, f.assigned_at].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    itemId: f.item_id,
    lineNo: f.line_no,
    materialName: f.name,
    unit: f.unit,
    requested: num(f.requested),
    warehouseIssued: num(f.issued),
    required,
    purchased,
    outstanding: remainingOf(required, purchased),
    status: itemStatus(required, purchased),
    kind: f.kind,
    managerId: f.manager_id,
    managerName: f.manager_name,
    assignedAt: iso(f.assigned_at),
    activePurchases: num(f.active_purchases),
    actualCost: num(f.cost),
    estimatedUnitPrice: f.est_unit_price === null ? null : num(f.est_unit_price),
    lastActivityAt: iso(lastActivity),
  };
}

async function loadItems(requestIds: string[]): Promise<Map<string, MonitoredItem[]>> {
  const map = new Map<string, MonitoredItem[]>();
  if (requestIds.length === 0) return map;
  const rows = await prisma.$queryRaw<FactRow[]>`SELECT * FROM (${facts(ids(requestIds))}) f ORDER BY f.request_id, f.line_no`;
  for (const f of rows) {
    const list = map.get(f.request_id) ?? [];
    list.push(toItem(f));
    map.set(f.request_id, list);
  }
  return map;
}

function track(items: MonitoredItem[], kind: TrackKind): TrackSummary | null {
  const mine = items.filter((i) => i.kind === kind && i.required > 0);
  if (mine.length === 0) return null;
  return {
    kind,
    totalItems: mine.length,
    outstandingItems: mine.filter((i) => i.status !== "COMPLETE").length,
    managers: [...new Set(mine.map((i) => i.managerName).filter((n): n is string => !!n))],
    actualCost: mine.reduce((s, i) => s + i.actualCost, 0),
  };
}

const IN_PROGRESS_STAGES: ProcurementStage[] = ["AWAITING_CLASSIFICATION", "IN_PROCUREMENT", "READY_TO_COMPLETE"];

function buildRow(r: RqRow, items: MonitoredItem[], opts: { asOf: Date; thresholdHours: number; assignedMode: boolean }): ProcurementRow {
  const requiredItems = num(r.required_items);
  const completeItems = num(r.complete_items);
  const stage = deriveStage({
    requestStatus: r.status,
    procurementApproved: r.approved,
    assignedMode: opts.assignedMode,
    classified: !!r.classified_at,
    requiredItems,
    completeItems,
  });
  const active = IN_PROGRESS_STAGES.includes(stage);
  const completion = computeCompletion(items.map((i) => ({ required: i.required, purchased: i.purchased, estimatedUnitPrice: i.estimatedUnitPrice })));
  const idle = active ? secondsBetween(r.last_activity, opts.asOf) : null;
  return {
    requestId: r.request_id,
    requestNumber: r.request_number,
    requestStatus: r.status,
    department: r.department,
    requestedBy: r.requested_by,
    stage,
    enteredAt: iso(r.entered_at),
    classifiedAt: iso(r.classified_at),
    completedAt: r.approved ? iso(r.completed_at) : null,
    ageSeconds: active ? secondsBetween(r.entered_at, opts.asOf) : secondsBetween(r.entered_at, r.completed_at),
    idleSeconds: idle,
    classificationWaitSeconds: r.classified_at
      ? secondsBetween(r.entered_at, r.classified_at)
      : stage === "AWAITING_CLASSIFICATION"
        ? secondsBetween(r.entered_at, opts.asOf)
        : null,
    lastActivityAt: iso(r.last_activity),
    requiredItems,
    completeItems,
    partialItems: num(r.partial_items),
    partiallyPurchased: num(r.partial_items) > 0 || (active && items.some((i) => i.required > 0 && i.purchased > 0 && i.status !== "COMPLETE")),
    completionPercent: completion.percent,
    completionBasis: completion.basis,
    domestic: track(items, "DOMESTIC"),
    international: track(items, "INTERNATIONAL"),
    unassignedOutstandingItems: num(r.unassigned_open),
    actualCost: num(r.cost),
    delayed: active && idle !== null && idle >= opts.thresholdHours * 3600,
    items,
  };
}

// --- overview (KPIs) ----------------------------------------------------------

export async function getProcurementOverview(range: Range, asOf: Date, thresholdHours: number): Promise<ProcurementOverview> {
  const managers = await getProcurementManagers();
  const assignedMode = managers.mode === "ASSIGNED";
  const cutoff = new Date(asOf.getTime() - thresholdHours * 3600_000);
  const stepRange = range.from ? { gte: range.from, lt: range.to } : { lt: range.to };
  const purchasedRange = range.from ? Prisma.sql`p."purchasedAt" >= ${range.from} AND p."purchasedAt" < ${range.to}` : Prisma.sql`p."purchasedAt" < ${range.to}`;
  const confirmedRange = range.from ? Prisma.sql`c."confirmedAt" >= ${range.from} AND c."confirmedAt" < ${range.to}` : Prisma.sql`c."confirmedAt" < ${range.to}`;
  const waitingCond = Prisma.sql`${assignedMode}::boolean AND classified_at IS NULL AND required_items > 0`;

  const [kpi, oldestRows, quantityRows, managerRows, completedInRange, awaitingAccounting, costRows, classifiedRows] = await Promise.all([
    prisma.$queryRaw<
      {
        awaiting: bigint; classification: bigint; ready: bigint; idle_over: bigint; missing: bigint;
        dom_requests: bigint; dom_items: bigint; intl_requests: bigint; intl_items: bigint;
        partial_requests: bigint; partial_items: bigint; unassigned_items: bigint; warehouse_items: bigint; cost: Prisma.Decimal;
        waiting_avg_epoch: number | null; waiting_oldest: Date | null; idle_oldest: Date | null;
      }[]
    >`
      WITH f AS (${facts(ACTIVE)}), rq AS (${requests(ACTIVE)})
      SELECT COUNT(*) AS awaiting,
             COUNT(*) FILTER (WHERE ${waitingCond}) AS classification,
             COUNT(*) FILTER (WHERE required_items > 0 AND complete_items >= required_items) AS ready,
             COUNT(*) FILTER (WHERE last_activity < ${cutoff}) AS idle_over,
             COUNT(*) FILTER (WHERE entered_at IS NULL) AS missing,
             COUNT(*) FILTER (WHERE dom_open > 0) AS dom_requests, COALESCE(SUM(dom_open), 0) AS dom_items,
             COUNT(*) FILTER (WHERE intl_open > 0) AS intl_requests, COALESCE(SUM(intl_open), 0) AS intl_items,
             COUNT(*) FILTER (WHERE partial_items > 0) AS partial_requests, COALESCE(SUM(partial_items), 0) AS partial_items,
             COALESCE(SUM(unassigned_open), 0) AS unassigned_items, COALESCE(SUM(warehouse_items), 0) AS warehouse_items,
             COALESCE(SUM(cost), 0) AS cost,
             AVG(EXTRACT(EPOCH FROM entered_at)) FILTER (WHERE ${waitingCond} AND entered_at IS NOT NULL) AS waiting_avg_epoch,
             MIN(entered_at) FILTER (WHERE ${waitingCond}) AS waiting_oldest,
             MIN(last_activity) AS idle_oldest
      FROM rq`,
    prisma.$queryRaw<{ request_id: string; request_number: string; entered_at: Date | null; last_activity: Date | null }[]>`
      WITH f AS (${facts(ACTIVE)}), rq AS (${requests(ACTIVE)})
      SELECT request_id, request_number, entered_at, last_activity FROM rq
      WHERE entered_at IS NOT NULL ORDER BY entered_at ASC, request_number ASC LIMIT 1`,
    prisma.$queryRaw<{ kind: TrackKind | null; unit: string; qty: Prisma.Decimal }[]>`
      WITH f AS (${facts(ACTIVE)})
      SELECT kind, unit, SUM(required - purchased) AS qty FROM f WHERE required > 0 AND purchased < required GROUP BY kind, unit`,
    prisma.$queryRaw<
      { manager_id: string; kind: TrackKind; name: string; is_active: boolean; items: bigint; requests: bigint; oldest: Date | null; avg_epoch: number | null }[]
    >`
      WITH f AS (${facts(ACTIVE)})
      SELECT f.manager_id, f.kind, u.name, u."isActive" AS is_active, COUNT(*) AS items, COUNT(DISTINCT f.request_id) AS requests,
             MIN(f.assigned_at) AS oldest, AVG(EXTRACT(EPOCH FROM f.assigned_at)) AS avg_epoch
      FROM f JOIN "User" u ON u.id = f.manager_id
      WHERE f.required > 0 AND f.purchased < f.required AND f.kind IS NOT NULL
      GROUP BY f.manager_id, f.kind, u.name, u."isActive"
      ORDER BY oldest ASC NULLS LAST, u.name ASC`,
    prisma.approvalStep.count({ where: { type: "MANAGER_PROCUREMENT", status: "APPROVED", decidedAt: stepRange } }),
    prisma.materialRequest.count({ where: { status: "PENDING_ACCOUNTING", approvalSteps: { some: { type: "MANAGER_PROCUREMENT", status: "APPROVED" } } } }),
    prisma.$queryRaw<{ cost: Prisma.Decimal | null; purchases: bigint }[]>`
      SELECT SUM(p.quantity * p."unitPrice") AS cost, COUNT(*) AS purchases FROM "ProcurementPurchase" p
      WHERE p."voidedAt" IS NULL AND ${purchasedRange}`,
    prisma.$queryRaw<{ classified: bigint; avg_seconds: number | null }[]>`
      SELECT COUNT(*) AS classified,
             AVG(EXTRACT(EPOCH FROM (c."confirmedAt" - ceo."decidedAt"))) AS avg_seconds
      FROM "ProcurementClassification" c
      LEFT JOIN LATERAL (SELECT s."decidedAt" FROM "ApprovalStep" s WHERE s."requestId" = c."requestId" AND s.type = 'EXECUTIVE_APPROVAL' AND s.status = 'APPROVED' ORDER BY s."decidedAt" DESC LIMIT 1) ceo ON true
      WHERE ${confirmedRange}`,
  ]);

  const k = kpi[0];
  const quantitiesOf = (kind: TrackKind) => sumByUnit(quantityRows.filter((q) => q.kind === kind).map((q) => ({ unit: q.unit, quantity: num(q.qty) })));
  const waitingAvg = k.waiting_avg_epoch === null ? null : Math.max(0, Math.floor(asOf.getTime() / 1000 - Number(k.waiting_avg_epoch)));
  const oldest = oldestRows[0];

  const managerLoads: ManagerLoad[] = managerRows.map((m) => ({
    userId: m.manager_id,
    name: m.name,
    kind: m.kind,
    isActive: m.is_active,
    requests: num(m.requests),
    items: num(m.items),
    oldestAssignedAt: iso(m.oldest),
    oldestSeconds: secondsBetween(m.oldest, asOf),
    avgSeconds: m.avg_epoch === null ? null : Math.max(0, Math.floor(asOf.getTime() / 1000 - Number(m.avg_epoch))),
  }));

  return {
    asOf: asOf.toISOString(),
    range: range.key,
    thresholdHours,
    mode: managers.mode,
    requests: {
      awaitingProcurement: num(k.awaiting),
      awaitingClassification: num(k.classification),
      readyToComplete: num(k.ready),
      completedInRange,
      awaitingAccounting,
      idleOverThreshold: num(k.idle_over),
      missingTimestamps: num(k.missing),
    },
    items: {
      domesticOutstanding: num(k.dom_items),
      internationalOutstanding: num(k.intl_items),
      unassignedOutstanding: num(k.unassigned_items),
      partiallyPurchased: num(k.partial_items),
      warehouseFulfilled: num(k.warehouse_items),
    },
    domestic: { requests: num(k.dom_requests), items: num(k.dom_items), quantities: quantitiesOf("DOMESTIC") },
    international: { requests: num(k.intl_requests), items: num(k.intl_items), quantities: quantitiesOf("INTERNATIONAL") },
    partial: { requests: num(k.partial_requests), items: num(k.partial_items) },
    cost: { openRequests: num(k.cost), inRange: num(costRows[0]?.cost), purchasesInRange: num(costRows[0]?.purchases) },
    timing: {
      classification: {
        waitingRequests: num(k.classification),
        avgWaitingSeconds: waitingAvg,
        maxWaitingSeconds: secondsBetween(k.waiting_oldest, asOf),
        classifiedInRange: num(classifiedRows[0]?.classified),
        avgClassifiedSeconds: classifiedRows[0]?.avg_seconds == null ? null : Math.max(0, Math.floor(Number(classifiedRows[0].avg_seconds))),
      },
      oldest: oldest
        ? {
            requestId: oldest.request_id,
            requestNumber: oldest.request_number,
            enteredAt: iso(oldest.entered_at),
            ageSeconds: secondsBetween(oldest.entered_at, asOf),
            idleSeconds: secondsBetween(oldest.last_activity, asOf),
          }
        : null,
      longestIdleSeconds: secondsBetween(k.idle_oldest, asOf),
    },
    managers: managerLoads,
  };
}

// --- request list (paginated) -------------------------------------------------

export interface ProcurementListOptions {
  scope: ProcurementScope;
  filter: ProcurementFilter;
  q?: string;
  page: number;
  pageSize: number;
  thresholdHours: number;
  range: Range;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function getProcurementList(asOf: Date, opts: ProcurementListOptions): Promise<ProcurementList> {
  const managers = await getProcurementManagers();
  const assignedMode = managers.mode === "ASSIGNED";
  const { page, pageSize } = opts;
  const offset = (page - 1) * pageSize;
  const q = opts.q?.trim();
  const like = q ? `%${likeEscape(q)}%` : null;
  const base = { asOf: asOf.toISOString(), scope: opts.scope, thresholdHours: opts.thresholdHours, mode: managers.mode };

  let rows: RqRow[];
  let total: number;

  if (opts.scope === "active") {
    const cutoff = new Date(asOf.getTime() - opts.thresholdHours * 3600_000);
    const conds: Prisma.Sql[] = [];
    switch (opts.filter) {
      case "classification":
        conds.push(Prisma.sql`${assignedMode}::boolean AND classified_at IS NULL AND required_items > 0`);
        break;
      case "domestic":
        conds.push(Prisma.sql`dom_open > 0`);
        break;
      case "international":
        conds.push(Prisma.sql`intl_open > 0`);
        break;
      case "partial":
        conds.push(Prisma.sql`partial_items > 0`);
        break;
      case "ready":
        conds.push(Prisma.sql`required_items > 0 AND complete_items >= required_items`);
        break;
      case "delayed":
        conds.push(Prisma.sql`last_activity < ${cutoff}`);
        break;
    }
    if (like) {
      conds.push(
        Prisma.sql`(request_number ILIKE ${like} OR department ILIKE ${like} OR EXISTS (SELECT 1 FROM f f2 WHERE f2.request_id = rq.request_id AND f2.name ILIKE ${like}))`
      );
    }
    const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;
    const result = await prisma.$queryRaw<(RqRow & { total: bigint })[]>`
      WITH f AS (${facts(ACTIVE)}), rq AS (${requests(ACTIVE)})
      SELECT rq.*, COUNT(*) OVER () AS total FROM rq ${where}
      ORDER BY entered_at ASC NULLS LAST, request_number ASC
      LIMIT ${pageSize} OFFSET ${offset}`;
    rows = result;
    total = result.length ? num(result[0].total) : page > 1 ? await countActive(where) : 0;
  } else {
    // accounting / completed: cut the page from the approved procurement steps first, aggregate only that page
    const stepCond =
      opts.scope === "accounting"
        ? Prisma.sql`r.status = 'PENDING_ACCOUNTING' AND ms.status = 'APPROVED'`
        : opts.range.from
          ? Prisma.sql`ms.status = 'APPROVED' AND ms."decidedAt" >= ${opts.range.from} AND ms."decidedAt" < ${opts.range.to}`
          : Prisma.sql`ms.status = 'APPROVED' AND ms."decidedAt" < ${opts.range.to}`;
    const search = like
      ? Prisma.sql`AND (r."requestNumber" ILIKE ${like} OR EXISTS (SELECT 1 FROM "Department" d WHERE d.id = r."departmentId" AND d.name ILIKE ${like})
                       OR EXISTS (SELECT 1 FROM "MaterialRequestItem" i LEFT JOIN "Material" m ON m.id = i."materialId"
                                  WHERE i."requestId" = r.id AND COALESCE(i."manualMaterialName", m.name, '') ILIKE ${like}))`
      : Prisma.empty;
    const page1 = await prisma.$queryRaw<{ id: string; total: bigint }[]>`
      SELECT r.id, COUNT(*) OVER () AS total
      FROM "MaterialRequest" r JOIN "ApprovalStep" ms ON ms."requestId" = r.id AND ms.type = 'MANAGER_PROCUREMENT'
      WHERE ${stepCond} ${search}
      ORDER BY ms."decidedAt" DESC NULLS LAST, r."requestNumber" ASC
      LIMIT ${pageSize} OFFSET ${offset}`;
    total = page1.length ? num(page1[0].total) : 0;
    const order = new Map(page1.map((p, i) => [p.id, i]));
    rows = page1.length
      ? (
          await prisma.$queryRaw<RqRow[]>`WITH f AS (${facts(ids(page1.map((p) => p.id)))}) ${requests(ids(page1.map((p) => p.id)))}`
        ).sort((a, b) => (order.get(a.request_id) ?? 0) - (order.get(b.request_id) ?? 0))
      : [];
  }

  const items = await loadItems(rows.map((r) => r.request_id));
  return {
    ...base,
    rows: rows.map((r) => buildRow(r, items.get(r.request_id) ?? [], { asOf, thresholdHours: opts.thresholdHours, assignedMode })),
    total,
    page,
    pageSize,
  };
}

/** Only reached for a page beyond the last one (COUNT(*) OVER() returned no row to read the total from). */
async function countActive(where: Prisma.Sql): Promise<number> {
  const r = await prisma.$queryRaw<{ n: bigint }[]>`WITH f AS (${facts(ACTIVE)}), rq AS (${requests(ACTIVE)}) SELECT COUNT(*) AS n FROM rq ${where}`;
  return num(r[0]?.n);
}

// --- single request detail ----------------------------------------------------

const TIMELINE_LIMIT = 200;

function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const str = (v: unknown) => (typeof v === "string" ? v : null);

function summarise(action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): string | null {
  switch (action) {
    case "PROCUREMENT_PURCHASE":
      return after ? `${num(after.quantity)} × ${num(after.unitPrice)}` : null;
    case "PROCUREMENT_VOID":
      return str(after?.reason);
    case "PROCUREMENT_REASSIGN":
      return str(after?.reason);
    case "PROCUREMENT_CLASSIFY": {
      const intl = Array.isArray(after?.international) ? (after!.international as unknown[]).length : 0;
      const dom = Array.isArray(after?.domestic) ? (after!.domestic as unknown[]).length : 0;
      return `олон улс ${intl}, дотоод ${dom}`;
    }
    default:
      return null;
  }
}

/** Read-only detail of one request that went through the procurement stage; null when it never did. */
export async function getProcurementRequestDetail(requestId: string, asOf: Date, thresholdHours: number): Promise<ProcurementDetail | null> {
  const managers = await getProcurementManagers();
  const assignedMode = managers.mode === "ASSIGNED";
  const rqRows = await prisma.$queryRaw<RqRow[]>`
    WITH f AS (${facts(ids([requestId]))})
    ${requests(Prisma.sql`r.id = ${requestId} AND EXISTS (SELECT 1 FROM "ApprovalStep" s0 WHERE s0."requestId" = r.id AND s0.type = 'MANAGER_PROCUREMENT')`)}`;
  if (rqRows.length === 0) return null;

  const items = (await loadItems([requestId])).get(requestId) ?? [];
  const itemIds = items.map((i) => i.itemId);
  const itemName = new Map(items.map((i) => [i.itemId, i.materialName]));
  const itemKind = new Map(items.map((i) => [i.itemId, i.kind]));

  const [purchases, classification] = await Promise.all([
    prisma.procurementPurchase.findMany({
      where: { requestItemId: { in: itemIds } },
      orderBy: [{ purchasedAt: "asc" }, { id: "asc" }],
      include: { purchasedBy: { select: { name: true } }, voidedBy: { select: { name: true } } },
    }),
    prisma.procurementClassification.findUnique({ where: { requestId }, include: { confirmedBy: { select: { name: true } } } }),
  ]);
  const purchaseIds = purchases.map((p) => p.id);

  // timeline + handover history share one audit read (uses the (entityType, entityId, createdAt) index)
  const audits = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: "MaterialRequest", entityId: requestId, action: { in: ["PROCUREMENT_CLASSIFY", "PROCUREMENT_COMPLETE", "ACCOUNTING_RECORD", "APPROVE"] } },
        { entityType: "ProcurementPurchase", entityId: { in: purchaseIds } },
        { entityType: "ProcurementItemAssignment", entityId: { in: itemIds }, action: "PROCUREMENT_REASSIGN" },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TIMELINE_LIMIT + 1,
    include: { actor: { select: { name: true } } },
  });
  const timelineTruncated = audits.length > TIMELINE_LIMIT;
  const shown = audits.slice(0, TIMELINE_LIMIT);

  const managerIds = new Set<string>();
  for (const a of shown) {
    if (a.entityType === "ProcurementItemAssignment") {
      const b = parse(a.beforeJson);
      const af = parse(a.afterJson);
      for (const id of [str(b?.assignedManagerId), str(af?.assignedManagerId)]) if (id) managerIds.add(id);
    }
  }
  const users = managerIds.size ? await prisma.user.findMany({ where: { id: { in: [...managerIds] } }, select: { id: true, name: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const timeline: TimelineEvent[] = shown
    .slice()
    .reverse()
    .map((a) => ({ id: a.id, at: a.createdAt.toISOString(), action: a.action, actorName: a.actor.name, summary: summarise(a.action, parse(a.beforeJson), parse(a.afterJson)) }));

  const handovers: HandoverEvent[] = shown
    .filter((a) => a.entityType === "ProcurementItemAssignment")
    .reverse()
    .map((a) => {
      const b = parse(a.beforeJson);
      const af = parse(a.afterJson);
      return {
        id: a.id,
        at: a.createdAt.toISOString(),
        itemId: a.entityId,
        materialName: itemName.get(a.entityId) ?? "—",
        kind: itemKind.get(a.entityId) ?? null,
        fromManagerName: userName.get(str(b?.assignedManagerId) ?? "") ?? null,
        toManagerName: userName.get(str(af?.assignedManagerId) ?? "") ?? null,
        actorName: a.actor.name,
        reason: str(af?.reason),
        handoverId: str(af?.handoverId),
      };
    });

  const row = buildRow(rqRows[0], items, { asOf, thresholdHours, assignedMode });
  return {
    asOf: asOf.toISOString(),
    row,
    classification: classification ? { confirmedByName: classification.confirmedBy.name, confirmedAt: classification.confirmedAt.toISOString() } : null,
    purchases: purchases.map<MonitoredPurchase>((p) => ({
      id: p.id,
      itemId: p.requestItemId,
      quantity: Number(p.quantity),
      unitPrice: Number(p.unitPrice),
      total: Number(p.quantity.mul(p.unitPrice)),
      purchasedAt: p.purchasedAt.toISOString(),
      purchasedByName: p.purchasedBy.name,
      voided: !!p.voidedAt,
      voidedAt: iso(p.voidedAt),
      voidedByName: p.voidedBy?.name ?? null,
      voidReason: p.voidReason,
      replacesId: p.replacesId,
      note: p.note,
    })),
    timeline,
    handovers,
    timelineTruncated,
  };
}
