import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { ProcurementKind, ProcurementManagers } from "./procurement";

// What is still actionable in Stage 7, as one set-based SQL definition shared by
// the sidebar badge, the dashboard's "my work" filter and the admin handover, so
// the three can never disagree about what "unfinished" means:
//   an item is unfinished when its shortfall (latest warehouse check's missing
//   quantity, whole item if never checked) is > 0 and the sum of its non-voided
//   purchases is below it -- and its request is still PENDING_PROCUREMENT.

type Db = Prisma.TransactionClient | typeof prisma;

export interface UnfinishedItem {
  itemId: string;
  requestId: string;
  requestNumber: string;
  kind: ProcurementKind;
  assignedManagerId: string;
  assignedManagerName: string;
  materialName: string;
  unit: string;
  required: number;
  purchased: number;
  remaining: number;
}

// shortfall and active purchased quantity of item `i`
const FACTS = Prisma.sql`
  SELECT COALESCE((SELECT wci."missingQuantity" FROM "WarehouseCheckItem" wci JOIN "WarehouseCheck" wc ON wc.id = wci."warehouseCheckId"
                   WHERE wci."requestItemId" = i.id ORDER BY wc."checkedAt" DESC LIMIT 1), i."requestedQuantity") AS required,
         COALESCE((SELECT SUM(p.quantity) FROM "ProcurementPurchase" p WHERE p."requestItemId" = i.id AND p."voidedAt" IS NULL), 0) AS purchased`;

const HAS_STEP = Prisma.sql`EXISTS (SELECT 1 FROM "ApprovalStep" s WHERE s."requestId" = r.id AND s.type = 'MANAGER_PROCUREMENT')`;

export interface UnfinishedFilter {
  kind?: ProcurementKind;
  /** only items assigned to this manager */
  managerId?: string;
  /** only items assigned to anybody else (what a handover to this manager would move) */
  notManagerId?: string;
  requestIds?: string[];
}

/** Assigned, still-unfinished items of requests waiting in procurement. */
export async function unfinishedAssignedItems(db: Db, filter: UnfinishedFilter = {}): Promise<UnfinishedItem[]> {
  const conds: Prisma.Sql[] = [];
  if (filter.kind) conds.push(Prisma.sql`a.kind = ${filter.kind}::"ProcurementKind"`);
  if (filter.managerId) conds.push(Prisma.sql`a."assignedManagerId" = ${filter.managerId}`);
  if (filter.notManagerId) conds.push(Prisma.sql`a."assignedManagerId" <> ${filter.notManagerId}`);
  if (filter.requestIds) conds.push(Prisma.sql`i."requestId" = ANY(${filter.requestIds}::text[])`);
  const extra = conds.length ? Prisma.sql`AND ${Prisma.join(conds, " AND ")}` : Prisma.empty;
  const rows = await db.$queryRaw<
    { itemId: string; requestId: string; requestNumber: string; kind: ProcurementKind; assignedManagerId: string; assignedManagerName: string; materialName: string; unit: string; required: Prisma.Decimal; purchased: Prisma.Decimal }[]
  >`
    SELECT i.id AS "itemId", i."requestId" AS "requestId", r."requestNumber" AS "requestNumber", a.kind::text AS kind,
           a."assignedManagerId" AS "assignedManagerId", u.name AS "assignedManagerName",
           COALESCE(i."manualMaterialName", m.name, '—') AS "materialName", i.unit AS unit, f.required AS required, f.purchased AS purchased
    FROM "MaterialRequestItem" i
    JOIN "MaterialRequest" r ON r.id = i."requestId" AND r.status = 'PENDING_PROCUREMENT'
    JOIN "ProcurementItemAssignment" a ON a."requestItemId" = i.id
    JOIN "User" u ON u.id = a."assignedManagerId"
    LEFT JOIN "Material" m ON m.id = i."materialId"
    CROSS JOIN LATERAL (${FACTS}) f
    WHERE f.required > 0 AND f.purchased < f.required ${extra}
    ORDER BY r."requestNumber", i."lineNo"`;
  return rows.map((r) => ({
    ...r,
    required: Number(r.required),
    purchased: Number(r.purchased),
    remaining: Number(r.required) - Number(r.purchased),
  }));
}

/** Requests still waiting for the International manager to classify (some item needs buying, no classification yet). */
export async function pendingClassificationRequestIds(db: Db = prisma): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT r.id FROM "MaterialRequest" r
    WHERE r.status = 'PENDING_PROCUREMENT' AND ${HAS_STEP}
      AND NOT EXISTS (SELECT 1 FROM "ProcurementClassification" c WHERE c."requestId" = r.id)
      AND EXISTS (SELECT 1 FROM "MaterialRequestItem" i CROSS JOIN LATERAL (${FACTS}) f WHERE i."requestId" = r.id AND f.required > 0)`;
  return rows.map((r) => r.id);
}

// Position changes / handovers take the position lock exclusively; classification and
// reassignment (the operations that hand items to "the current holder") take both
// shared, so a holder can never change between their reading it and writing an
// assignment, and no assignment can slip past a handover that is enumerating work.
// Order everywhere: advisory lock(s) -> request row lock(s) in id order. Purchases
// only ever take their own request row, so no cycle is possible.
export const PROCUREMENT_POSITIONS = ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] as const;
export type ProcurementPosition = (typeof PROCUREMENT_POSITIONS)[number];

export async function lockPositionExclusive(tx: Prisma.TransactionClient, role: ProcurementPosition): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`procurement-position:${role}`}))`;
}
export async function lockPositionsShared(tx: Prisma.TransactionClient): Promise<void> {
  for (const role of PROCUREMENT_POSITIONS) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`procurement-position:${role}`}))`;
}

export interface WorkloadViewer {
  id: string;
  role: string;
}

/**
 * Distinct requests holding work the viewer can act on right now:
 *  - assigned managers: a request with at least one unfinished item assigned to them;
 *    the International manager additionally: requests awaiting classification;
 *  - LEGACY mode (no managers configured): any request with an unfinished item, for any MANAGER;
 *  - ADMIN: every request in the procurement stage (oversight, same as before the assignment feature).
 * Each request is counted once however many items it has. Roles without a procurement view get none.
 */
export async function actionableRequestIds(viewer: WorkloadViewer, managers: ProcurementManagers, db: Db = prisma): Promise<string[]> {
  if (viewer.role === "ADMIN") {
    const rows = await db.$queryRaw<{ id: string }[]>`SELECT r.id FROM "MaterialRequest" r WHERE r.status = 'PENDING_PROCUREMENT' AND ${HAS_STEP}`;
    return rows.map((r) => r.id);
  }
  if (viewer.role !== "MANAGER") return [];

  const branches: Prisma.Sql[] = [];
  if (managers.mode === "LEGACY") {
    branches.push(Prisma.sql`f.purchased < f.required`);
  } else {
    branches.push(Prisma.sql`(a."assignedManagerId" = ${viewer.id} AND f.purchased < f.required)`);
    if (managers.international?.id === viewer.id) {
      branches.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "ProcurementClassification" c WHERE c."requestId" = r.id)`);
    }
  }
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT r.id
    FROM "MaterialRequest" r
    JOIN "MaterialRequestItem" i ON i."requestId" = r.id
    LEFT JOIN "ProcurementItemAssignment" a ON a."requestItemId" = i.id
    CROSS JOIN LATERAL (${FACTS}) f
    WHERE r.status = 'PENDING_PROCUREMENT' AND ${HAS_STEP} AND f.required > 0 AND (${Prisma.join(branches, " OR ")})`;
  return rows.map((r) => r.id);
}

export async function procurementBadgeCount(viewer: WorkloadViewer, managers: ProcurementManagers): Promise<number> {
  return (await actionableRequestIds(viewer, managers)).length;
}
