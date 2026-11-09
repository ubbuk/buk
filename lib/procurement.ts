import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { emitBroadcast, emitUserEvent } from "./events";
import { actionableRequestIds, lockPositionsShared } from "./procurement-workload";
import {
  authorizationStatusOf,
  authorizedOf,
  deferredOf,
  isLegacyFullAuthorization,
  issuedOf as issuedFromChecks,
  percentOf,
  requiredOf as requiredFromChecks,
  type AuthorizationStatus,
} from "./executive-authorization";

// Stage 7 -- Manager procurement. The warehouse check (Stage 3) leaves a
// per-item shortfall (WarehouseCheckItem.missingQuantity); this stage tracks
// buying exactly that shortfall. Three quantities are kept apart:
//   requested  MaterialRequestItem.requestedQuantity (never touched here)
//   issued     WarehouseCheckItem.allocatedQuantity  (taken from stock)
//   purchased  sum of the item's non-voided ProcurementPurchase rows
// An item is "complete" when purchased reaches the shortfall -- that is derived
// on every read, so the checkbox can only reflect what the server has verified.

type Tx = Prisma.TransactionClient;
type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export type PurchaseStatus = "NOT_STARTED" | "PARTIAL" | "COMPLETE";
export type ProcurementKind = "DOMESTIC" | "INTERNATIONAL";
/**
 * LEGACY: no responsible managers are configured (before an ADMIN sets them up), so
 * procurement behaves as it did before assignment existed -- any MANAGER may buy.
 * ASSIGNED: at least one is configured; items are classified and bought only by
 * their assigned manager.
 */
export type ProcurementMode = "LEGACY" | "ASSIGNED";
export interface ManagerRef {
  id: string;
  name: string;
}
export interface ProcurementManagers {
  mode: ProcurementMode;
  /** Active MANAGER holding the position, else null (also when the holder was deactivated or lost the role). */
  domestic: ManagerRef | null;
  international: ManagerRef | null;
}
export interface Viewer {
  id: string;
  role: string;
}
export interface AssignmentView {
  kind: ProcurementKind;
  managerId: string;
  managerName: string;
  assignedAt: string;
}

export interface PurchaseView {
  id: string;
  quantity: number;
  unitPrice: number;
  total: number;
  note: string | null;
  purchasedAt: string;
  purchasedByName: string;
  voided: boolean;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  replacesId: string | null;
}

export interface ProcurementItemView {
  itemId: string;
  lineNo: number;
  materialName: string;
  unit: string;
  requestedQuantity: number;
  issuedQuantity: number;
  /** Shortfall that has to be bought (0 = covered by the warehouse, no checkbox). */
  requiredQuantity: number;
  /** Cumulative quantity the executive director has authorised for purchase (capped at required). */
  authorizedQuantity: number;
  /** required - authorized: still waiting for an executive decision. */
  deferredQuantity: number;
  /** authorized - purchased: what the server will still let the Manager buy. */
  remainingAuthorizedQuantity: number;
  purchasedQuantity: number;
  remainingQuantity: number;
  estimatedUnitPrice: number | null;
  /** Quantity-weighted average of the non-voided purchases, null before the first one. */
  actualUnitPrice: number | null;
  actualTotal: number;
  status: PurchaseStatus;
  /** Server-verified: true only when the whole shortfall has been bought. */
  checked: boolean;
  lastPurchasedAt: string | null;
  lastPurchasedByName: string | null;
  purchases: PurchaseView[];
  /** Domestic / international classification and responsible manager (null before classification, or when no purchase is needed). */
  assignment: AssignmentView | null;
  /** Whether the viewer may record, correct or void purchases of this item right now. */
  canAct: boolean;
}

export interface ProcurementDetail {
  requestId: string;
  requestNumber: string;
  requestStatus: string;
  department: string;
  requestedBy: string;
  createdAt: string;
  approvedAt: string | null;
  procurementCompletedAt: string | null;
  procurementCompletedByName: string | null;
  items: ProcurementItemView[];
  requiredItemCount: number;
  completedItemCount: number;
  /** Everything required is bought (and, when managers are assigned, classified). */
  canComplete: boolean;
  /** `canComplete` and the viewer is allowed to complete. */
  viewerCanComplete: boolean;
  /** true while the request is actually waiting on the Manager (purchases can be recorded). */
  open: boolean;
  mode: ProcurementMode;
  managers: { domestic: ManagerRef | null; international: ManagerRef | null };
  classified: boolean;
  classifiedByName: string | null;
  classifiedAt: string | null;
  /** The viewer is the International manager and the request still awaits classification. */
  canClassify: boolean;
  /** The viewer is the International manager and the request is classified (controlled reassignment). */
  canReassign: boolean;
  /** Derived executive-authorisation state (separate from the request status). */
  authorizationStatus: AuthorizationStatus;
  authorizedPercentage: number;
  deferredItemCount: number;
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const num = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export const requestProcurementInclude = {
  department: { select: { name: true } },
  requestedBy: { select: { name: true } },
  approvalSteps: { select: { type: true, status: true, decidedAt: true, assignedUserId: true, decidedBy: { select: { name: true } } } },
  procurementClassification: { include: { confirmedBy: { select: { name: true } } } },
  executiveDecisions: { select: { id: true } },
  items: {
    orderBy: { lineNo: "asc" as const },
    include: {
      executiveAllocations: { select: { quantity: true } },
      material: { select: { name: true } },
      procurementAssignment: { include: { assignedManager: { select: { name: true } } } },
      warehouseCheckItems: { include: { warehouseCheck: { select: { checkedAt: true } } } },
      purchases: {
        orderBy: { purchasedAt: "asc" as const },
        include: { purchasedBy: { select: { name: true } }, voidedBy: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.MaterialRequestInclude;

export type RequestForProcurement = Prisma.MaterialRequestGetPayload<{ include: typeof requestProcurementInclude }>;
type ItemRow = RequestForProcurement["items"][number];

/** Shortfall of an item: the latest warehouse check's missing quantity (whole item if never checked). */
function requiredOf(item: ItemRow): Prisma.Decimal {
  return requiredFromChecks(item.requestedQuantity, item.warehouseCheckItems);
}
function issuedOf(item: ItemRow): Prisma.Decimal {
  return issuedFromChecks(item.warehouseCheckItems);
}

/** Cumulative executive-authorised quantity of an item (legacy approvals without decision rows count as fully authorised). */
export function authorizedQuantityOf(request: RequestForProcurement, item: ItemRow): Prisma.Decimal {
  const executive = request.approvalSteps.find((s) => s.type === "EXECUTIVE_APPROVAL");
  const legacy = isLegacyFullAuthorization(request.executiveDecisions.length, executive?.status);
  const allocated = item.executiveAllocations.reduce((s, a) => s.plus(a.quantity), D(0));
  return authorizedOf(requiredOf(item), allocated, legacy);
}

export function buildItemView(item: ItemRow, request: RequestForProcurement): ProcurementItemView {
  const required = requiredOf(item);
  const authorized = authorizedQuantityOf(request, item);
  const active = item.purchases.filter((p) => !p.voidedAt);
  const purchased = active.reduce((s, p) => s.plus(p.quantity), D(0));
  const actualTotal = active.reduce((s, p) => s.plus(p.quantity.mul(p.unitPrice)), D(0));
  const remaining = Prisma.Decimal.max(required.minus(purchased), D(0));
  const status: PurchaseStatus = purchased.gte(required) && required.gt(0) ? "COMPLETE" : purchased.gt(0) ? "PARTIAL" : "NOT_STARTED";
  const last = active[active.length - 1];
  return {
    itemId: item.id,
    lineNo: item.lineNo,
    materialName: item.manualMaterialName ?? item.material?.name ?? "—",
    unit: item.unit,
    requestedQuantity: num(item.requestedQuantity),
    issuedQuantity: num(issuedOf(item)),
    requiredQuantity: num(required),
    authorizedQuantity: num(authorized),
    deferredQuantity: num(deferredOf(required, authorized)),
    remainingAuthorizedQuantity: num(Prisma.Decimal.max(authorized.minus(purchased), D(0))),
    purchasedQuantity: num(purchased),
    remainingQuantity: num(remaining),
    estimatedUnitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
    actualUnitPrice: purchased.gt(0) ? Number(actualTotal.div(purchased).toDecimalPlaces(2)) : null,
    actualTotal: num(actualTotal),
    status: required.gt(0) ? status : "COMPLETE",
    checked: required.gt(0) && status === "COMPLETE",
    lastPurchasedAt: last ? last.purchasedAt.toISOString() : null,
    lastPurchasedByName: last ? last.purchasedBy.name : null,
    purchases: item.purchases.map((p) => ({
      id: p.id,
      quantity: Number(p.quantity),
      unitPrice: Number(p.unitPrice),
      total: Number(p.quantity.mul(p.unitPrice)),
      note: p.note,
      purchasedAt: p.purchasedAt.toISOString(),
      purchasedByName: p.purchasedBy.name,
      voided: !!p.voidedAt,
      voidedAt: p.voidedAt?.toISOString() ?? null,
      voidedByName: p.voidedBy?.name ?? null,
      voidReason: p.voidReason,
      replacesId: p.replacesId,
    })),
    assignment: item.procurementAssignment
      ? {
          kind: item.procurementAssignment.kind,
          managerId: item.procurementAssignment.assignedManagerId,
          managerName: item.procurementAssignment.assignedManager.name,
          assignedAt: item.procurementAssignment.assignedAt.toISOString(),
        }
      : null,
    canAct: false,
  };
}

export interface DetailContext {
  managers: ProcurementManagers;
  viewer: Viewer | null;
}
const NO_CONTEXT: DetailContext = { managers: { mode: "LEGACY", domestic: null, international: null }, viewer: null };

export function buildDetail(request: RequestForProcurement, ctx: DetailContext = NO_CONTEXT): ProcurementDetail {
  const { managers, viewer } = ctx;
  const items = request.items.map((i) => buildItemView(i, request));
  const needed = items.filter((i) => i.requiredQuantity > 0);
  const step = request.approvalSteps.find((s) => s.type === "MANAGER_PROCUREMENT");
  const ceo = request.approvalSteps.find((s) => s.type === "EXECUTIVE_APPROVAL");
  const open = request.status === "PENDING_PROCUREMENT" && step?.status === "PENDING";
  const done = needed.filter((i) => i.checked).length;
  const classified = !!request.procurementClassification;
  const isManager = viewer?.role === "MANAGER";
  const isInternational = !!viewer && managers.international?.id === viewer.id;
  for (const item of items) {
    item.canAct =
      open && isManager && item.requiredQuantity > 0 && (managers.mode === "LEGACY" || (classified && item.assignment?.managerId === viewer!.id));
  }
  const ready = open && done === needed.length && (managers.mode === "LEGACY" || classified);
  const involved = !!viewer && (managers.domestic?.id === viewer.id || isInternational || items.some((i) => i.assignment?.managerId === viewer.id));
  return {
    requestId: request.id,
    requestNumber: request.requestNumber,
    requestStatus: request.status,
    department: request.department.name,
    requestedBy: request.requestedBy.name,
    createdAt: request.createdAt.toISOString(),
    approvedAt: ceo?.decidedAt?.toISOString() ?? null,
    procurementCompletedAt: step?.status === "APPROVED" ? step.decidedAt?.toISOString() ?? null : null,
    procurementCompletedByName: step?.status === "APPROVED" ? step.decidedBy?.name ?? null : null,
    items,
    requiredItemCount: needed.length,
    completedItemCount: done,
    canComplete: ready,
    viewerCanComplete: ready && isManager && (managers.mode === "LEGACY" || involved),
    open,
    mode: managers.mode,
    managers: { domestic: managers.domestic, international: managers.international },
    classified,
    classifiedByName: request.procurementClassification?.confirmedBy.name ?? null,
    classifiedAt: request.procurementClassification?.confirmedAt.toISOString() ?? null,
    canClassify: open && managers.mode === "ASSIGNED" && !classified && isInternational,
    canReassign: open && managers.mode === "ASSIGNED" && classified && isInternational,
    authorizationStatus: authorizationStatusOf(
      request.items.map((i) => ({ required: requiredOf(i), authorized: authorizedQuantityOf(request, i) })),
      ceo?.status === "APPROVED"
    ),
    authorizedPercentage: percentOf(
      needed.reduce((s, i) => s.plus(i.authorizedQuantity), D(0)),
      needed.reduce((s, i) => s.plus(i.requiredQuantity), D(0))
    ),
    deferredItemCount: needed.filter((i) => i.deferredQuantity > 0).length,
  };
}

type Db = Tx | typeof prisma;

/**
 * The two responsible managers, from the admin-configured positions
 * (ApprovalRoleAssignment). A holder who was deactivated or is no longer a
 * MANAGER reads as null, but the mode stays ASSIGNED: their work is never
 * silently handed to anybody else.
 */
export async function getProcurementManagers(db: Db = prisma): Promise<ProcurementManagers> {
  const rows = await db.approvalRoleAssignment.findMany({
    where: { isActive: true, role: { in: ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] } },
    include: { user: { select: { id: true, name: true, role: true, isActive: true } } },
  });
  const pick = (role: "DOMESTIC_PROCUREMENT_MANAGER" | "INTERNATIONAL_PROCUREMENT_MANAGER"): ManagerRef | null => {
    const row = rows.find((r) => r.role === role);
    return row && row.user.isActive && row.user.role === "MANAGER" ? { id: row.user.id, name: row.user.name } : null;
  };
  return {
    mode: rows.length > 0 ? "ASSIGNED" : "LEGACY",
    domestic: pick("DOMESTIC_PROCUREMENT_MANAGER"),
    international: pick("INTERNATIONAL_PROCUREMENT_MANAGER"),
  };
}

export async function getProcurementDetail(requestId: string, viewer?: Viewer): Promise<ProcurementDetail | null> {
  const [request, managers] = await Promise.all([
    prisma.materialRequest.findUnique({ where: { id: requestId }, include: requestProcurementInclude }),
    getProcurementManagers(),
  ]);
  return request ? buildDetail(request, { managers, viewer: viewer ?? null }) : null;
}

// --- mutations --------------------------------------------------------------

/**
 * Serialises every procurement write for one request (purchase, void, correct,
 * complete) on the request row and returns its status. With the lock held the
 * "sum of purchases + new quantity <= shortfall" check cannot be raced, so two
 * managers can never push an item past what is required.
 */
async function lockRequest(tx: Tx, requestId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "MaterialRequest" WHERE id = ${requestId} FOR UPDATE`;
  return rows[0]?.status ?? null;
}

const NOT_IN_PROCUREMENT = "Энэ захиалга одоогоор худалдан авалтын шатанд байхгүй байна";
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

function validQuantity(q: number) {
  return Number.isFinite(q) && q > 0 && q < 1e9 && D(q).decimalPlaces() <= 3;
}
function validPrice(p: number) {
  return Number.isFinite(p) && p > 0 && p < 1e12 && D(p).decimalPlaces() <= 2;
}

async function loadItem(tx: Tx, requestId: string, itemId: string) {
  const request = await tx.materialRequest.findUnique({ where: { id: requestId }, include: requestProcurementInclude });
  const item = request?.items.find((i) => i.id === itemId);
  return request && item ? { request, item } : null;
}

const CLASSIFY_FIRST = "Олон улсын худалдан авалтын менежер материалын ангилалыг баталгаажуулах хүртэл худалдан авалт бүртгэх боломжгүй";
const KIND_LABEL: Record<ProcurementKind, string> = { DOMESTIC: "Дотоодын", INTERNATIONAL: "Олон улсын" };
const asManager = (id: string): Viewer => ({ id, role: "MANAGER" });

/** Once managers are assigned, the actor must still be an active MANAGER (the session check alone is not enough for a stale caller). */
async function actorFailure(tx: Tx, actorId: string, managers: ProcurementManagers) {
  if (managers.mode === "LEGACY") return null;
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  return actor && actor.isActive && actor.role === "MANAGER" ? null : fail(403, "Эрхгүй үйлдэл");
}

/** Purchases/corrections of an item belong to its assigned manager only, and only after classification. */
function assignmentFailure(managers: ProcurementManagers, request: RequestForProcurement, item: ItemRow, actorId: string) {
  if (managers.mode === "LEGACY") return null;
  if (!request.procurementClassification) return fail(409, CLASSIFY_FIRST);
  const assignment = item.procurementAssignment;
  if (!assignment) return fail(409, "Энэ материал худалдан авалтад хуваарилагдаагүй байна");
  if (assignment.assignedManagerId !== actorId) {
    return fail(403, `Энэ материалыг ${KIND_LABEL[assignment.kind]} худалдан авалтын менежер ${assignment.assignedManager.name} хариуцна`);
  }
  return null;
}

export interface RecordPurchaseInput {
  itemId: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  /** Idempotency key: a retry of the same submission is acknowledged, not counted twice. */
  clientRequestId?: string;
}

export async function recordPurchase(requestId: string, actorId: string, input: RecordPurchaseInput): Promise<Result<{ detail: ProcurementDetail; duplicate: boolean }>> {
  if (!validQuantity(input.quantity)) return fail(400, "Тоо хэмжээ эерэг, хамгийн ихдээ 3 орны нарийвчлалтай байх ёстой");
  if (!validPrice(input.unitPrice)) return fail(400, "Нэгж үнэ эерэг, хамгийн ихдээ 2 орны нарийвчлалтай байх ёстой");

  const outcome = await prisma.$transaction(async (tx) => {
    const status = await lockRequest(tx, requestId);
    if (!status) return fail(404, "Захиалга олдсонгүй");
    if (status !== "PENDING_PROCUREMENT") return fail(409, NOT_IN_PROCUREMENT);

    const managers = await getProcurementManagers(tx);
    const inactive = await actorFailure(tx, actorId, managers);
    if (inactive) return inactive;

    const found = await loadItem(tx, requestId, input.itemId);
    if (!found) return fail(404, "Захиалгын мөр олдсонгүй");

    // authorisation before the idempotent short-circuit, so a retry cannot be used to probe another manager's items
    const itemView = buildItemView(found.item, found.request);
    if (itemView.requiredQuantity > 0) {
      const denied = assignmentFailure(managers, found.request, found.item, actorId);
      if (denied) return denied;
    }

    if (input.clientRequestId) {
      const existing = found.item.purchases.find((p) => p.clientRequestId === input.clientRequestId);
      if (existing) return { ok: true as const, duplicate: true, request: found.request };
    }

    if (itemView.requiredQuantity <= 0) return fail(409, "Энэ материалыг агуулахаас бүрэн олгосон тул худалдан авах шаардлагагүй");
    const required = requiredOf(found.item);
    const purchased = found.item.purchases.filter((p) => !p.voidedAt).reduce((s, p) => s.plus(p.quantity), D(0));
    const remaining = required.minus(purchased);
    if (D(input.quantity).gt(remaining)) {
      return fail(409, `Худалдан авах үлдэгдэл ${remaining.toString()} ${found.item.unit} байна. Үүнээс их тоо оруулах боломжгүй`);
    }
    // Executive authorisation cap: committed + new quantity may not exceed what the executive director approved.
    const authorized = authorizedQuantityOf(found.request, found.item);
    const authorizedLeft = authorized.minus(purchased);
    if (D(input.quantity).gt(authorizedLeft)) {
      return fail(
        409,
        `Гүйцэтгэх захирлын баталсан үлдэгдэл ${Prisma.Decimal.max(authorizedLeft, D(0)).toString()} ${found.item.unit} байна. Нэмэлт зөвшөөрөл хүсэх шаардлагатай`
      );
    }

    const purchase = await tx.procurementPurchase.create({
      data: {
        requestItemId: input.itemId,
        quantity: D(input.quantity),
        unitPrice: D(input.unitPrice),
        note: input.note?.trim() || null,
        clientRequestId: input.clientRequestId ?? null,
        purchasedById: actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: "ProcurementPurchase",
        entityId: purchase.id,
        action: "PROCUREMENT_PURCHASE",
        actorId,
        afterJson: JSON.stringify({ requestId, itemId: input.itemId, quantity: input.quantity, unitPrice: input.unitPrice }),
      },
    });
    const request = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestProcurementInclude });
    return { ok: true as const, duplicate: false, request };
  });

  if (!outcome.ok) return outcome;
  emitBroadcast({ type: "request-changed" });
  return { ok: true, duplicate: outcome.duplicate, detail: (await getProcurementDetail(requestId, asManager(actorId)))! };
}

/** Voids a purchase (kept, with who/when/why). With `replacement`, records the corrected purchase in the same transaction. */
export async function voidPurchase(
  requestId: string,
  actorId: string,
  purchaseId: string,
  reason: string,
  replacement?: { quantity?: number; unitPrice?: number }
): Promise<Result<{ detail: ProcurementDetail }>> {
  const why = reason.trim();
  if (!why) return fail(400, "Шалтгаанаа бичнэ үү");
  if (replacement?.quantity !== undefined && !validQuantity(replacement.quantity)) return fail(400, "Тоо хэмжээ буруу байна");
  if (replacement?.unitPrice !== undefined && !validPrice(replacement.unitPrice)) return fail(400, "Нэгж үнэ буруу байна");

  const outcome = await prisma.$transaction(async (tx) => {
    const status = await lockRequest(tx, requestId);
    if (!status) return fail(404, "Захиалга олдсонгүй");
    if (status !== "PENDING_PROCUREMENT") return fail(409, NOT_IN_PROCUREMENT);

    const original = await tx.procurementPurchase.findUnique({ where: { id: purchaseId }, include: { requestItem: true } });
    if (!original || original.requestItem.requestId !== requestId) return fail(404, "Худалдан авалтын бичлэг олдсонгүй");

    const managers = await getProcurementManagers(tx);
    const inactive = await actorFailure(tx, actorId, managers);
    if (inactive) return inactive;
    const found = await loadItem(tx, requestId, original.requestItemId);
    if (!found) return fail(404, "Захиалгын мөр олдсонгүй");
    const denied = assignmentFailure(managers, found.request, found.item, actorId);
    if (denied) return denied;
    if (original.voidedAt) return fail(409, "Энэ бичлэг аль хэдийн хүчингүй болсон байна");

    if (replacement) {
      const required = requiredOf(found.item);
      const othersPurchased = found.item.purchases.filter((p) => !p.voidedAt && p.id !== original.id).reduce((s, p) => s.plus(p.quantity), D(0));
      const newQuantity = D(replacement.quantity ?? original.quantity);
      if (othersPurchased.plus(newQuantity).gt(required)) {
        return fail(409, `Худалдан авах үлдэгдэл ${required.minus(othersPurchased).toString()} ${found.item.unit} байна. Үүнээс их тоо оруулах боломжгүй`);
      }
      const authorized = authorizedQuantityOf(found.request, found.item);
      if (othersPurchased.plus(newQuantity).gt(authorized)) {
        return fail(
          409,
          `Гүйцэтгэх захирлын баталсан үлдэгдэл ${Prisma.Decimal.max(authorized.minus(othersPurchased), D(0)).toString()} ${found.item.unit} байна. Нэмэлт зөвшөөрөл хүсэх шаардлагатай`
        );
      }
    }

    await tx.procurementPurchase.update({ where: { id: original.id }, data: { voidedAt: new Date(), voidedById: actorId, voidReason: why } });
    let replacementId: string | null = null;
    if (replacement) {
      const created = await tx.procurementPurchase.create({
        data: {
          requestItemId: original.requestItemId,
          quantity: D(replacement.quantity ?? original.quantity),
          unitPrice: D(replacement.unitPrice ?? original.unitPrice),
          note: original.note,
          purchasedById: actorId,
          replacesId: original.id,
        },
      });
      replacementId = created.id;
    }
    await tx.auditLog.create({
      data: {
        entityType: "ProcurementPurchase",
        entityId: original.id,
        action: "PROCUREMENT_VOID",
        actorId,
        beforeJson: JSON.stringify({ quantity: Number(original.quantity), unitPrice: Number(original.unitPrice) }),
        afterJson: JSON.stringify({ voided: true, reason: why, replacementId }),
      },
    });
    const request = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestProcurementInclude });
    return { ok: true as const, request };
  });

  if (!outcome.ok) return outcome;
  emitBroadcast({ type: "request-changed" });
  return { ok: true, detail: (await getProcurementDetail(requestId, asManager(actorId)))! };
}

/**
 * Hands a fully purchased request to the Chief Accountant. Re-verifies
 * completeness inside the transaction (never trusts the client) and claims the
 * step with a compare-and-swap, so a double click or two managers cannot
 * complete it twice.
 */
export async function completeProcurement(requestId: string, actorId: string): Promise<Result<{ detail: ProcurementDetail }>> {
  const outcome = await prisma.$transaction(async (tx) => {
    const status = await lockRequest(tx, requestId);
    if (!status) return fail(404, "Захиалга олдсонгүй");
    if (status !== "PENDING_PROCUREMENT") return fail(409, NOT_IN_PROCUREMENT);

    const managers = await getProcurementManagers(tx);
    const inactive = await actorFailure(tx, actorId, managers);
    if (inactive) return inactive;
    const before = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestProcurementInclude });
    if (managers.mode === "ASSIGNED") {
      if (!before.procurementClassification) return fail(409, CLASSIFY_FIRST);
      // only the two responsible managers (or a manager holding an item of this request) may hand it on
      const involved =
        actorId === managers.domestic?.id || actorId === managers.international?.id || before.items.some((i) => i.procurementAssignment?.assignedManagerId === actorId);
      if (!involved) return fail(403, "Эрхгүй үйлдэл");
    }
    const detail = buildDetail(before, { managers, viewer: asManager(actorId) });
    const deferred = detail.items.filter((i) => i.deferredQuantity > 0);
    if (deferred.length > 0) {
      const names = deferred.map((i) => `${i.materialName} (${i.deferredQuantity} ${i.unit})`).join(", ");
      return fail(409, `Гүйцэтгэх захирлын шийдвэр хүлээж буй хойшлуулсан тоо хэмжээ байна: ${names}`);
    }
    const incomplete = detail.items.filter((i) => i.requiredQuantity > 0 && !i.checked);
    if (incomplete.length > 0) {
      const names = incomplete.map((i) => `${i.materialName} (${i.purchasedQuantity}/${i.requiredQuantity} ${i.unit})`).join(", ");
      return fail(409, `Дутуу худалдан авалттай материал байна: ${names}`);
    }

    const step = await tx.approvalStep.findFirst({ where: { requestId, type: "MANAGER_PROCUREMENT" } });
    if (!step) return fail(500, "Худалдан авалтын шат олдсонгүй");
    const claimed = await tx.approvalStep.updateMany({
      where: { id: step.id, status: "PENDING" },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById: actorId },
    });
    if (claimed.count === 0) return fail(409, "Худалдан авалтыг аль хэдийн дуусгасан байна");

    const request = await tx.materialRequest.update({
      where: { id: requestId },
      data: { status: "PENDING_ACCOUNTING", version: { increment: 1 } },
      include: requestProcurementInclude,
    });
    const accounting = await tx.approvalStep.findFirst({ where: { requestId, type: "ACCOUNTING_RECORD" }, select: { assignedUserId: true } });
    if (accounting?.assignedUserId) {
      await tx.notification.create({
        data: {
          userId: accounting.assignedUserId,
          type: "APPROVAL_REQUIRED",
          title: "Санхүүгийн бүртгэл хийх шаардлагатай",
          body: `№${request.requestNumber} захиалгын худалдан авалт дууслаа`,
          relatedRequestId: requestId,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        entityType: "MaterialRequest",
        entityId: requestId,
        action: "PROCUREMENT_COMPLETE",
        actorId,
        afterJson: JSON.stringify({
          items: detail.items.filter((i) => i.requiredQuantity > 0).map((i) => ({ itemId: i.itemId, purchased: i.purchasedQuantity, total: i.actualTotal })),
        }),
      },
    });
    return { ok: true as const, request, accountantId: accounting?.assignedUserId ?? null };
  });

  if (!outcome.ok) return outcome;
  emitBroadcast({ type: "request-changed" });
  if (outcome.accountantId) emitUserEvent(outcome.accountantId, { type: "notification" });
  return { ok: true, detail: (await getProcurementDetail(requestId, asManager(actorId)))! };
}

/**
 * Called inside the CEO-approval transaction (lib/workflow.ts): makes sure the
 * request has a MANAGER_PROCUREMENT step (requests created before this stage
 * existed do not) and tells every active MANAGER it is waiting. Returns the
 * notified user ids.
 */
export async function openProcurement(tx: Tx, request: { id: string; requestNumber: string }): Promise<string[]> {
  const existing = await tx.approvalStep.findFirst({ where: { requestId: request.id, type: "MANAGER_PROCUREMENT" } });
  if (!existing) {
    const last = await tx.approvalStep.aggregate({ where: { requestId: request.id }, _max: { sequence: true } });
    await tx.approvalStep.create({
      data: { requestId: request.id, type: "MANAGER_PROCUREMENT", sequence: (last._max.sequence ?? 0) + 1, status: "PENDING", assignedUserId: null },
    });
  }
  // Once the responsible managers are configured the International manager is told first
  // (to classify the outstanding items); before that, every active MANAGER, as before.
  const configured = await getProcurementManagers(tx);
  const recipients =
    configured.mode === "ASSIGNED" && configured.international
      ? [{ id: configured.international.id }]
      : await tx.user.findMany({ where: { role: "MANAGER", isActive: true }, select: { id: true } });
  const assigned = configured.mode === "ASSIGNED" && !!configured.international;
  if (recipients.length > 0) {
    await tx.notification.createMany({
      data: recipients.map((m) => ({
        userId: m.id,
        type: "PROCUREMENT_REQUIRED" as const,
        title: assigned ? "Олон улсын худалдан авалтын материалыг ангилна уу" : "Худалдан авалт хийх шаардлагатай",
        body: assigned ? `№${request.requestNumber} захиалгын дутуу материалыг ангилж баталгаажуулна уу` : `№${request.requestNumber} захиалгыг худалдан авна уу`,
        relatedRequestId: request.id,
      })),
    });
  }
  return recipients.map((m) => m.id);
}

// --- classification and controlled reassignment ------------------------------

/**
 * The International manager's one-time confirmation of which outstanding items
 * are bought abroad; everything else outstanding goes to the Domestic manager.
 * Items the warehouse fully covered never get an assignment. Confirming again
 * with the same selection is acknowledged; a different selection is refused --
 * changes go through `reassignItem` (reason + audit).
 */
export async function classifyProcurement(requestId: string, actorId: string, internationalItemIds: string[]): Promise<Result<{ detail: ProcurementDetail; duplicate: boolean }>> {
  const wanted = [...new Set(internationalItemIds)];
  const outcome = await prisma.$transaction(async (tx) => {
    await lockPositionsShared(tx); // a handover cannot change the holders between our read and our writes
    const status = await lockRequest(tx, requestId);
    if (!status) return fail(404, "Захиалга олдсонгүй");
    if (status !== "PENDING_PROCUREMENT") return fail(409, NOT_IN_PROCUREMENT);

    const managers = await getProcurementManagers(tx);
    if (managers.mode !== "ASSIGNED") return fail(409, "Худалдан авалтын хариуцсан менежерүүд тохируулагдаагүй байна (Админ → Албан тушаал)");
    if (!managers.international || managers.international.id !== actorId) return fail(403, "Зөвхөн Олон улсын худалдан авалтын менежер ангилна");
    if (!managers.domestic) return fail(409, "Дотоодын худалдан авалтын менежер тохируулагдаагүй эсвэл идэвхгүй байна");

    const request = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestProcurementInclude });
    const required = request.items.filter((i) => requiredOf(i).gt(0));
    const requiredIds = new Set(required.map((i) => i.id));
    for (const id of wanted) {
      if (!request.items.some((i) => i.id === id)) return fail(404, "Захиалгын мөр олдсонгүй");
      if (!requiredIds.has(id)) return fail(400, "Агуулахаас бүрэн олгосон материалыг ангилах шаардлагагүй");
    }

    if (request.procurementClassification) {
      const current = required.filter((i) => i.procurementAssignment?.kind === "INTERNATIONAL").map((i) => i.id).sort();
      if (JSON.stringify(current) === JSON.stringify([...wanted].sort())) return { ok: true as const, duplicate: true };
      return fail(409, "Ангилал аль хэдийн баталгаажсан. Өөрчлөхийн тулд «Дахин хуваарилах» үйлдлийг шалтгаантай хийнэ үү");
    }

    await tx.procurementClassification.create({ data: { requestId, confirmedById: actorId } });
    const international = required.filter((i) => wanted.includes(i.id));
    const domestic = required.filter((i) => !wanted.includes(i.id));
    await tx.procurementItemAssignment.createMany({
      data: [
        ...international.map((i) => ({ requestItemId: i.id, kind: "INTERNATIONAL" as const, assignedManagerId: managers.international!.id })),
        ...domestic.map((i) => ({ requestItemId: i.id, kind: "DOMESTIC" as const, assignedManagerId: managers.domestic!.id })),
      ],
    });
    await tx.auditLog.create({
      data: {
        entityType: "MaterialRequest",
        entityId: requestId,
        action: "PROCUREMENT_CLASSIFY",
        actorId,
        afterJson: JSON.stringify({ international: international.map((i) => i.id), domestic: domestic.map((i) => i.id) }),
      },
    });
    await tx.notification.createMany({
      data: [
        {
          userId: managers.domestic.id,
          type: "PROCUREMENT_REQUIRED" as const,
          title: "Дотоодын худалдан авалтын материал хуваарилагдлаа",
          body: `№${request.requestNumber}: ${domestic.length} материал танд хуваарилагдлаа`,
          relatedRequestId: requestId,
        },
        {
          userId: managers.international.id,
          type: "PROCUREMENT_REQUIRED" as const,
          title: "Ангилал баталгаажлаа",
          body: `№${request.requestNumber}: олон улсын ${international.length}, дотоодын ${domestic.length} материал`,
          relatedRequestId: requestId,
        },
      ],
    });
    return { ok: true as const, duplicate: false, notify: [managers.domestic.id] };
  });

  if (!outcome.ok) return outcome;
  emitBroadcast({ type: "request-changed" });
  const notify: string[] = ("notify" in outcome && outcome.notify) || [];
  for (const id of notify) emitUserEvent(id, { type: "notification" });
  return { ok: true, duplicate: outcome.duplicate, detail: (await getProcurementDetail(requestId, asManager(actorId)))! };
}

/**
 * Moves one item to the other classification (or to a replacement manager). Only
 * the International manager may do it, always with a reason, and it is audited
 * with before/after. An item that already has purchase records keeps its
 * responsible manager as long as that manager is still the active holder of the
 * position -- the purchases are never rewritten; the manager has to void the
 * active ones first (voided rows stay in the history). If the holder has been replaced or deactivated the work is stranded, and
 * only then may it be handed over (purchase rows stay untouched).
 */
export async function reassignItem(requestId: string, actorId: string, itemId: string, kind: ProcurementKind, reason: string): Promise<Result<{ detail: ProcurementDetail }>> {
  const why = reason.trim();
  if (!why) return fail(400, "Шалтгаанаа бичнэ үү");

  const outcome = await prisma.$transaction(async (tx) => {
    await lockPositionsShared(tx);
    const status = await lockRequest(tx, requestId);
    if (!status) return fail(404, "Захиалга олдсонгүй");
    if (status !== "PENDING_PROCUREMENT") return fail(409, NOT_IN_PROCUREMENT);

    const managers = await getProcurementManagers(tx);
    if (managers.mode !== "ASSIGNED") return fail(409, "Худалдан авалтын хариуцсан менежерүүд тохируулагдаагүй байна");
    if (!managers.international || managers.international.id !== actorId) return fail(403, "Зөвхөн Олон улсын худалдан авалтын менежер дахин хуваарилна");

    const found = await loadItem(tx, requestId, itemId);
    if (!found) return fail(404, "Захиалгын мөр олдсонгүй");
    const current = found.item.procurementAssignment;
    if (!found.request.procurementClassification || !current) return fail(409, "Энэ материал одоогоор хуваарилагдаагүй байна. Эхлээд ангилалыг баталгаажуулна уу");

    const target = kind === "DOMESTIC" ? managers.domestic : managers.international;
    if (!target) return fail(409, `${KIND_LABEL[kind]} худалдан авалтын менежер тохируулагдаагүй эсвэл идэвхгүй байна`);
    if (current.kind === kind && current.assignedManagerId === target.id) return fail(409, "Энэ материал аль хэдийн тухайн менежерт хуваарилагдсан байна");

    const purchaseCount = found.item.purchases.length;
    const activeCount = found.item.purchases.filter((pu) => !pu.voidedAt).length;
    const holder = current.kind === "DOMESTIC" ? managers.domestic : managers.international;
    if (activeCount > 0 && holder?.id === current.assignedManagerId) {
      return fail(409, `Энэ материалд ${activeCount} идэвхтэй худалдан авалтын бичлэг байгаа тул ангилал, хариуцагчийг солих боломжгүй. Хариуцсан менежер ${current.assignedManager.name} эхлээд бичлэгүүдээ хүчингүй болгоно уу`);
    }

    await tx.procurementItemAssignment.update({ where: { requestItemId: itemId }, data: { kind, assignedManagerId: target.id, assignedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        entityType: "ProcurementItemAssignment",
        entityId: itemId,
        action: "PROCUREMENT_REASSIGN",
        actorId,
        beforeJson: JSON.stringify({ kind: current.kind, assignedManagerId: current.assignedManagerId }),
        afterJson: JSON.stringify({ kind, assignedManagerId: target.id, reason: why, requestId, purchaseRecordsPreserved: purchaseCount }),
      },
    });
    const name = found.item.manualMaterialName ?? found.item.material?.name ?? "материал";
    const notify = [...new Set([target.id, current.assignedManagerId])].filter((id) => id !== actorId);
    if (notify.length > 0) {
      await tx.notification.createMany({
        data: notify.map((userId) => ({
          userId,
          type: "PROCUREMENT_REQUIRED" as const,
          title: userId === target.id ? "Материал танд хуваарилагдлаа" : "Материал таны хуваарилалтаас гарлаа",
          body: `№${found.request.requestNumber}: ${name} — ${why}`,
          relatedRequestId: requestId,
        })),
      });
    }
    return { ok: true as const, notify };
  });

  if (!outcome.ok) return outcome;
  emitBroadcast({ type: "request-changed" });
  for (const id of outcome.notify) emitUserEvent(id, { type: "notification" });
  return { ok: true, detail: (await getProcurementDetail(requestId, asManager(actorId)))! };
}

// --- dashboard list + backend search ----------------------------------------

export type ProcurementTab = "classify" | "awaiting" | "in_progress" | "completed" | "all";

export interface ProcurementQuery {
  tab: ProcurementTab;
  q?: string;
  page: number;
  pageSize: number;
  dateFrom?: Date;
  dateTo?: Date;
  /** Range filters apply to the SAME item: requested quantity and (actual, else estimated) unit price. */
  qtyMin?: number;
  qtyMax?: number;
  priceMin?: number;
  priceMax?: number;
  /** Some item of the request is in this purchase state. */
  itemStatus?: PurchaseStatus;
  /** Some item is classified this way. */
  kind?: ProcurementKind;
  /**
   * "mine" (default for a manager): only requests holding an item assigned to `viewerId`
   * (plus, for the International manager, requests still waiting to be classified).
   * "all": the whole procurement workflow -- shared context, and what ADMIN monitors.
   * Without assigned managers (LEGACY) there is nothing to scope by.
   */
  scope?: "mine" | "all";
  viewerId?: string;
  /**
   * Only the requests the sidebar badge counts for `viewerId` (unfinished items assigned to them, plus
   * requests awaiting classification for the International manager) -- the same set, by construction.
   */
  actionable?: boolean;
  viewerRole?: string;
}

export interface ProcurementListRow {
  requestId: string;
  requestNumber: string;
  requestStatus: string;
  department: string;
  requestedBy: string;
  createdAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  requiredItemCount: number;
  completedItemCount: number;
  /** false while the International manager still has to classify the outstanding items. */
  classified: boolean;
  items: (Pick<ProcurementItemView, "itemId" | "materialName" | "unit" | "requiredQuantity" | "purchasedQuantity" | "remainingQuantity" | "status" | "actualUnitPrice" | "actualTotal"> & {
    kind: ProcurementKind | null;
    managerName: string | null;
    mine: boolean;
  })[];
}

// Numeric search rule (documented in the UI): a number in the search box matches
// EXACTLY -- an item's requested quantity, shortfall-purchased quantity (sum of
// its purchases), estimated or purchase unit price, or its estimated/purchased
// total. Use the explicit min/max filters for ranges.
const FACTS = Prisma.sql`
  SELECT i.id, i."requestId", i."requestedQuantity" AS requested, i."unitPrice" AS est_unit, i."totalPrice" AS est_total,
    COALESCE((SELECT wci."missingQuantity" FROM "WarehouseCheckItem" wci JOIN "WarehouseCheck" wc ON wc.id = wci."warehouseCheckId"
              WHERE wci."requestItemId" = i.id ORDER BY wc."checkedAt" DESC LIMIT 1), i."requestedQuantity") AS required,
    COALESCE((SELECT SUM(p.quantity) FROM "ProcurementPurchase" p WHERE p."requestItemId" = i.id AND p."voidedAt" IS NULL), 0) AS purchased,
    COALESCE((SELECT SUM(p.quantity * p."unitPrice") FROM "ProcurementPurchase" p WHERE p."requestItemId" = i.id AND p."voidedAt" IS NULL), 0) AS actual_total,
    EXISTS (SELECT 1 FROM "ProcurementPurchase" p WHERE p."requestItemId" = i.id AND p."voidedAt" IS NULL) AS has_purchase
  FROM "MaterialRequestItem" i`;

/** Request ids having an item that satisfies the numeric / status filters (null = no such filter). */
async function itemFilterIds(query: ProcurementQuery): Promise<string[] | null> {
  const conds: Prisma.Sql[] = [];
  if (query.qtyMin !== undefined) conds.push(Prisma.sql`requested >= ${D(query.qtyMin)}`);
  if (query.qtyMax !== undefined) conds.push(Prisma.sql`requested <= ${D(query.qtyMax)}`);
  if (query.priceMin !== undefined)
    conds.push(Prisma.sql`COALESCE(CASE WHEN purchased > 0 THEN actual_total / purchased END, est_unit) >= ${D(query.priceMin)}`);
  if (query.priceMax !== undefined)
    conds.push(Prisma.sql`COALESCE(CASE WHEN purchased > 0 THEN actual_total / purchased END, est_unit) <= ${D(query.priceMax)}`);
  if (query.itemStatus === "COMPLETE") conds.push(Prisma.sql`required > 0 AND purchased >= required`);
  if (query.itemStatus === "PARTIAL") conds.push(Prisma.sql`purchased > 0 AND purchased < required`);
  if (query.itemStatus === "NOT_STARTED") conds.push(Prisma.sql`required > 0 AND purchased = 0`);
  if (conds.length === 0) return null;
  return matchIds(conds);
}

async function matchIds(conds: Prisma.Sql[]): Promise<string[]> {
  const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ requestId: string }[]>`SELECT DISTINCT "requestId" FROM (${FACTS}) f ${where}`;
  return rows.map((r) => r.requestId);
}

async function numericIds(n: number): Promise<string[]> {
  const v = D(n);
  const rows = await prisma.$queryRaw<{ requestId: string }[]>`
    SELECT DISTINCT f."requestId" FROM (${FACTS}) f
    WHERE f.requested = ${v} OR f.est_unit = ${v} OR f.est_total = ${v} OR f.purchased = ${v} OR f.actual_total = ${v}
       OR EXISTS (SELECT 1 FROM "ProcurementPurchase" p WHERE p."requestItemId" = f.id AND p."voidedAt" IS NULL AND (p."unitPrice" = ${v} OR p.quantity = ${v}))`;
  return rows.map((r) => r.requestId);
}

export function parseSearchNumber(q: string): number | null {
  const cleaned = q.trim().replace(/[\s,₮]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

type RequestWhere = Prisma.MaterialRequestWhereInput;
const HAS_ACTIVE_PURCHASE = { items: { some: { purchases: { some: { voidedAt: null } } } } } satisfies RequestWhere;
const HAS_MANAGER_STEP = { approvalSteps: { some: { type: "MANAGER_PROCUREMENT" as const } } } satisfies RequestWhere;

function tabWhere(tab: ProcurementTab): RequestWhere[] {
  switch (tab) {
    case "classify":
      return [{ status: "PENDING_PROCUREMENT" }, { procurementClassification: null }];
    case "awaiting":
      return [{ status: "PENDING_PROCUREMENT" }, { NOT: HAS_ACTIVE_PURCHASE }];
    case "in_progress":
      return [{ status: "PENDING_PROCUREMENT" }, HAS_ACTIVE_PURCHASE];
    case "completed":
      return [{ approvalSteps: { some: { type: "MANAGER_PROCUREMENT", status: "APPROVED" } } }];
    default:
      return [];
  }
}

/** The "my work" restriction; undefined when it does not apply (ADMIN / explicit "all" / managers not assigned yet). */
function mineWhere(managers: ProcurementManagers, viewerId: string | undefined, scope: "mine" | "all" | undefined): RequestWhere | undefined {
  if (scope === "all" || !viewerId || managers.mode !== "ASSIGNED") return undefined;
  const or: RequestWhere[] = [{ items: { some: { procurementAssignment: { assignedManagerId: viewerId } } } }];
  if (managers.international?.id === viewerId) or.push({ AND: [{ status: "PENDING_PROCUREMENT" }, { procurementClassification: null }] });
  return { OR: or };
}

export async function listProcurement(query: ProcurementQuery): Promise<{
  rows: ProcurementListRow[];
  total: number;
  page: number;
  pageSize: number;
  mode: ProcurementMode;
  managers: { domestic: ManagerRef | null; international: ManagerRef | null };
}> {
  const managers = await getProcurementManagers();
  const pageSize = Math.min(Math.max(query.pageSize, 1), 100);
  const page = Math.max(query.page, 1);
  const base = { mode: managers.mode, managers: { domestic: managers.domestic, international: managers.international } };
  // nothing is ever "to classify" before managers are assigned
  if (query.tab === "classify" && managers.mode !== "ASSIGNED") return { rows: [], total: 0, page, pageSize, ...base };

  // Only requests that have a Manager procurement stage (older requests that went straight to accounting have none).
  const and: RequestWhere[] = [HAS_MANAGER_STEP, ...tabWhere(query.tab)];
  const mine = mineWhere(managers, query.viewerId, query.scope);
  if (query.actionable) {
    and.push({ id: { in: query.viewerId ? await actionableRequestIds({ id: query.viewerId, role: query.viewerRole ?? "MANAGER" }, managers) : [] } });
  }
  if (mine && query.kind) {
    // "my items of this kind": both conditions must hold for the same item, not merely for the same request
    and.push({ items: { some: { procurementAssignment: { kind: query.kind, assignedManagerId: query.viewerId } } } });
  } else {
    if (mine) and.push(mine);
    if (query.kind) and.push({ items: { some: { procurementAssignment: { kind: query.kind } } } });
  }

  if (query.dateFrom || query.dateTo) and.push({ createdAt: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: query.dateTo } : {}) } });

  const q = query.q?.trim();
  const numeric = q ? parseSearchNumber(q) : null;
  const filterIds = await itemFilterIds(query);
  if (filterIds) and.push({ id: { in: filterIds } });

  if (q) {
    const or: RequestWhere[] = [
      { requestNumber: { contains: q, mode: "insensitive" } },
      { department: { name: { contains: q, mode: "insensitive" } } },
      { items: { some: { OR: [{ manualMaterialName: { contains: q, mode: "insensitive" } }, { material: { name: { contains: q, mode: "insensitive" } } }] } } },
    ];
    if (numeric !== null) or.push({ id: { in: await numericIds(numeric) } });
    and.push({ OR: or });
  }

  const where: RequestWhere = { AND: and };
  const [total, requests] = await Promise.all([
    prisma.materialRequest.count({ where }),
    prisma.materialRequest.findMany({
      where,
      include: requestProcurementInclude,
      orderBy: query.tab === "awaiting" || query.tab === "classify" ? { updatedAt: "asc" } : { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const rows = requests.map((r) => {
    const detail = buildDetail(r, { managers, viewer: query.viewerId ? { id: query.viewerId, role: "MANAGER" } : null });
    return {
      requestId: r.id,
      requestNumber: r.requestNumber,
      requestStatus: r.status,
      department: detail.department,
      requestedBy: detail.requestedBy,
      createdAt: detail.createdAt,
      approvedAt: detail.approvedAt,
      completedAt: detail.procurementCompletedAt,
      requiredItemCount: detail.requiredItemCount,
      completedItemCount: detail.completedItemCount,
      classified: detail.classified,
      items: detail.items
        .filter((i) => i.requiredQuantity > 0)
        .map(({ itemId, materialName, unit, requiredQuantity, purchasedQuantity, remainingQuantity, status, actualUnitPrice, actualTotal, assignment }) => ({
          itemId, materialName, unit, requiredQuantity, purchasedQuantity, remainingQuantity, status, actualUnitPrice, actualTotal,
          kind: assignment?.kind ?? null,
          managerName: assignment?.managerName ?? null,
          mine: !!assignment && assignment.managerId === query.viewerId,
        })),
    };
  });
  return { rows, total, page, pageSize, ...base };
}

/** Tab counters, scoped the same way as the list. */
export async function procurementCounts(
  viewer?: { id: string; scope?: "mine" | "all"; role?: string }
): Promise<{ classify: number; awaiting: number; inProgress: number; completed: number; actionable: number }> {
  const managers = await getProcurementManagers();
  const actionable = viewer ? (await actionableRequestIds({ id: viewer.id, role: viewer.role ?? "MANAGER" }, managers)).length : 0;
  const mine = mineWhere(managers, viewer?.id, viewer?.scope);
  const count = (tab: ProcurementTab) => prisma.materialRequest.count({ where: { AND: [HAS_MANAGER_STEP, ...tabWhere(tab), ...(mine ? [mine] : [])] } });
  const [classify, awaiting, inProgress, completed] = await Promise.all([
    managers.mode === "ASSIGNED" ? count("classify") : Promise.resolve(0),
    count("awaiting"),
    count("in_progress"),
    count("completed"),
  ]);
  return { classify, awaiting, inProgress, completed, actionable };
}
