import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { emitBroadcast, emitUserEvent } from "./events";
import type { ProcurementKind } from "./procurement";
import {
  lockPositionExclusive,
  pendingClassificationRequestIds,
  unfinishedAssignedItems,
  type ProcurementPosition,
  type UnfinishedItem,
} from "./procurement-workload";

// Controlled handover of unfinished Stage 7 work between procurement managers.
// Replacing a position holder (ApprovalRoleAssignment) and moving the holder's
// unfinished item assignments are separate things: the plain role change refuses
// to orphan work (HANDOVER_REQUIRED), and this module does both atomically, only
// on an ADMIN's explicit, reviewed confirmation. Purchase rows are never touched:
// ProcurementPurchase keeps its original purchasedBy / prices / dates / voids, and
// the new manager inherits only what is still outstanding (required - purchased).

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const POSITION_KIND: Record<ProcurementPosition, ProcurementKind> = {
  DOMESTIC_PROCUREMENT_MANAGER: "DOMESTIC",
  INTERNATIONAL_PROCUREMENT_MANAGER: "INTERNATIONAL",
};
const OTHER_POSITION: Record<ProcurementPosition, ProcurementPosition> = {
  DOMESTIC_PROCUREMENT_MANAGER: "INTERNATIONAL_PROCUREMENT_MANAGER",
  INTERNATIONAL_PROCUREMENT_MANAGER: "DOMESTIC_PROCUREMENT_MANAGER",
};
export const isProcurementPosition = (role: string): role is ProcurementPosition => role in POSITION_KIND;

export type HandoverFailure = { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): HandoverFailure => ({ ok: false, status, error, code });

/** Only an active MANAGER can hold a procurement position, and nobody holds both. */
export async function validateProcurementManager(db: Db, position: ProcurementPosition, userId: string): Promise<HandoverFailure | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true } });
  if (!user) return fail(404, "Хэрэглэгч олдсонгүй");
  if (!user.isActive) return fail(400, "Идэвхгүй хэрэглэгчийг худалдан авалтын менежерээр томилох боломжгүй");
  if (user.role !== "MANAGER") return fail(400, "Зөвхөн «Менежер» (MANAGER) эрхтэй хэрэглэгчийг томилно");
  const alsoHolds = await db.approvalRoleAssignment.findFirst({ where: { role: OTHER_POSITION[position], isActive: true, userId } });
  if (alsoHolds) return fail(409, "Дотоод болон олон улсын худалдан авалтын хариуцагч нь өөр өөр хүн байх ёстой");
  return null;
}

export interface HandoverPreview {
  position: ProcurementPosition;
  kind: ProcurementKind;
  previousManager: { id: string; name: string; isActive: boolean; isManager: boolean } | null;
  newManager: { id: string; name: string } | null;
  /** problem with the chosen replacement (shown, never applied) */
  newManagerProblem: string | null;
  affectedRequests: number;
  affectedItems: number;
  /** affected items that already have active purchases: only the remaining quantity moves */
  partiallyPurchasedItems: number;
  /** requests the International manager still has to classify (they follow the position, no data moves) */
  pendingClassificationRequests: number;
  items: (Pick<UnfinishedItem, "itemId" | "requestId" | "requestNumber" | "materialName" | "unit" | "required" | "purchased" | "remaining"> & { fromManagerId: string; fromManagerName: string })[];
}

const PREVIEW_ITEM_LIMIT = 200;

async function currentHolder(db: Db, position: ProcurementPosition) {
  const row = await db.approvalRoleAssignment.findFirst({
    where: { role: position, isActive: true },
    include: { user: { select: { id: true, name: true, isActive: true, role: true } } },
  });
  return row ? { id: row.user.id, name: row.user.name, isActive: row.user.isActive, isManager: row.user.role === "MANAGER" } : null;
}

function summarise(items: UnfinishedItem[]) {
  return {
    affectedRequests: new Set(items.map((i) => i.requestId)).size,
    affectedItems: items.length,
    partiallyPurchasedItems: items.filter((i) => i.purchased > 0).length,
  };
}

/**
 * What a handover of `position` to `newManagerId` would move, read-only. Includes
 * unfinished items of that responsibility assigned to anybody but the new manager
 * (also leftovers of an earlier replacement that never got a handover).
 */
export async function previewHandover(position: ProcurementPosition, newManagerId: string | null, db: Db = prisma): Promise<HandoverPreview> {
  const kind = POSITION_KIND[position];
  const [previousManager, newUser, problem] = await Promise.all([
    currentHolder(db, position),
    newManagerId ? db.user.findUnique({ where: { id: newManagerId }, select: { id: true, name: true } }) : null,
    newManagerId ? validateProcurementManager(db, position, newManagerId) : null,
  ]);
  const items = await unfinishedAssignedItems(db, { kind, ...(newManagerId ? { notManagerId: newManagerId } : {}) });
  const pending = position === "INTERNATIONAL_PROCUREMENT_MANAGER" ? await pendingClassificationRequestIds(db) : [];
  return {
    position,
    kind,
    previousManager,
    newManager: newUser,
    newManagerProblem: problem?.error ?? null,
    ...summarise(items),
    pendingClassificationRequests: pending.length,
    items: items.slice(0, PREVIEW_ITEM_LIMIT).map((i) => ({
      itemId: i.itemId, requestId: i.requestId, requestNumber: i.requestNumber, materialName: i.materialName, unit: i.unit,
      required: i.required, purchased: i.purchased, remaining: i.remaining, fromManagerId: i.assignedManagerId, fromManagerName: i.assignedManagerName,
    })),
  };
}

export interface HandoverInput {
  position: ProcurementPosition;
  newManagerId: string;
  actorId: string;
  reason: string;
  /** Idempotency key: a resubmission of the same confirmed handover is acknowledged, not applied twice. */
  clientRequestId: string;
  /** The item count the admin reviewed; a different current count means the work changed under them. */
  expectedItems: number;
}

export interface HandoverSummary {
  position: ProcurementPosition;
  kind: ProcurementKind;
  previousManagerId: string | null;
  newManagerId: string;
  affectedRequestIds: string[];
  affectedItemIds: string[];
  partiallyPurchasedItems: number;
  pendingClassificationRequests: number;
  positionChanged: boolean;
}

class Abort extends Error {
  constructor(readonly failure: HandoverFailure) {
    super(failure.error);
  }
}

/**
 * Replaces the holder (when different) and moves the unfinished assignments of
 * that responsibility to the new manager, in one transaction:
 *   position lock (exclusive) -> request rows FOR UPDATE in id order -> re-read the
 *   outstanding work under the locks -> write. An in-flight purchase finishes
 *   first (and its quantity is excluded); a purchase that starts afterwards sees
 *   the new assignment and is refused for the old manager.
 */
export async function executeHandover(input: HandoverInput): Promise<HandoverFailure | { ok: true; duplicate: boolean; summary: HandoverSummary }> {
  const reason = input.reason.trim();
  if (!reason) return fail(400, "Шилжүүлэх шалтгаанаа бичнэ үү");
  if (!input.clientRequestId.trim()) return fail(400, "clientRequestId шаардлагатай");
  const kind = POSITION_KIND[input.position];
  const key = input.clientRequestId.trim();

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockPositionExclusive(tx, input.position);

      const prior = await tx.auditLog.findFirst({ where: { entityType: "ProcurementHandover", entityId: key } });
      if (prior) {
        const before = prior.afterJson ? (JSON.parse(prior.afterJson) as HandoverSummary) : null;
        if (!before || before.position !== input.position || before.newManagerId !== input.newManagerId) {
          throw new Abort(fail(409, "Энэ clientRequestId өөр шилжүүлэлтэд ашиглагдсан байна"));
        }
        return { duplicate: true as const, summary: before, notify: [] as string[] };
      }

      const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true, isActive: true } });
      if (!actor || !actor.isActive || actor.role !== "ADMIN") throw new Abort(fail(403, "Эрхгүй үйлдэл"));

      const invalid = await validateProcurementManager(tx, input.position, input.newManagerId);
      if (invalid) throw new Abort(invalid);

      // lock every request holding candidate work (fixed id order: no deadlock with another handover)
      const candidates = await unfinishedAssignedItems(tx, { kind, notManagerId: input.newManagerId });
      const requestIds = [...new Set(candidates.map((i) => i.requestId))].sort();
      if (requestIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM "MaterialRequest" WHERE id = ANY(${requestIds}::text[]) ORDER BY id FOR UPDATE`;
      }
      // re-validate under the locks: statuses, ownership and outstanding quantities as they are now
      const items = await unfinishedAssignedItems(tx, { kind, notManagerId: input.newManagerId, requestIds });
      if (items.length !== input.expectedItems) {
        throw new Abort(
          fail(409, `Шилжүүлэх ажил урьдчилан харснаас өөрчлөгдсөн байна (${input.expectedItems} → ${items.length} материал). Дахин шалгаад баталгаажуулна уу`, "WORK_CHANGED")
        );
      }

      const holder = await currentHolder(tx, input.position);
      const positionChanged = holder?.id !== input.newManagerId;
      if (!positionChanged && items.length === 0) throw new Abort(fail(409, "Шилжүүлэх дуусаагүй ажил алга", "NOTHING_TO_TRANSFER"));

      if (positionChanged) {
        await tx.approvalRoleAssignment.updateMany({ where: { role: input.position, isActive: true }, data: { isActive: false, endedAt: new Date() } });
        await tx.approvalRoleAssignment.create({ data: { role: input.position, userId: input.newManagerId, isActive: true } });
        await tx.auditLog.create({ data: { entityType: "ApprovalRoleAssignment", entityId: input.newManagerId, action: "UPDATE", actorId: input.actorId, beforeJson: JSON.stringify({ role: input.position, userId: holder?.id ?? null }), afterJson: JSON.stringify({ role: input.position, userId: input.newManagerId, reason }) } });
      }

      if (items.length > 0) {
        const moved = await tx.procurementItemAssignment.updateMany({
          where: { requestItemId: { in: items.map((i) => i.itemId) }, kind, assignedManagerId: { not: input.newManagerId } },
          data: { assignedManagerId: input.newManagerId, assignedAt: new Date() },
        });
        if (moved.count !== items.length) throw new Abort(fail(409, "Хуваарилалт зэрэг өөрчлөгдсөн тул шилжүүлэлт цуцлагдлаа. Дахин оролдоно уу", "WORK_CHANGED"));
      }

      const pending = input.position === "INTERNATIONAL_PROCUREMENT_MANAGER" ? await pendingClassificationRequestIds(tx) : [];
      const summary: HandoverSummary = {
        position: input.position,
        kind,
        previousManagerId: holder?.id ?? null,
        newManagerId: input.newManagerId,
        affectedRequestIds: requestIds,
        affectedItemIds: items.map((i) => i.itemId),
        partiallyPurchasedItems: items.filter((i) => i.purchased > 0).length,
        pendingClassificationRequests: pending.length,
        positionChanged,
      };
      await tx.auditLog.create({
        data: {
          entityType: "ProcurementHandover",
          entityId: key,
          action: "PROCUREMENT_REASSIGN",
          actorId: input.actorId,
          beforeJson: JSON.stringify({ previousManagerId: summary.previousManagerId, fromManagers: [...new Set(items.map((i) => i.assignedManagerId))] }),
          afterJson: JSON.stringify({ ...summary, reason, at: new Date().toISOString() }),
        },
      });
      if (items.length > 0) {
        await tx.auditLog.createMany({
          data: items.map((i) => ({
            entityType: "ProcurementItemAssignment",
            entityId: i.itemId,
            action: "PROCUREMENT_REASSIGN" as const,
            actorId: input.actorId,
            beforeJson: JSON.stringify({ kind, assignedManagerId: i.assignedManagerId }),
            afterJson: JSON.stringify({ kind, assignedManagerId: input.newManagerId, reason, requestId: i.requestId, handoverId: key, remainingQuantity: i.remaining, purchasedQuantityPreserved: i.purchased }),
          })),
        });
      }

      const label = kind === "DOMESTIC" ? "Дотоодын" : "Олон улсын";
      const notifications: Prisma.NotificationCreateManyInput[] = [
        {
          userId: input.newManagerId,
          type: "PROCUREMENT_REQUIRED",
          title: `${label} худалдан авалтын ажил шилжиж ирлээ`,
          body: `${summary.affectedRequestIds.length} захиалгын ${items.length} дуусаагүй материал${summary.pendingClassificationRequests > 0 ? `, ангилал хүлээж буй ${summary.pendingClassificationRequests} захиалга` : ""} танд шилжлээ. Шалтгаан: ${reason}`,
        },
      ];
      if (holder && holder.id !== input.newManagerId && holder.isActive) {
        notifications.push({ userId: holder.id, type: "PROCUREMENT_REQUIRED", title: `${label} худалдан авалтын ажил шилжлээ`, body: `${items.length} дуусаагүй материал өөр менежерт шилжлээ. Шалтгаан: ${reason}` });
      }
      await tx.notification.createMany({ data: notifications });
      return { duplicate: false as const, summary, notify: notifications.map((n) => n.userId) };
    });

    if (!result.duplicate) {
      emitBroadcast({ type: "request-changed" });
      emitBroadcast({ type: "data-changed" });
      for (const id of result.notify) emitUserEvent(id, { type: "notification" });
    }
    return { ok: true, duplicate: result.duplicate, summary: result.summary };
  } catch (e) {
    if (e instanceof Abort) return e.failure;
    throw e;
  }
}

/**
 * Read-only: unfinished work a person would leave behind if they stopped being a
 * responsible manager (deactivated / demoted / replaced without a handover).
 */
export async function orphanableWork(userId: string, db: Db = prisma): Promise<{ items: number; requests: number; classification: number }> {
  const items = await unfinishedAssignedItems(db, { managerId: userId });
  const intl = await db.approvalRoleAssignment.findFirst({ where: { role: "INTERNATIONAL_PROCUREMENT_MANAGER", isActive: true, userId } });
  const classification = intl ? (await pendingClassificationRequestIds(db)).length : 0;
  return { items: items.length, requests: new Set(items.map((i) => i.requestId)).size, classification };
}
