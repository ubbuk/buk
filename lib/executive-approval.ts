import { Prisma, type ExecutiveDecisionKind } from "@prisma/client";
import { prisma } from "./prisma";
import { verifyPin } from "./pin";
import { emitBroadcast, emitUserEvent } from "./events";
import { getProcurementManagers } from "./procurement";
import {
  authorizationStatusOf,
  authorizedOf,
  deferredOf,
  isLegacyFullAuthorization,
  isValidQuantity,
  issuedOf,
  percentOf,
  requiredOf,
  type AuthorizationStatus,
} from "./executive-authorization";

// Executive partial approval & deferred procurement.
//
// The executive director (the assignee of the request's EXECUTIVE_APPROVAL
// step -- the same rule lib/workflow.ts uses; not "any DIRECTOR") authorises
// purchasing in instalments. Each decision is an immutable event with
// item-level quantity deltas. The Manager (procurement officer) may ask for more
// but cannot grant anything. Every writer takes the same row lock on the
// MaterialRequest as lib/procurement.ts purchases do, so an approval and a
// purchase can never interleave past a limit.

type Tx = Prisma.TransactionClient;
type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const num = (v: Prisma.Decimal) => Number(v);

const NOT_EXECUTIVE = "Та энэ хүсэлтийн гүйцэтгэх захирлын эрхгүй байна";
const NOT_PROCUREMENT_STAGE = "Нэмэлт зөвшөөрөл зөвхөн худалдан авалтын шатанд байгаа хүсэлтэд боломжтой";
const STALE = "Зөвшөөрлийн мэдээлэл шинэчлэгдсэн байна. Хуудсыг дахин ачаалж, дахин оролдоно уу";
const PENDING_EXISTS = "Энэ хүсэлтэд шийдвэрлэгдээгүй нэмэлт зөвшөөрлийн хүсэлт байна";

export interface WantedQuantity {
  itemId: string;
  quantity: number;
}

// --- state -----------------------------------------------------------------

const stateInclude = {
  approvalSteps: { select: { type: true, status: true, assignedUserId: true } },
  executiveDecisions: { select: { sequence: true } },
  items: {
    orderBy: { lineNo: "asc" as const },
    include: {
      material: { select: { name: true } },
      procurementAssignment: { select: { assignedManagerId: true } },
      warehouseCheckItems: { include: { warehouseCheck: { select: { checkedAt: true } } } },
      executiveAllocations: { select: { quantity: true } },
      purchases: { where: { voidedAt: null }, select: { quantity: true } },
    },
  },
} satisfies Prisma.MaterialRequestInclude;

type StateRow = Prisma.MaterialRequestGetPayload<{ include: typeof stateInclude }>;

export interface ItemState {
  itemId: string;
  lineNo: number;
  materialName: string;
  unit: string;
  requested: Prisma.Decimal;
  issued: Prisma.Decimal;
  required: Prisma.Decimal;
  /** Raw sum of allocation deltas (0 for a legacy approval). */
  allocated: Prisma.Decimal;
  authorized: Prisma.Decimal;
  deferred: Prisma.Decimal;
  purchased: Prisma.Decimal;
  assignedManagerId: string | null;
}

export interface State {
  id: string;
  requestNumber: string;
  status: string;
  requestedById: string;
  executiveAssigneeId: string | null;
  executiveApproved: boolean;
  revision: number;
  legacy: boolean;
  items: ItemState[];
}

function toState(row: StateRow): State {
  const executive = row.approvalSteps.find((s) => s.type === "EXECUTIVE_APPROVAL");
  const legacy = isLegacyFullAuthorization(row.executiveDecisions.length, executive?.status);
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    status: row.status,
    requestedById: row.requestedById,
    executiveAssigneeId: executive?.assignedUserId ?? null,
    executiveApproved: executive?.status === "APPROVED",
    revision: row.executiveDecisions.reduce((m, d) => Math.max(m, d.sequence), 0),
    legacy,
    items: row.items.map((i) => {
      const required = requiredOf(i.requestedQuantity, i.warehouseCheckItems);
      const allocated = i.executiveAllocations.reduce((s, a) => s.plus(a.quantity), D(0));
      const authorized = authorizedOf(required, allocated, legacy);
      return {
        itemId: i.id,
        lineNo: i.lineNo,
        materialName: i.manualMaterialName ?? i.material?.name ?? "—",
        unit: i.unit,
        requested: i.requestedQuantity,
        issued: issuedOf(i.warehouseCheckItems),
        required,
        allocated,
        authorized,
        deferred: deferredOf(required, authorized),
        purchased: i.purchases.reduce((s, p) => s.plus(p.quantity), D(0)),
        assignedManagerId: i.procurementAssignment?.assignedManagerId ?? null,
      };
    }),
  };
}

async function loadState(db: Tx | typeof prisma, requestId: string): Promise<State | null> {
  const row = await db.materialRequest.findUnique({ where: { id: requestId }, include: stateInclude });
  return row ? toState(row) : null;
}

/** Same lock lib/procurement.ts takes for purchases: serialises every quantity write for one request. */
async function lockRequest(tx: Tx, requestId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "MaterialRequest" WHERE id = ${requestId} FOR UPDATE`;
  return rows.length > 0;
}

// --- validation of a set of quantities ----------------------------------------

interface PlannedRow {
  itemId: string;
  quantity: Prisma.Decimal;
  required: Prisma.Decimal;
  cumulativeAfter: Prisma.Decimal;
}

/**
 * Validates `wanted` as additional authorisation: every item belongs to the
 * request and needs buying, each quantity is positive with at most 3 decimals,
 * no item is repeated, and cumulative authorisation never exceeds the
 * requirement. `limits` further caps an item (a procurement officer's proposal).
 */
function planAllocations(state: State, wanted: WantedQuantity[], limits?: Map<string, Prisma.Decimal>): Result<{ rows: PlannedRow[] }> {
  const seen = new Set<string>();
  const rows: PlannedRow[] = [];
  for (const w of wanted) {
    const item = state.items.find((i) => i.itemId === w.itemId);
    if (!item) return fail(400, "Захиалгын мөр олдсонгүй");
    if (seen.has(w.itemId)) return fail(400, "Нэг материалыг давхар оруулсан байна");
    seen.add(w.itemId);
    if (!isValidQuantity(w.quantity)) return fail(400, `${item.materialName}: тоо хэмжээ эерэг, хамгийн ихдээ 3 орны нарийвчлалтай байх ёстой`);
    if (item.required.lte(0)) return fail(409, `${item.materialName}: агуулахаас бүрэн олгосон тул худалдан авах шаардлагагүй`);
    const quantity = D(w.quantity);
    const limit = limits?.get(w.itemId);
    if (limits && !limit) return fail(400, `${item.materialName}: энэ материалыг хүсэлтэд оруулаагүй байна`);
    if (limit && quantity.gt(limit)) return fail(409, `${item.materialName}: хүссэн ${limit.toString()} ${item.unit}-ээс их батлах боломжгүй`);
    if (quantity.gt(item.deferred)) {
      return fail(409, `${item.materialName}: батлах боломжтой үлдэгдэл ${item.deferred.toString()} ${item.unit} байна`);
    }
    rows.push({ itemId: w.itemId, quantity, required: item.required, cumulativeAfter: item.authorized.plus(quantity) });
  }
  if (rows.length === 0) return fail(400, "Хамгийн багадаа нэг материалын тоо хэмжээг оруулна уу");
  return { ok: true, rows };
}

// --- writing a decision --------------------------------------------------------

async function writeDecision(
  tx: Tx,
  state: State,
  args: {
    actorId: string;
    kind: ExecutiveDecisionKind;
    rows: PlannedRow[];
    comment?: string | null;
    clientRequestId?: string | null;
    deferredRequestId?: string | null;
  }
) {
  const needed = state.items.filter((i) => i.required.gt(0));
  const requiredTotal = needed.reduce((s, i) => s.plus(i.required), D(0));
  const added = new Map(args.rows.map((r) => [r.itemId, r.quantity]));
  const approvedTotalAfter = needed.reduce((s, i) => s.plus(i.authorized).plus(added.get(i.itemId) ?? 0), D(0));
  const decision = await tx.executiveApprovalDecision.create({
    data: {
      requestId: state.id,
      sequence: state.revision + 1,
      kind: args.kind,
      decidedById: args.actorId,
      comment: args.comment?.trim() || null,
      clientRequestId: args.clientRequestId ?? null,
      deferredRequestId: args.deferredRequestId ?? null,
      requiredTotal,
      approvedTotalAfter,
      allocations: {
        create: args.rows.map((r) => ({ requestItemId: r.itemId, quantity: r.quantity, requiredQuantity: r.required, cumulativeAfter: r.cumulativeAfter })),
      },
    },
  });
  await tx.auditLog.create({
    data: {
      entityType: "ExecutiveApprovalDecision",
      entityId: decision.id,
      action: args.kind === "DEFERRED_RETURN" ? "RETURN" : "APPROVE",
      actorId: args.actorId,
      // never any PIN material -- only the decision itself
      afterJson: JSON.stringify({
        requestId: state.id,
        sequence: decision.sequence,
        kind: args.kind,
        comment: args.comment?.trim() || null,
        deferredRequestId: args.deferredRequestId ?? null,
        allocations: args.rows.map((r) => ({ itemId: r.itemId, quantity: num(r.quantity), cumulativeAfter: num(r.cumulativeAfter) })),
        requiredTotal: num(requiredTotal),
        approvedTotalAfter: num(approvedTotalAfter),
      }),
    },
  });
  return decision;
}

// --- initial decision (called from lib/workflow.ts inside the executive step) -------

export interface InitialPlan {
  kind: ExecutiveDecisionKind;
  rows: PlannedRow[];
  state: State;
}

/**
 * Validates the executive's first decision without writing. `wanted` omitted =
 * full approval of every item that needs buying. Provided = partial: unlisted
 * items get 0 (deferred), and at least one quantity must be approved.
 */
export async function planInitialDecision(tx: Tx, requestId: string, wanted?: WantedQuantity[]): Promise<Result<{ plan: InitialPlan }>> {
  const state = await loadState(tx, requestId);
  if (!state) return fail(404, "Захиалга олдсонгүй");
  if (state.revision > 0) return fail(409, "Энэ хүсэлтэд гүйцэтгэх захирлын шийдвэр аль хэдийн гарсан байна");
  const needed = state.items.filter((i) => i.required.gt(0));
  const full: WantedQuantity[] = needed.map((i) => ({ itemId: i.itemId, quantity: num(i.required) }));
  const planned = planAllocations(state, wanted ?? full);
  if (!planned.ok) return planned.status === 400 && !wanted ? fail(409, "Батлах худалдан авалтын тоо хэмжээ олдсонгүй") : planned;
  const everything = needed.every((i) => planned.rows.some((r) => r.itemId === i.itemId && r.quantity.gte(i.required)));
  return { ok: true, plan: { kind: everything ? "INITIAL_FULL" : "INITIAL_PARTIAL", rows: planned.rows, state } };
}

export async function recordInitialDecision(tx: Tx, plan: InitialPlan, actorId: string, comment?: string | null) {
  return writeDecision(tx, plan.state, { actorId, kind: plan.kind, rows: plan.rows, comment });
}

// --- authorisation helpers ----------------------------------------------------------

async function executiveFailure(db: Tx | typeof prisma, state: State, actorId: string) {
  if (state.executiveAssigneeId !== actorId) return fail(403, NOT_EXECUTIVE);
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  return actor && actor.isActive && actor.role === "DIRECTOR" ? null : fail(403, NOT_EXECUTIVE);
}

const NOT_PROCUREMENT_MANAGER = "Нэмэлт зөвшөөрөл хүсэх эрх зөвхөн худалдан авалтын хариуцсан менежерт байна";

/**
 * Who may ask the executive for more: an active MANAGER who currently HOLDS a procurement position
 * (Domestic / International) and to whom the requested items are ASSIGNED. Unlike buying, this is
 * never open to "any MANAGER": with no positions configured (LEGACY) nobody is explicitly
 * authorised yet, so the request is refused until an ADMIN sets the responsible managers up.
 * `itemIds` = the requested items (unknown ids are left for the quantity validation to reject).
 */
async function managerFailure(tx: Tx, state: State, actorId: string, itemIds: string[] = []) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor || !actor.isActive || actor.role !== "MANAGER") return fail(403, "Эрхгүй үйлдэл");
  const managers = await getProcurementManagers(tx);
  if (managers.mode !== "ASSIGNED") {
    return fail(403, "Худалдан авалтын хариуцсан менежер (Дотоод / Олон улсын) тохируулагдаагүй тул нэмэлт зөвшөөрөл хүсэх боломжгүй. Админд хандана уу");
  }
  if (actorId !== managers.domestic?.id && actorId !== managers.international?.id) return fail(403, NOT_PROCUREMENT_MANAGER);
  for (const itemId of itemIds) {
    const item = state.items.find((i) => i.itemId === itemId);
    if (item && item.assignedManagerId !== actorId) return fail(403, `${item.materialName}: энэ материалыг та хариуцаагүй байна`);
  }
  // asking about nothing of one's own (not even a single assigned item) is not a request an officer can make
  if (itemIds.length === 0 && !state.items.some((i) => i.assignedManagerId === actorId)) return fail(403, NOT_PROCUREMENT_MANAGER);
  return null;
}

/** Procurement officers to tell about a decision that was not a reply to one of their requests. */
async function procurementRecipients(tx: Tx): Promise<string[]> {
  const managers = await getProcurementManagers(tx);
  if (managers.mode === "ASSIGNED") return [managers.domestic?.id, managers.international?.id].filter((x): x is string => !!x);
  return (await tx.user.findMany({ where: { role: "MANAGER", isActive: true }, select: { id: true } })).map((u) => u.id);
}

// --- subsequent executive decision ------------------------------------------------------

export interface ExecutiveDecisionInput {
  action: "APPROVE" | "RETURN";
  pin?: string;
  /** APPROVE: quantities to add. Omitted with a deferredRequestId = approve everything that officer proposed. */
  items?: WantedQuantity[];
  comment?: string;
  /** The procurement officer's request this decision resolves. */
  deferredRequestId?: string;
  /** Idempotency key. */
  clientRequestId?: string;
  /** The `revision` the page was showing; a different value means someone else decided meanwhile. */
  expectedRevision: number;
}

export async function decideAdditionalApproval(requestId: string, actorId: string, input: ExecutiveDecisionInput): Promise<Result<{ duplicate: boolean; summary: ApprovalSummary }>> {
  const pre = await loadState(prisma, requestId);
  if (!pre) return fail(404, "Захиалга олдсонгүй");
  const denied = await executiveFailure(prisma, pre, actorId);
  if (denied) return denied;

  if (input.clientRequestId) {
    const existing = await prisma.executiveApprovalDecision.findUnique({
      where: { requestId_clientRequestId: { requestId, clientRequestId: input.clientRequestId } },
      select: { id: true },
    });
    if (existing) return { ok: true, duplicate: true, summary: (await getApprovalSummary(requestId, actorId, "DIRECTOR"))! };
  }
  if (input.action === "RETURN") {
    if (!input.deferredRequestId) return fail(400, "Буцаах хүсэлтээ сонгоно уу");
    if (!input.comment?.trim()) return fail(400, "Буцаах шалтгаанаа бичнэ үү");
  } else {
    // every executive authorisation requires the existing PIN check (same lockout/audit rules as the other approvals)
    const pin = await verifyPin(actorId, input.pin ?? "");
    if (!pin.ok) return fail(pin.status, pin.error);
  }

  let notifyIds: string[] = [];
  let duplicate = false;
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      if (!(await lockRequest(tx, requestId))) return fail(404, "Захиалга олдсонгүй");
      const state = (await loadState(tx, requestId))!;
      const stillExecutive = await executiveFailure(tx, state, actorId);
      if (stillExecutive) return stillExecutive;
      if (input.clientRequestId) {
        const existing = await tx.executiveApprovalDecision.findUnique({
          where: { requestId_clientRequestId: { requestId, clientRequestId: input.clientRequestId } },
          select: { id: true },
        });
        if (existing) return { ok: true as const, duplicate: true };
      }
      if (state.status !== "PENDING_PROCUREMENT" || !state.executiveApproved) return fail(409, NOT_PROCUREMENT_STAGE);
      if (state.revision !== input.expectedRevision) return fail(409, STALE);

      let linked: Prisma.DeferredApprovalRequestGetPayload<{ include: { items: true } }> | null = null;
      if (input.deferredRequestId) {
        linked = await tx.deferredApprovalRequest.findUnique({ where: { id: input.deferredRequestId }, include: { items: true } });
        if (!linked || linked.requestId !== requestId) return fail(404, "Нэмэлт зөвшөөрлийн хүсэлт олдсонгүй");
        if (linked.status !== "PENDING") return fail(409, "Энэ хүсэлтийг аль хэдийн шийдвэрлэсэн байна");
      }

      if (input.action === "RETURN") {
        // Returning grants nothing and never touches earlier allocations.
        const decision = await writeDecision(tx, state, {
          actorId,
          kind: "DEFERRED_RETURN",
          rows: [],
          comment: input.comment,
          clientRequestId: input.clientRequestId,
          deferredRequestId: linked!.id,
        });
        await tx.deferredApprovalRequest.update({
          where: { id: linked!.id },
          data: { status: "RETURNED", decidedById: actorId, decidedAt: decision.decidedAt, decisionComment: input.comment!.trim() },
        });
        await tx.deferredApprovalRequestItem.updateMany({ where: { deferredRequestId: linked!.id }, data: { approvedQuantity: 0 } });
        await tx.notification.create({
          data: {
            userId: linked!.requestedById,
            type: "REQUEST_RETURNED",
            title: "Нэмэлт зөвшөөрлийн хүсэлт буцаагдлаа",
            body: `№${state.requestNumber}: ${input.comment!.trim()}`,
            relatedRequestId: requestId,
          },
        });
        notifyIds = [linked!.requestedById];
        return { ok: true as const, duplicate: false };
      }

      let wanted: WantedQuantity[];
      let limits: Map<string, Prisma.Decimal> | undefined;
      if (linked) {
        limits = new Map(linked.items.map((i) => [i.requestItemId, i.requestedQuantity]));
        wanted = input.items ?? linked.items.map((i) => ({ itemId: i.requestItemId, quantity: num(i.requestedQuantity) }));
      } else {
        if (!input.items) return fail(400, "Батлах тоо хэмжээгээ оруулна уу");
        wanted = input.items;
      }
      const planned = planAllocations(state, wanted, limits);
      if (!planned.ok) return planned;

      const decision = await writeDecision(tx, state, {
        actorId,
        kind: "SUBSEQUENT",
        rows: planned.rows,
        comment: input.comment,
        clientRequestId: input.clientRequestId,
        deferredRequestId: linked?.id ?? null,
      });

      if (linked) {
        const approvedBy = new Map(planned.rows.map((r) => [r.itemId, r.quantity]));
        let all = true;
        for (const li of linked.items) {
          const approved = approvedBy.get(li.requestItemId) ?? D(0);
          if (approved.lt(li.requestedQuantity)) all = false;
          await tx.deferredApprovalRequestItem.update({ where: { id: li.id }, data: { approvedQuantity: approved } });
        }
        await tx.deferredApprovalRequest.update({
          where: { id: linked.id },
          data: { status: all ? "APPROVED" : "PARTIALLY_APPROVED", decidedById: actorId, decidedAt: decision.decidedAt, decisionComment: input.comment?.trim() || null },
        });
        notifyIds = [linked.requestedById];
      } else {
        notifyIds = await procurementRecipients(tx);
      }
      if (notifyIds.length > 0) {
        await tx.notification.createMany({
          data: notifyIds.map((userId) => ({
            userId,
            type: "REQUEST_APPROVED" as const,
            title: "Нэмэлт худалдан авалт батлагдлаа",
            body: `№${state.requestNumber}: гүйцэтгэх захирал нэмэлт тоо хэмжээг баталлаа`,
            relatedRequestId: requestId,
          })),
        });
      }
      return { ok: true as const, duplicate: false };
    });
    if (!outcome.ok) return outcome;
    duplicate = outcome.duplicate;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return fail(409, STALE);
    throw err;
  }

  if (!duplicate) {
    emitBroadcast({ type: "request-changed" });
    for (const id of notifyIds) emitUserEvent(id, { type: "notification" });
  }
  return { ok: true, duplicate, summary: (await getApprovalSummary(requestId, actorId, "DIRECTOR"))! };
}

// --- procurement officer's request ---------------------------------------------------------

export interface DeferredRequestInput {
  items: WantedQuantity[];
  reason: string;
  clientRequestId?: string;
}

export async function createDeferredRequest(requestId: string, actorId: string, input: DeferredRequestInput): Promise<Result<{ duplicate: boolean; summary: ApprovalSummary }>> {
  const reason = input.reason.trim();
  if (!reason) return fail(400, "Шалтгаан эсвэл тайлбараа бичнэ үү");
  if (reason.length > 1000) return fail(400, "Тайлбар хэт урт байна");

  let executiveId: string | null = null;
  let duplicate = false;
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      if (!(await lockRequest(tx, requestId))) return fail(404, "Захиалга олдсонгүй");
      const state = (await loadState(tx, requestId))!;
      const denied = await managerFailure(tx, state, actorId, input.items.map((i) => i.itemId));
      if (denied) return denied;
      if (input.clientRequestId) {
        const existing = await tx.deferredApprovalRequest.findUnique({
          where: { requestId_clientRequestId: { requestId, clientRequestId: input.clientRequestId } },
          select: { id: true },
        });
        if (existing) return { ok: true as const, duplicate: true };
      }
      if (state.status !== "PENDING_PROCUREMENT" || !state.executiveApproved) return fail(409, NOT_PROCUREMENT_STAGE);

      const pending = await tx.deferredApprovalRequest.findFirst({ where: { requestId, status: "PENDING" }, select: { id: true } });
      if (pending) return fail(409, PENDING_EXISTS);

      const planned = planAllocations(state, input.items);
      if (!planned.ok) return planned;

      const created = await tx.deferredApprovalRequest.create({
        data: {
          requestId,
          reason,
          requestedById: actorId,
          clientRequestId: input.clientRequestId ?? null,
          items: { create: planned.rows.map((r) => ({ requestItemId: r.itemId, requestedQuantity: r.quantity })) },
        },
      });
      await tx.auditLog.create({
        data: {
          entityType: "DeferredApprovalRequest",
          entityId: created.id,
          action: "CREATE",
          actorId,
          afterJson: JSON.stringify({ requestId, reason, items: planned.rows.map((r) => ({ itemId: r.itemId, quantity: num(r.quantity) })) }),
        },
      });
      executiveId = state.executiveAssigneeId;
      if (executiveId) {
        await tx.notification.create({
          data: {
            userId: executiveId,
            type: "APPROVAL_REQUIRED",
            title: "Нэмэлт худалдан авалтын зөвшөөрөл хүсч байна",
            body: `№${state.requestNumber}: ${reason}`,
            relatedRequestId: requestId,
          },
        });
      }
      return { ok: true as const, duplicate: false };
    });
    if (!outcome.ok) return outcome;
    duplicate = outcome.duplicate;
  } catch (err) {
    // the partial unique index: two simultaneous requests, the second loses
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return fail(409, PENDING_EXISTS);
    throw err;
  }

  if (!duplicate) {
    emitBroadcast({ type: "request-changed" });
    if (executiveId) emitUserEvent(executiveId, { type: "notification" });
  }
  return { ok: true, duplicate, summary: (await getApprovalSummary(requestId, actorId, "MANAGER"))! };
}

// --- reads ----------------------------------------------------------------------------------

export interface ApprovalItemSummary {
  itemId: string;
  lineNo: number;
  materialName: string;
  unit: string;
  requestedQuantity: number;
  issuedQuantity: number;
  requiredQuantity: number;
  authorizedQuantity: number;
  deferredQuantity: number;
  approvalPercentage: number;
  purchasedQuantity: number;
  remainingAuthorizedQuantity: number;
  /** The viewer may ask for more of this item (it is assigned to them). */
  viewerMayRequest: boolean;
}

export interface DeferredRequestView {
  id: string;
  status: "PENDING" | "APPROVED" | "PARTIALLY_APPROVED" | "RETURNED";
  reason: string;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  items: { itemId: string; materialName: string; unit: string; requestedQuantity: number; approvedQuantity: number | null }[];
}

export interface DecisionView {
  id: string;
  sequence: number;
  kind: ExecutiveDecisionKind;
  decidedByName: string;
  decidedAt: string;
  comment: string | null;
  deferredRequestId: string | null;
  requiredTotal: number;
  approvedTotalAfter: number;
  approvalPercentage: number;
  allocations: { itemId: string; materialName: string; unit: string; quantity: number; cumulativeAfter: number }[];
}

export interface ApprovalSummary {
  requestId: string;
  requestNumber: string;
  requestStatus: string;
  authorizationStatus: AuthorizationStatus;
  /** Number of executive decisions so far; send it back as `expectedRevision`. */
  revision: number;
  legacy: boolean;
  requiredTotal: number;
  authorizedTotal: number;
  deferredTotal: number;
  approvalPercentage: number;
  items: ApprovalItemSummary[];
  pendingRequest: DeferredRequestView | null;
  deferredRequests: DeferredRequestView[];
  decisions: DecisionView[];
  /** The viewer is this request's executive director and there is something left to decide. */
  viewerCanDecide: boolean;
  /** The viewer is an authorised procurement officer and may ask for more right now. */
  viewerCanRequest: boolean;
}

export async function getApprovalSummary(requestId: string, viewerId: string, viewerRole: string): Promise<ApprovalSummary | null> {
  const [state, decisions, requests] = await Promise.all([
    loadState(prisma, requestId),
    prisma.executiveApprovalDecision.findMany({
      where: { requestId },
      orderBy: { sequence: "asc" },
      include: { decidedBy: { select: { name: true } }, allocations: { include: { requestItem: { include: { material: { select: { name: true } } } } } } },
    }),
    prisma.deferredApprovalRequest.findMany({
      where: { requestId },
      orderBy: { requestedAt: "asc" },
      include: {
        requestedBy: { select: { name: true } },
        decidedBy: { select: { name: true } },
        items: { include: { requestItem: { include: { material: { select: { name: true } } } } } },
      },
    }),
  ]);
  if (!state) return null;

  const needed = state.items.filter((i) => i.required.gt(0));
  const requiredTotal = needed.reduce((s, i) => s.plus(i.required), D(0));
  const authorizedTotal = needed.reduce((s, i) => s.plus(i.authorized), D(0));
  const nameOf = (i: { manualMaterialName: string | null; material: { name: string } | null }) => i.manualMaterialName ?? i.material?.name ?? "—";
  const requestViews: DeferredRequestView[] = requests.map((r) => ({
    id: r.id,
    status: r.status,
    reason: r.reason,
    requestedByName: r.requestedBy.name,
    requestedAt: r.requestedAt.toISOString(),
    decidedByName: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionComment: r.decisionComment,
    items: r.items.map((i) => ({
      itemId: i.requestItemId,
      materialName: nameOf(i.requestItem),
      unit: i.requestItem.unit,
      requestedQuantity: num(i.requestedQuantity),
      approvedQuantity: i.approvedQuantity === null ? null : num(i.approvedQuantity),
    })),
  }));
  const pendingRequest = requestViews.find((r) => r.status === "PENDING") ?? null;

  const inProcurement = state.status === "PENDING_PROCUREMENT" && state.executiveApproved;
  const hasDeferred = needed.some((i) => i.deferred.gt(0));
  let viewerCanDecide = false;
  let viewerCanRequest = false;
  if (inProcurement && hasDeferred) {
    if (viewerRole === "DIRECTOR" && state.executiveAssigneeId === viewerId) {
      viewerCanDecide = !(await executiveFailure(prisma, state, viewerId));
    } else if (viewerRole === "MANAGER" && !pendingRequest) {
      const mine = state.items.filter((i) => i.deferred.gt(0) && i.assignedManagerId === viewerId).map((i) => i.itemId);
      viewerCanRequest = mine.length > 0 && !(await prisma.$transaction((tx) => managerFailure(tx, state, viewerId, mine)));
    }
  }

  return {
    requestId: state.id,
    requestNumber: state.requestNumber,
    requestStatus: state.status,
    authorizationStatus: authorizationStatusOf(state.items.map((i) => ({ required: i.required, authorized: i.authorized })), state.executiveApproved),
    revision: state.revision,
    legacy: state.legacy,
    requiredTotal: num(requiredTotal),
    authorizedTotal: num(authorizedTotal),
    deferredTotal: num(Prisma.Decimal.max(requiredTotal.minus(authorizedTotal), D(0))),
    approvalPercentage: percentOf(authorizedTotal, requiredTotal),
    items: state.items.map((i) => ({
      itemId: i.itemId,
      lineNo: i.lineNo,
      materialName: i.materialName,
      unit: i.unit,
      requestedQuantity: num(i.requested),
      issuedQuantity: num(i.issued),
      requiredQuantity: num(i.required),
      authorizedQuantity: num(i.authorized),
      deferredQuantity: num(i.deferred),
      approvalPercentage: percentOf(i.authorized, i.required),
      purchasedQuantity: num(i.purchased),
      remainingAuthorizedQuantity: num(Prisma.Decimal.max(i.authorized.minus(i.purchased), D(0))),
      viewerMayRequest: i.assignedManagerId === viewerId,
    })),
    pendingRequest,
    deferredRequests: requestViews,
    decisions: decisions.map((d) => ({
      id: d.id,
      sequence: d.sequence,
      kind: d.kind,
      decidedByName: d.decidedBy.name,
      decidedAt: d.decidedAt.toISOString(),
      comment: d.comment,
      deferredRequestId: d.deferredRequestId,
      requiredTotal: num(d.requiredTotal),
      approvedTotalAfter: num(d.approvedTotalAfter),
      approvalPercentage: percentOf(d.approvedTotalAfter, d.requiredTotal),
      allocations: d.allocations.map((a) => ({
        itemId: a.requestItemId,
        materialName: nameOf(a.requestItem),
        unit: a.requestItem.unit,
        quantity: num(a.quantity),
        cumulativeAfter: num(a.cumulativeAfter),
      })),
    })),
    viewerCanDecide,
    viewerCanRequest,
  };
}
