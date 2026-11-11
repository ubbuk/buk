import { randomUUID } from "node:crypto";
import { Prisma, type ApprovalPosition, type NotificationType } from "@prisma/client";
import { prisma } from "./prisma";
import { storage } from "./storage";
import { verifyPin } from "./pin";
import { emitBroadcast, emitUserEvent } from "./events";
import { ALLOWED_ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_SIZE_BYTES, MAX_ATTACHMENTS_PER_REQUEST } from "./attachment-rules";
import {
  FT_BOSS_STATUSES,
  FT_MANAGER_STATUSES,
  FT_STAGE_POSITIONS,
  FT_STATUS_STAGE,
  ftAccess,
  ftHolds,
  type FtAccess,
  type FtAccessFacts,
  type FtActor,
  type FtStage,
  type FtStatus,
} from "./foreign-trade-rules";
import { FT_MESSAGE_MAX } from "./foreign-trade-validation";

// Foreign trade workflow (see the model comment in prisma/schema.prisma and lib/foreign-trade-rules.ts).
//
// Every state change is one transaction that (1) moves the order with a compare-and-set UPDATE on
// (id, status, version) -- the same technique as lib/workflow.ts -- so a double click or two approvers
// racing can only succeed once, (2) writes the history row (decision / message / quote), (3) writes the
// AuditLog row and (4) creates the notifications. Notifications and the live-update signal only go out after
// the transaction has committed.

export type FtResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

const NOT_FOUND = "Захиалга олдсонгүй";
const FORBIDDEN = "Эрхгүй үйлдэл";
const VERSION_CONFLICT = "Баримт бичиг шинэчлэгдсэн байна. Хуудсыг дахин ачаалж, дахин оролдоно уу";
const WRONG_STAGE = "Энэ үйлдэл одоогийн шатанд боломжгүй байна";
const ALREADY_DECIDED = "Энэ шатны шийдвэрийг өөр хэрэглэгч аль хэдийн гаргасан байна";
const AUDIT_ENTITY = "ForeignTradeOrder";

// --- actors and visibility --------------------------------------------------------------------------------

export async function loadActor(user: { id: string; role: string }): Promise<FtActor> {
  const rows = await prisma.approvalRoleAssignment.findMany({
    where: { userId: user.id, isActive: true, user: { isActive: true } },
    select: { role: true },
  });
  return { id: user.id, role: user.role, positions: rows.map((r) => r.role) };
}

/**
 * The database form of ftAccess(...).view: which orders a user may see at all. Anything else is answered with
 * "not found", exactly as if it did not exist.
 */
export function visibilityWhere(actor: FtActor): Prisma.ForeignTradeOrderWhereInput {
  if (actor.role === "ADMIN") return {};
  const or: Prisma.ForeignTradeOrderWhereInput[] = [];
  if (actor.role === "BOSS") or.push({ createdById: actor.id });
  if (actor.role === "MANAGER") or.push({ status: { not: "DRAFT" } });
  if (ftHolds(actor, "TECHNICAL")) or.push({ sharedWithTechnical: true });
  if (ftHolds(actor, "FINANCE")) or.push({ decisions: { some: { stage: "TECHNICAL", action: "APPROVE" } } });
  if (ftHolds(actor, "EXECUTIVE")) or.push({ decisions: { some: { stage: "FINANCE", action: "APPROVE" } } });
  if (actor.role === "CHIEF_ACCOUNTANT") or.push({ status: "APPROVED" });
  return or.length ? { OR: or } : { id: "__no_access__" };
}

interface FactsSource {
  createdById: string;
  status: string;
  sharedWithBoss: boolean;
  sharedWithTechnical: boolean;
  decisions: { stage: string; action: string }[];
}

function factsOf(o: FactsSource): FtAccessFacts {
  return {
    createdById: o.createdById,
    status: o.status as FtStatus,
    sharedWithBoss: o.sharedWithBoss,
    sharedWithTechnical: o.sharedWithTechnical,
    passedTechnical: o.decisions.some((d) => d.stage === "TECHNICAL" && d.action === "APPROVE"),
    passedFinance: o.decisions.some((d) => d.stage === "FINANCE" && d.action === "APPROVE"),
  };
}

const factsSelect = {
  id: true,
  orderNumber: true,
  createdById: true,
  status: true,
  version: true,
  cycle: true,
  sharedWithBoss: true,
  sharedWithTechnical: true,
  selectedQuoteId: true,
  decisions: { select: { stage: true, action: true } },
} satisfies Prisma.ForeignTradeOrderSelect;

/** The order plus the actor's access to it, or null when the actor may not see it. */
async function loadForAction(actor: FtActor, id: string) {
  const order = await prisma.foreignTradeOrder.findFirst({ where: { id, ...visibilityWhere(actor) }, select: factsSelect });
  if (!order) return null;
  return { order, access: ftAccess(factsOf(order), actor) };
}

// --- recipients -------------------------------------------------------------------------------------------

type Db = Prisma.TransactionClient | typeof prisma;

async function holdersOf(db: Db, positions: readonly string[]): Promise<string[]> {
  const rows = await db.approvalRoleAssignment.findMany({
    where: { role: { in: positions as ApprovalPosition[] }, isActive: true, user: { isActive: true } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

async function usersWithRole(db: Db, role: "MANAGER" | "CHIEF_ACCOUNTANT"): Promise<string[]> {
  const rows = await db.user.findMany({ where: { role, isActive: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function notify(
  tx: Prisma.TransactionClient,
  orderId: string,
  userIds: readonly string[],
  note: { type: NotificationType; title: string; body: string },
  excludeUserId?: string
): Promise<string[]> {
  const ids = [...new Set(userIds)].filter((id) => id !== excludeUserId);
  if (ids.length) {
    await tx.notification.createMany({ data: ids.map((userId) => ({ userId, relatedForeignTradeId: orderId, ...note })) });
  }
  return ids;
}

function signal(userIds: readonly string[]) {
  emitBroadcast({ type: "request-changed" });
  for (const id of userIds) emitUserEvent(id, { type: "notification" });
}

const audit = (tx: Prisma.TransactionClient, orderId: string, actorId: string, action: Prisma.AuditLogUncheckedCreateInput["action"], after?: unknown, before?: unknown) =>
  tx.auditLog.create({
    data: {
      entityType: AUDIT_ENTITY,
      entityId: orderId,
      action,
      actorId,
      beforeJson: before === undefined ? undefined : JSON.stringify(before),
      afterJson: after === undefined ? undefined : JSON.stringify(after),
    },
  });

/** Compare-and-set move of an order. Returns false when someone else got there first (or the version moved on). */
async function moveOrder(
  tx: Prisma.TransactionClient,
  id: string,
  from: readonly FtStatus[],
  expectedVersion: number,
  data: Prisma.ForeignTradeOrderUncheckedUpdateManyInput
): Promise<boolean> {
  const res = await tx.foreignTradeOrder.updateMany({
    where: { id, status: { in: [...from] }, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  return res.count === 1;
}

/** Why a compare-and-set failed: the order is no longer in the expected stage, or the caller's copy is stale. */
async function conflictOf(id: string, from: readonly FtStatus[]): Promise<{ ok: false; status: number; error: string }> {
  const now = await prisma.foreignTradeOrder.findUnique({ where: { id }, select: { status: true } });
  if (!now) return fail(404, NOT_FOUND);
  return fail(409, from.includes(now.status as FtStatus) ? VERSION_CONFLICT : ALREADY_DECIDED);
}

// --- numbering --------------------------------------------------------------------------------------------

async function nextNumber(tx: Prisma.TransactionClient, year: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`foreign-trade-seq:${year}`}))`;
  const last = await tx.foreignTradeOrder.aggregate({ where: { year }, _max: { sequence: true } });
  const sequence = (last._max.sequence ?? 0) + 1;
  return { sequence, orderNumber: `FT-${year}-${String(sequence).padStart(4, "0")}` };
}

// --- create / edit / submit (BOSS) ------------------------------------------------------------------------

export interface FtOrderInput {
  purpose?: string;
  items: { name: string; techSpec?: string; quantity: number; unit: string }[];
}

const itemRows = (items: FtOrderInput["items"]) =>
  items.map((it, i) => ({ lineNo: i + 1, name: it.name, techSpec: it.techSpec ?? null, quantity: new Prisma.Decimal(it.quantity), unit: it.unit }));

export async function createOrder(actor: FtActor, input: FtOrderInput, submit: boolean): Promise<FtResult<{ id: string; orderNumber: string }>> {
  if (actor.role !== "BOSS") return fail(403, "Зөвхөн цехийн дарга (BOSS) гадаад худалдааны захиалга үүсгэнэ");
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { departmentId: true } });
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { created, recipients } = await prisma.$transaction(async (tx) => {
        const { sequence, orderNumber } = await nextNumber(tx, year);
        const order = await tx.foreignTradeOrder.create({
          data: {
            orderNumber,
            year,
            sequence,
            createdById: actor.id,
            departmentId: user?.departmentId ?? null,
            purpose: input.purpose ?? null,
            status: submit ? "PENDING_MANAGER" : "DRAFT",
            submittedAt: submit ? new Date() : null,
            items: { create: itemRows(input.items) },
          },
          select: { id: true, orderNumber: true },
        });
        await audit(tx, order.id, actor.id, "CREATE", { orderNumber, items: input.items.length });
        let recipients: string[] = [];
        if (submit) {
          await audit(tx, order.id, actor.id, "SUBMIT", { status: "PENDING_MANAGER" });
          recipients = await notify(tx, order.id, await usersWithRole(tx, "MANAGER"), {
            type: "FOREIGN_TRADE_UPDATE",
            title: "Шинэ гадаад худалдааны захиалга",
            body: `№${orderNumber} захиалгад үнийн судалгаа хийнэ үү`,
          });
        }
        return { created: order, recipients };
      });
      signal(recipients);
      return { ok: true, data: created };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  return fail(500, "Захиалгын дугаар үүсгэхэд алдаа гарлаа");
}

export async function updateOrder(actor: FtActor, id: string, input: FtOrderInput, expectedVersion: number): Promise<FtResult<{ version: number }>> {
  const found = await loadForAction(actor, id);
  if (!found) return fail(404, NOT_FOUND);
  if (!found.access.isCreator) return fail(403, FORBIDDEN);
  if (!found.access.editOrder) return fail(409, WRONG_STAGE);

  const result = await prisma.$transaction(async (tx) => {
    if (!(await moveOrder(tx, id, FT_BOSS_STATUSES, expectedVersion, { purpose: input.purpose ?? null }))) return null;
    await tx.foreignTradeItem.deleteMany({ where: { orderId: id } });
    await tx.foreignTradeItem.createMany({ data: itemRows(input.items).map((r) => ({ ...r, orderId: id })) });
    await audit(tx, id, actor.id, "UPDATE", { items: input.items.length });
    return expectedVersion + 1;
  });
  if (result === null) return conflictOf(id, FT_BOSS_STATUSES);
  emitBroadcast({ type: "request-changed" });
  return { ok: true, data: { version: result } };
}

/** DRAFT -> PENDING_MANAGER, and RETURNED_TO_BOSS -> PENDING_MANAGER (a resubmission). */
export async function submitOrder(actor: FtActor, id: string, expectedVersion: number): Promise<FtResult<{ status: FtStatus }>> {
  const found = await loadForAction(actor, id);
  if (!found) return fail(404, NOT_FOUND);
  if (!found.access.isCreator) return fail(403, FORBIDDEN);
  if (!found.access.submitOrder) return fail(409, WRONG_STAGE);
  const resubmit = found.order.status === "RETURNED_TO_BOSS";

  const recipients = await prisma.$transaction(async (tx) => {
    // The previous supplier selection was made for the order as it was; it is cleared so the MANAGER records a new one.
    const moved = await moveOrder(tx, id, FT_BOSS_STATUSES, expectedVersion, {
      status: "PENDING_MANAGER",
      submittedAt: new Date(),
      selectedQuoteId: null,
      selectionRationale: null,
      selectedById: null,
      selectedAt: null,
    });
    if (!moved) return null;
    await audit(tx, id, actor.id, resubmit ? "RESUBMIT" : "SUBMIT", { status: "PENDING_MANAGER" }, { status: found.order.status });
    return notify(tx, id, await usersWithRole(tx, "MANAGER"), {
      type: "FOREIGN_TRADE_UPDATE",
      title: resubmit ? "Гадаад худалдааны захиалга дахин илгээгдлээ" : "Шинэ гадаад худалдааны захиалга",
      body: `№${found.order.orderNumber} захиалгад үнийн судалгаа хийнэ үү`,
    });
  });
  if (recipients === null) return conflictOf(id, FT_BOSS_STATUSES);
  signal(recipients);
  return { ok: true, data: { status: "PENDING_MANAGER" } };
}

// --- price research (MANAGER) -----------------------------------------------------------------------------

export interface FtQuoteInput {
  supplierName: string;
  country: string;
  currency: string;
  price: number;
  shippingCost: number;
  leadTimeDays?: number | null;
  warranty?: string;
  note?: string;
}

const quoteData = (q: FtQuoteInput) => ({
  supplierName: q.supplierName,
  country: q.country,
  currency: q.currency,
  price: new Prisma.Decimal(q.price),
  shippingCost: new Prisma.Decimal(q.shippingCost),
  leadTimeDays: q.leadTimeDays ?? null,
  warranty: q.warranty ?? null,
  note: q.note ?? null,
});

/**
 * Inside a transaction: takes the order's row lock and confirms it is still in a stage where the MANAGER works on it.
 * submitToTechnical's compare-and-set takes the same lock, so a quote can never be edited after the order has left the
 * MANAGER's hands, however the two requests interleave. Returns the live selection / sharing state, or null.
 */
async function lockManagerStage(tx: Prisma.TransactionClient, id: string) {
  const locked = await tx.foreignTradeOrder.updateMany({ where: { id, status: { in: [...FT_MANAGER_STATUSES] } }, data: { updatedAt: new Date() } });
  if (locked.count === 0) return null;
  return tx.foreignTradeOrder.findUniqueOrThrow({ where: { id }, select: { selectedQuoteId: true, sharedWithBoss: true, sharedWithTechnical: true } });
}

type FtFail = { ok: false; status: number; error: string };
type Loaded = NonNullable<Awaited<ReturnType<typeof loadForAction>>>;

async function requireManagerWork(actor: FtActor, id: string): Promise<{ error: FtFail; found?: undefined } | { error?: undefined; found: Loaded }> {
  const found = await loadForAction(actor, id);
  if (!found) return { error: fail(404, NOT_FOUND) };
  if (!found.access.isManager) return { error: fail(403, "Зөвхөн MANAGER үнийн судалгаа хийнэ") };
  if (!found.access.manageQuotes) return { error: fail(409, WRONG_STAGE) };
  return { found };
}

export async function addQuote(actor: FtActor, id: string, input: FtQuoteInput): Promise<FtResult<{ id: string }>> {
  const gate = await requireManagerWork(actor, id);
  if (gate.error) return gate.error;
  const quote = await prisma.$transaction(async (tx) => {
    if (!(await lockManagerStage(tx, id))) return null;
    const q = await tx.foreignTradeQuote.create({ data: { orderId: id, createdById: actor.id, ...quoteData(input) }, select: { id: true } });
    await audit(tx, id, actor.id, "FT_QUOTE_ADD", { quoteId: q.id, ...input });
    return q;
  });
  if (!quote) return fail(409, WRONG_STAGE);
  emitBroadcast({ type: "request-changed" });
  return { ok: true, data: quote };
}

export async function updateQuote(actor: FtActor, id: string, quoteId: string, input: FtQuoteInput): Promise<FtResult<{ selectionCleared: boolean }>> {
  const gate = await requireManagerWork(actor, id);
  if (gate.error) return gate.error;
  const result = await prisma.$transaction(async (tx) => {
    const live = await lockManagerStage(tx, id);
    if (!live) return "WRONG_STAGE" as const;
    const existing = await tx.foreignTradeQuote.findFirst({ where: { id: quoteId, orderId: id } });
    if (!existing) return null;
    await tx.foreignTradeQuote.update({ where: { id: quoteId }, data: quoteData(input) });
    // A selection was recorded for the offer as it was: changing the offer withdraws it.
    const wasSelected = live.selectedQuoteId === quoteId;
    if (wasSelected) {
      await tx.foreignTradeOrder.update({ where: { id }, data: { selectedQuoteId: null, selectionRationale: null, selectedById: null, selectedAt: null } });
    }
    await audit(tx, id, actor.id, "FT_QUOTE_UPDATE", { quoteId, ...input, selectionCleared: wasSelected }, { price: existing.price.toString(), shippingCost: existing.shippingCost.toString(), currency: existing.currency });
    return wasSelected;
  });
  if (result === "WRONG_STAGE") return fail(409, WRONG_STAGE);
  if (result === null) return fail(404, "Нийлүүлэгчийн санал олдсонгүй");
  emitBroadcast({ type: "request-changed" });
  return { ok: true, data: { selectionCleared: result } };
}

export async function deleteQuote(actor: FtActor, id: string, quoteId: string): Promise<FtResult<{ deleted: true }>> {
  const gate = await requireManagerWork(actor, id);
  if (gate.error) return gate.error;
  const files = await prisma.foreignTradeAttachment.findMany({ where: { quoteId, orderId: id }, select: { storageKey: true } });
  const ok = await prisma.$transaction(async (tx) => {
    const live = await lockManagerStage(tx, id);
    if (!live) return "WRONG_STAGE" as const;
    if (live.selectedQuoteId === quoteId) return "SELECTED" as const;
    const existing = await tx.foreignTradeQuote.findFirst({ where: { id: quoteId, orderId: id } });
    if (!existing) return false;
    await tx.foreignTradeQuote.delete({ where: { id: quoteId } });
    await audit(tx, id, actor.id, "FT_QUOTE_DELETE", undefined, { quoteId, supplierName: existing.supplierName, price: existing.price.toString(), currency: existing.currency });
    return true;
  });
  if (ok === "WRONG_STAGE") return fail(409, WRONG_STAGE);
  if (ok === "SELECTED") return fail(409, "Сонгогдсон нийлүүлэгчийн саналыг устгах боломжгүй. Эхлээд өөр нийлүүлэгч сонгоно уу");
  if (!ok) return fail(404, "Нийлүүлэгчийн санал олдсонгүй");
  for (const f of files) await storage.delete(f.storageKey).catch(() => {});
  emitBroadcast({ type: "request-changed" });
  return { ok: true, data: { deleted: true } };
}

/** The MANAGER presents the price research to the BOSS, to technical review, or both. It never replaces an approval. */
export async function shareResearch(actor: FtActor, id: string, targets: { boss?: boolean; technical?: boolean }): Promise<FtResult<{ sharedWithBoss: boolean; sharedWithTechnical: boolean }>> {
  const gate = await requireManagerWork(actor, id);
  if (gate.error) return gate.error;
  const { order } = gate.found;

  const out = await prisma.$transaction(async (tx) => {
    if (!(await lockManagerStage(tx, id))) return null;
    const updated = await tx.foreignTradeOrder.update({
      where: { id },
      data: { ...(targets.boss ? { sharedWithBoss: true } : {}), ...(targets.technical ? { sharedWithTechnical: true } : {}) },
      select: { sharedWithBoss: true, sharedWithTechnical: true },
    });
    await audit(tx, id, actor.id, "FT_SHARE", { boss: !!targets.boss, technical: !!targets.technical });
    const recipients: string[] = [];
    // Only people who gain access now are told: this is a presentation, not an approval request.
    if (targets.boss && !order.sharedWithBoss) {
      recipients.push(...(await notify(tx, id, [order.createdById], { type: "FOREIGN_TRADE_UPDATE", title: "Үнийн судалгаа танилцууллаа", body: `№${order.orderNumber} захиалгын нийлүүлэгчдийн үнийн судалгааг харна уу` })));
    }
    if (targets.technical && !order.sharedWithTechnical) {
      recipients.push(...(await notify(tx, id, await holdersOf(tx, FT_STAGE_POSITIONS.TECHNICAL), { type: "FOREIGN_TRADE_UPDATE", title: "Үнийн судалгаа танилцууллаа", body: `№${order.orderNumber} захиалгын нийлүүлэгчдийн үнийн судалгааг харна уу` })));
    }
    return { updated, recipients };
  });
  if (!out) return fail(409, WRONG_STAGE);
  signal(out.recipients);
  return { ok: true, data: out.updated };
}

/** The MANAGER records the supplier agreed in the discussion, with the grounds. The record is audited. */
export async function selectSupplier(actor: FtActor, id: string, quoteId: string, rationale: string): Promise<FtResult<{ quoteId: string }>> {
  const gate = await requireManagerWork(actor, id);
  if (gate.error) return gate.error;
  const result = await prisma.$transaction(async (tx) => {
    const live = await lockManagerStage(tx, id);
    if (!live) return "WRONG_STAGE" as const;
    const quote = await tx.foreignTradeQuote.findFirst({ where: { id: quoteId, orderId: id } });
    if (!quote) return null;
    await tx.foreignTradeOrder.update({ where: { id }, data: { selectedQuoteId: quoteId, selectionRationale: rationale, selectedById: actor.id, selectedAt: new Date() } });
    await audit(
      tx,
      id,
      actor.id,
      "FT_SELECT_SUPPLIER",
      { quoteId, supplierName: quote.supplierName, price: quote.price.toString(), currency: quote.currency, rationale },
      { quoteId: live.selectedQuoteId }
    );
    return quoteId;
  });
  if (result === "WRONG_STAGE") return fail(409, WRONG_STAGE);
  if (result === null) return fail(404, "Нийлүүлэгчийн санал олдсонгүй");
  emitBroadcast({ type: "request-changed" });
  return { ok: true, data: { quoteId: result } };
}

/** MANAGER -> technical review. Needs a recorded supplier choice, and somebody who can decide. */
export async function submitToTechnical(actor: FtActor, id: string, expectedVersion: number): Promise<FtResult<{ status: FtStatus }>> {
  const gate = await requireManagerWork(actor, id);
  if (gate.error) return gate.error;
  const { order } = gate.found;
  if (!order.selectedQuoteId) return fail(409, "Техникийн хяналтад илгээхээс өмнө сонгосон нийлүүлэгч болон үндэслэлийг бүртгэнэ үү");
  const approvers = await holdersOf(prisma, FT_STAGE_POSITIONS.TECHNICAL);
  if (approvers.length === 0) return fail(409, "Техникийн хяналтад хариуцагч (Үйлдвэр хариуцсан захирал / Ерөнхий инженер) томилогдоогүй байна");

  const recipients = await prisma.$transaction(async (tx) => {
    const moved = await moveOrder(tx, id, FT_MANAGER_STATUSES, expectedVersion, { status: "PENDING_TECHNICAL", cycle: { increment: 1 }, sharedWithTechnical: true });
    if (!moved) return null;
    await audit(tx, id, actor.id, "SUBMIT", { status: "PENDING_TECHNICAL", selectedQuoteId: order.selectedQuoteId }, { status: order.status });
    // Both technical positions are asked; whichever decides first ends the stage (see decide()).
    return notify(tx, id, await holdersOf(tx, FT_STAGE_POSITIONS.TECHNICAL), {
      type: "FOREIGN_TRADE_APPROVAL",
      title: "Техникийн хяналтын шийдвэр шаардлагатай",
      body: `№${order.orderNumber} захиалгыг хянаж батлах эсвэл буцаана уу`,
    });
  });
  if (recipients === null) return conflictOf(id, FT_MANAGER_STATUSES);
  signal(recipients);
  return { ok: true, data: { status: "PENDING_TECHNICAL" } };
}

// --- approvals --------------------------------------------------------------------------------------------

export interface FtDecisionInput {
  action: "APPROVE" | "RETURN";
  pin?: string;
  reason?: string;
  expectedVersion: number;
}

/** Where an approval / a return of each stage leads. */
const FORWARD: Record<FtStage, FtStatus> = { TECHNICAL: "PENDING_FINANCE", FINANCE: "PENDING_EXECUTIVE", EXECUTIVE: "APPROVED" };
const BACKWARD: Record<FtStage, FtStatus> = { TECHNICAL: "RETURNED_TO_MANAGER", FINANCE: "RETURNED_TO_BOSS", EXECUTIVE: "RETURNED_TO_BOSS" };
const NEXT_APPROVERS: Partial<Record<FtStage, readonly string[]>> = { TECHNICAL: FT_STAGE_POSITIONS.FINANCE, FINANCE: FT_STAGE_POSITIONS.EXECUTIVE };

/**
 * One decision of the current stage. Technical review is an OR: whichever of its two positions decides first moves the
 * order on, and the other finds the stage already decided. Approving needs the approver's PIN (lib/pin.ts); returning
 * needs a reason. The stage, the holder and the version are all re-checked inside the transaction.
 */
export async function decide(actor: FtActor, id: string, input: FtDecisionInput): Promise<FtResult<{ status: FtStatus }>> {
  const found = await loadForAction(actor, id);
  if (!found) return fail(404, NOT_FOUND);
  const { order, access } = found;
  const stage = FT_STATUS_STAGE[order.status as FtStatus];
  if (!stage) return fail(409, WRONG_STAGE);
  if (!access.decisionStage) return fail(403, "Та энэ шатны шийдвэр гаргах эрхгүй байна");
  if (input.action === "RETURN" && !input.reason) return fail(400, "Буцаах шалтгаанаа бичнэ үү");

  if (input.action === "APPROVE") {
    const next = NEXT_APPROVERS[stage];
    if (next && (await holdersOf(prisma, next)).length === 0) {
      return fail(409, "Дараагийн шатны хариуцагч томилогдоогүй тул баталгаажуулах боломжгүй");
    }
    const pin = await verifyPin(actor.id, input.pin ?? "");
    if (!pin.ok) return fail(pin.status, pin.error);
  }

  const nextStatus = input.action === "APPROVE" ? FORWARD[stage] : BACKWARD[stage];
  const from: FtStatus[] = [order.status as FtStatus];

  let recipients: string[];
  try {
    const out = await prisma.$transaction(async (tx) => {
      // The holder is re-read here: a position handed over between the check above and now must not let the old holder in.
      const stillHolds = await tx.approvalRoleAssignment.count({
        where: { userId: actor.id, isActive: true, role: { in: [...FT_STAGE_POSITIONS[stage]] as ApprovalPosition[] }, user: { isActive: true } },
      });
      if (stillHolds === 0) return "NOT_HOLDER" as const;

      const moved = await moveOrder(tx, id, from, input.expectedVersion, { status: nextStatus, ...(nextStatus === "APPROVED" ? { approvedAt: new Date() } : {}) });
      if (!moved) return null;

      await tx.foreignTradeDecision.create({
        data: { orderId: id, cycle: order.cycle, stage, action: input.action, decidedById: actor.id, reason: input.reason ?? null, selectedQuoteId: order.selectedQuoteId },
      });
      await audit(tx, id, actor.id, input.action, { stage, cycle: order.cycle, status: nextStatus, reason: input.reason ?? null, selectedQuoteId: order.selectedQuoteId }, { status: order.status });

      // The other holders' "decision needed" notices for this stage are settled now.
      await tx.notification.updateMany({
        where: { relatedForeignTradeId: id, type: "FOREIGN_TRADE_APPROVAL", isRead: false, userId: { not: actor.id } },
        data: { isRead: true },
      });

      const managers = await usersWithRole(tx, "MANAGER");
      const num = order.orderNumber;
      if (input.action === "APPROVE") {
        if (stage === "TECHNICAL") {
          return notify(tx, id, await holdersOf(tx, FT_STAGE_POSITIONS.FINANCE), { type: "FOREIGN_TRADE_APPROVAL", title: "Санхүүгийн хяналт шаардлагатай", body: `№${num} захиалга техникийн хяналтыг давлаа. Санхүүгийн шийдвэр гаргана уу` });
        }
        if (stage === "FINANCE") {
          return notify(tx, id, await holdersOf(tx, FT_STAGE_POSITIONS.EXECUTIVE), { type: "FOREIGN_TRADE_APPROVAL", title: "Эцсийн баталгаа шаардлагатай", body: `№${num} захиалга санхүүгийн хяналтыг давлаа. Эцсийн шийдвэр гаргана уу` });
        }
        return notify(tx, id, await usersWithRole(tx, "CHIEF_ACCOUNTANT"), { type: "FOREIGN_TRADE_UPDATE", title: "Гадаад худалдааны захиалга батлагдлаа", body: `№${num} захиалга эцэслэн батлагдлаа. Санхүүгийн хэлтэс хүлээн авна уу` });
      }
      // A return tells whoever has to act on it next, with the reason in the notice.
      const reasonText = `№${num}: ${input.reason}`;
      const who = stage === "TECHNICAL" ? managers : [order.createdById, ...managers];
      return notify(tx, id, who, { type: "FOREIGN_TRADE_UPDATE", title: "Гадаад худалдааны захиалга буцлаа", body: reasonText }, actor.id);
    });
    if (out === "NOT_HOLDER") return fail(403, "Та энэ шатны шийдвэр гаргах эрхгүй байна");
    if (out === null) return conflictOf(id, from);
    recipients = out;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return fail(409, ALREADY_DECIDED);
    throw err;
  }
  signal(recipients);
  return { ok: true, data: { status: nextStatus } };
}

// --- discussion -------------------------------------------------------------------------------------------

export interface IncomingFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

function checkFiles(files: IncomingFile[]): string | null {
  if (files.length > MAX_ATTACHMENTS_PER_REQUEST) return `Нэг удаад хамгийн ихдээ ${MAX_ATTACHMENTS_PER_REQUEST} файл хавсаргана`;
  for (const f of files) {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(f.mimeType as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number])) return `Дэмжигдэхгүй файлын төрөл: ${f.fileName} (${f.mimeType})`;
    if (f.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) return `Файл хэт том байна (10 MB-с ихгүй байх ёстой): ${f.fileName}`;
    if (f.sizeBytes === 0) return `Хоосон файл хавсаргах боломжгүй: ${f.fileName}`;
  }
  return null;
}

/** Stores the files first (a row must never point at a missing file); the caller deletes them if its transaction fails. */
async function storeFiles(orderId: string, files: IncomingFile[]): Promise<{ key: string; file: IncomingFile }[]> {
  const written: { key: string; file: IncomingFile }[] = [];
  try {
    for (const file of files) {
      const key = `foreign-trade/${orderId}/${randomUUID()}`;
      await storage.put(key, file.buffer);
      written.push({ key, file });
    }
  } catch (err) {
    for (const w of written) await storage.delete(w.key).catch(() => {});
    throw err;
  }
  return written;
}

const attachmentRow = (orderId: string, actorId: string, w: { key: string; file: IncomingFile }, link: { quoteId?: string; messageId?: string }) => ({
  orderId,
  ...link,
  fileName: w.file.fileName,
  storageKey: w.key,
  mimeType: w.file.mimeType,
  sizeBytes: w.file.sizeBytes,
  uploadedById: actorId,
});

export async function postMessage(actor: FtActor, id: string, input: { body: string; quoteId?: string }, files: IncomingFile[]): Promise<FtResult<{ id: string }>> {
  const found = await loadForAction(actor, id);
  if (!found) return fail(404, NOT_FOUND);
  if (!found.access.postMessage) return fail(403, "Та энэ захиалгын хэлэлцүүлэгт оролцох эрхгүй байна");
  const body = input.body.trim();
  if (!body && files.length === 0) return fail(400, "Мессеж бичих эсвэл файл хавсаргана уу");
  if (body.length > FT_MESSAGE_MAX) return fail(400, `Мессеж ${FT_MESSAGE_MAX} тэмдэгтээс хэтрэхгүй байх ёстой`);
  const fileError = checkFiles(files);
  if (fileError) return fail(400, fileError);
  if (input.quoteId) {
    if (!found.access.seeQuotes) return fail(400, "Нийлүүлэгчийн саналыг харах эрхгүй байна");
    if (!(await prisma.foreignTradeQuote.findFirst({ where: { id: input.quoteId, orderId: id }, select: { id: true } }))) return fail(400, "Нийлүүлэгчийн санал олдсонгүй");
  }

  const written = await storeFiles(id, files);
  try {
    const out = await prisma.$transaction(async (tx) => {
      const author = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true } });
      const msg = await tx.foreignTradeMessage.create({ data: { orderId: id, authorId: actor.id, body, quoteId: input.quoteId ?? null }, select: { id: true } });
      for (const w of written) await tx.foreignTradeAttachment.create({ data: attachmentRow(id, actor.id, w, { messageId: msg.id }) });
      await audit(tx, id, actor.id, "FT_MESSAGE", { messageId: msg.id, quoteId: input.quoteId ?? null, files: written.map((w) => w.file.fileName), length: body.length });

      // Discussion notices go to the four participants only (BOSS, MANAGERs, the two technical positions): never to the
      // finance director, the executive director or the finance department, and never to the author.
      const participants = [found.order.createdById, ...(await usersWithRole(tx, "MANAGER"))];
      if (found.order.sharedWithTechnical) participants.push(...(await holdersOf(tx, FT_STAGE_POSITIONS.TECHNICAL)));
      const preview = body ? (body.length > 120 ? `${body.slice(0, 117)}...` : body) : `${written.length} файл хавсаргав`;
      const recipients = await notify(tx, id, participants, { type: "FOREIGN_TRADE_DISCUSSION", title: `№${found.order.orderNumber} хэлэлцүүлэгт шинэ мессеж`, body: `${author.name}: ${preview}` }, actor.id);
      return { id: msg.id, recipients };
    });
    signal(out.recipients);
    return { ok: true, data: { id: out.id } };
  } catch (err) {
    for (const w of written) await storage.delete(w.key).catch(() => {});
    throw err;
  }
}

// --- attachments on the order / on a quote ----------------------------------------------------------------

export async function addAttachments(actor: FtActor, id: string, files: IncomingFile[], quoteId?: string): Promise<FtResult<{ id: string; fileName: string }[]>> {
  if (files.length === 0) return fail(400, "Файл сонгоогүй байна");
  const found = await loadForAction(actor, id);
  if (!found) return fail(404, NOT_FOUND);
  if (quoteId) {
    // a supplier's quotation document: the MANAGER's price research
    if (!found.access.isManager) return fail(403, "Зөвхөн MANAGER үнийн саналын баримт хавсаргана");
    if (!found.access.manageQuotes) return fail(409, WRONG_STAGE);
    if (!(await prisma.foreignTradeQuote.findFirst({ where: { id: quoteId, orderId: id }, select: { id: true } }))) return fail(404, "Нийлүүлэгчийн санал олдсонгүй");
  } else {
    if (!found.access.isCreator) return fail(403, "Зөвхөн захиалга үүсгэсэн цехийн дарга файл хавсаргана");
    if (!found.access.editOrder) return fail(409, WRONG_STAGE);
  }
  const fileError = checkFiles(files);
  if (fileError) return fail(400, fileError);

  const written = await storeFiles(id, files);
  try {
    const rows = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const w of written) created.push(await tx.foreignTradeAttachment.create({ data: attachmentRow(id, actor.id, w, quoteId ? { quoteId } : {}), select: { id: true, fileName: true } }));
      await audit(tx, id, actor.id, "ATTACHMENT_UPLOAD", { files: created.map((r) => r.fileName), quoteId: quoteId ?? null });
      return created;
    });
    emitBroadcast({ type: "request-changed" });
    return { ok: true, data: rows };
  } catch (err) {
    for (const w of written) await storage.delete(w.key).catch(() => {});
    throw err;
  }
}

/** A file is as visible as the part of the order it belongs to: the order, a quote (price research) or a discussion message. */
export async function getAttachmentFile(actor: FtActor, id: string, attachmentId: string): Promise<FtResult<{ fileName: string; mimeType: string; data: Buffer }>> {
  const found = await loadForAction(actor, id);
  if (!found) return fail(404, "Хавсралт олдсонгүй");
  const att = await prisma.foreignTradeAttachment.findFirst({ where: { id: attachmentId, orderId: id } });
  if (!att) return fail(404, "Хавсралт олдсонгүй");
  const allowed = att.quoteId ? found.access.seeQuotes : att.messageId ? found.access.readDiscussion : true;
  if (!allowed) return fail(404, "Хавсралт олдсонгүй");
  const data = await storage.get(att.storageKey);
  if (!data) return fail(404, "Файл олдсонгүй");
  return { ok: true, data: { fileName: att.fileName, mimeType: att.mimeType, data } };
}

// --- reading ----------------------------------------------------------------------------------------------

export interface FtPerson {
  id: string;
  name: string;
  title: string | null;
}
export interface FtAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
}
export interface FtQuoteView {
  id: string;
  supplierName: string;
  country: string;
  currency: string;
  price: number;
  shippingCost: number;
  leadTimeDays: number | null;
  warranty: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string;
  attachments: FtAttachmentView[];
}
export interface FtOrderView {
  id: string;
  orderNumber: string;
  status: FtStatus;
  version: number;
  cycle: number;
  purpose: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  createdBy: FtPerson;
  departmentName: string | null;
  sharedWithBoss: boolean;
  sharedWithTechnical: boolean;
  items: { id: string; lineNo: number; name: string; techSpec: string | null; quantity: number; unit: string }[];
  /** null when the viewer may not see the price research yet */
  quotes: FtQuoteView[] | null;
  selection: { quoteId: string; rationale: string; by: string | null; at: string | null } | null;
  decisions: { id: string; cycle: number; stage: FtStage; action: "APPROVE" | "RETURN"; reason: string | null; decidedBy: FtPerson; createdAt: string }[];
  /** null when the viewer may not read the discussion */
  messages: { id: string; body: string; quoteId: string | null; author: FtPerson & { role: string }; createdAt: string; attachments: FtAttachmentView[] }[] | null;
  attachments: FtAttachmentView[];
  access: FtAccess;
  waitingOnMe: boolean;
}

const personSelect = { id: true, name: true, title: true } as const;
const num = (d: Prisma.Decimal) => Number(d);

const attachmentView = (a: { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: Date; uploadedBy: { name: string } }): FtAttachmentView => ({
  id: a.id,
  fileName: a.fileName,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  uploadedAt: a.uploadedAt.toISOString(),
  uploadedBy: a.uploadedBy.name,
});

function waitingOn(access: FtAccess): boolean {
  return access.decisionStage !== null || access.manageQuotes || access.editOrder;
}

export async function getOrder(actor: FtActor, id: string): Promise<FtOrderView | null> {
  const o = await prisma.foreignTradeOrder.findFirst({
    where: { id, ...visibilityWhere(actor) },
    include: {
      createdBy: { select: personSelect },
      department: { select: { name: true } },
      selectedBy: { select: { name: true } },
      items: { orderBy: { lineNo: "asc" } },
      quotes: { orderBy: { createdAt: "asc" }, include: { createdBy: { select: { name: true } }, attachments: { orderBy: { uploadedAt: "asc" }, include: { uploadedBy: { select: { name: true } } } } } },
      decisions: { orderBy: { createdAt: "asc" }, include: { decidedBy: { select: personSelect } } },
      messages: { orderBy: { createdAt: "asc" }, take: 1000, include: { author: { select: { ...personSelect, role: true } }, attachments: { orderBy: { uploadedAt: "asc" }, include: { uploadedBy: { select: { name: true } } } } } },
      attachments: { where: { quoteId: null, messageId: null }, orderBy: { uploadedAt: "asc" }, include: { uploadedBy: { select: { name: true } } } },
    },
  });
  if (!o) return null;
  const access = ftAccess(factsOf(o), actor);

  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status as FtStatus,
    version: o.version,
    cycle: o.cycle,
    purpose: o.purpose,
    createdAt: o.createdAt.toISOString(),
    submittedAt: o.submittedAt?.toISOString() ?? null,
    approvedAt: o.approvedAt?.toISOString() ?? null,
    createdBy: o.createdBy,
    departmentName: o.department?.name ?? null,
    sharedWithBoss: o.sharedWithBoss,
    sharedWithTechnical: o.sharedWithTechnical,
    items: o.items.map((i) => ({ id: i.id, lineNo: i.lineNo, name: i.name, techSpec: i.techSpec, quantity: num(i.quantity), unit: i.unit })),
    quotes: access.seeQuotes
      ? o.quotes.map((q) => ({
          id: q.id,
          supplierName: q.supplierName,
          country: q.country,
          currency: q.currency,
          price: num(q.price),
          shippingCost: num(q.shippingCost),
          leadTimeDays: q.leadTimeDays,
          warranty: q.warranty,
          note: q.note,
          createdAt: q.createdAt.toISOString(),
          createdBy: q.createdBy.name,
          attachments: q.attachments.map(attachmentView),
        }))
      : null,
    selection:
      access.seeQuotes && o.selectedQuoteId
        ? { quoteId: o.selectedQuoteId, rationale: o.selectionRationale ?? "", by: o.selectedBy?.name ?? null, at: o.selectedAt?.toISOString() ?? null }
        : null,
    decisions: o.decisions.map((d) => ({ id: d.id, cycle: d.cycle, stage: d.stage, action: d.action, reason: d.reason, decidedBy: d.decidedBy, createdAt: d.createdAt.toISOString() })),
    messages: access.readDiscussion
      ? o.messages.map((m) => ({
          id: m.id,
          body: m.body,
          quoteId: access.seeQuotes ? m.quoteId : null,
          author: m.author,
          createdAt: m.createdAt.toISOString(),
          attachments: m.attachments.map(attachmentView),
        }))
      : null,
    attachments: o.attachments.map(attachmentView),
    access,
    waitingOnMe: waitingOn(access),
  };
}

export interface FtListRow {
  id: string;
  orderNumber: string;
  status: FtStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  firstItem: string;
  itemCount: number;
  waitingOnMe: boolean;
}

export async function listOrders(actor: FtActor, filters: { q?: string; status?: string; waiting?: boolean }): Promise<FtListRow[]> {
  const and: Prisma.ForeignTradeOrderWhereInput[] = [visibilityWhere(actor)];
  if (filters.status) and.push({ status: filters.status as FtStatus });
  if (filters.q) {
    and.push({ OR: [{ orderNumber: { contains: filters.q, mode: "insensitive" } }, { items: { some: { name: { contains: filters.q, mode: "insensitive" } } } }] });
  }
  const rows = await prisma.foreignTradeOrder.findMany({
    where: { AND: and },
    orderBy: { updatedAt: "desc" },
    take: 300,
    select: {
      ...factsSelect,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { name: true } },
      items: { orderBy: { lineNo: "asc" }, select: { name: true } },
    },
  });
  const out = rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    status: r.status as FtStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: r.createdBy.name,
    firstItem: r.items[0]?.name ?? "",
    itemCount: r.items.length,
    waitingOnMe: waitingOn(ftAccess(factsOf(r), actor)),
  }));
  return filters.waiting ? out.filter((r) => r.waitingOnMe) : out;
}

/** Of these order ids, those the actor may open (used to keep notifications from linking to orders they cannot see). */
export async function visibleOrderIds(actor: FtActor, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.foreignTradeOrder.findMany({ where: { id: { in: ids }, ...visibilityWhere(actor) }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
