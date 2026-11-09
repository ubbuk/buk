import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { emitBroadcast, emitUserEvent } from "./events";

// Controlled handover of PENDING executive responsibility.
//
// A request's executive is the assignee of its EXECUTIVE_APPROVAL step, fixed when the
// request was created. Replacing the EXECUTIVE_DIRECTOR position (or deactivating the
// executive) therefore never moves work by itself: the old assignee would stay
// responsible, and a deactivated one would leave requests nobody can decide. This module
// lets an ADMIN move that responsibility, explicitly and with a reason, to the CURRENT
// EXECUTIVE_DIRECTOR position holder only -- never to an arbitrary DIRECTOR. The ADMIN
// never gains approval authority: only the step's assignee (a DIRECTOR) can decide, and
// the new executive verifies their own PIN for every decision as before.
//
// Nothing historical changes: executive decisions, allocations, procurement requests and
// the audit trail stay as they were (decidedById still names whoever decided). Each moved
// request gets one immutable ExecutiveApprovalReassignment row (old assignee, new
// assignee, administrator, reason, time, the step/request status at that moment).

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export type HandoverFailure = { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): HandoverFailure => ({ ok: false, status, error, code });

const TERMINAL = ["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "ACCOUNTING_COMPLETED", "PENDING_ACCOUNTING"];

/** One handover at a time, and never concurrently with a change of the EXECUTIVE_DIRECTOR position. */
export async function lockExecutivePosition(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('executive-position'))`;
}

export async function currentExecutiveHolder(db: Db) {
  const row = await db.approvalRoleAssignment.findFirst({
    where: { role: "EXECUTIVE_DIRECTOR", isActive: true },
    include: { user: { select: { id: true, name: true, isActive: true, role: true } } },
  });
  return row?.user ?? null;
}

/** Eligible = active DIRECTOR who currently holds the EXECUTIVE_DIRECTOR position and has an approval PIN. */
export async function validateNewExecutive(db: Db, userId: string): Promise<HandoverFailure | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true, name: true } });
  if (!user) return fail(404, "Хэрэглэгч олдсонгүй");
  if (!user.isActive) return fail(400, "Идэвхгүй хэрэглэгчид шилжүүлэх боломжгүй");
  if (user.role !== "DIRECTOR") return fail(400, "Зөвхөн «Захирал» (DIRECTOR) эрхтэй хэрэглэгчид шилжүүлнэ");
  const holder = await currentExecutiveHolder(db);
  if (holder?.id !== userId) {
    return fail(409, "Энэ хэрэглэгч «Гүйцэтгэх захирал» албан тушаалд томилогдоогүй байна. Эхлээд Админ → Албан тушаал дээр томилно уу", "NOT_POSITION_HOLDER");
  }
  const pin = await db.approvalPinCredential.findUnique({ where: { userId }, select: { id: true } });
  if (!pin) return fail(409, "Шинэ гүйцэтгэх захирал баталгаажуулах PIN-ээ тохируулаагүй байна. Эхлээд Тохиргоо хэсэгт PIN үүсгэнэ үү", "NO_PIN");
  return null;
}

export interface HandoverRequestRow {
  requestId: string;
  requestNumber: string;
  requestStatus: string;
  stepStatus: string;
  /** INITIAL_PENDING: the executive has not decided yet. DEFERRED_OPEN: approved, quantities may still be deferred. */
  stage: "INITIAL_PENDING" | "DEFERRED_OPEN";
}

interface Candidate extends HandoverRequestRow {
  stepId: string;
}

/**
 * Requests whose executive step is assigned to `fromUserId` and where the executive can still
 * (or must) act: not decided yet, or approved and waiting in procurement (deferred quantities).
 */
async function candidates(db: Db, fromUserId: string, requestIds?: string[]): Promise<Candidate[]> {
  const rows = await db.materialRequest.findMany({
    where: {
      ...(requestIds ? { id: { in: requestIds } } : {}),
      approvalSteps: { some: { type: "EXECUTIVE_APPROVAL", assignedUserId: fromUserId } },
    },
    select: { id: true, requestNumber: true, status: true, approvalSteps: { where: { type: "EXECUTIVE_APPROVAL" }, select: { id: true, status: true, assignedUserId: true } } },
    orderBy: { id: "asc" },
  });
  const out: Candidate[] = [];
  for (const r of rows) {
    const step = r.approvalSteps[0];
    if (!step || step.assignedUserId !== fromUserId) continue;
    if (step.status === "APPROVED") {
      if (r.status !== "PENDING_PROCUREMENT") continue;
      out.push({ stepId: step.id, requestId: r.id, requestNumber: r.requestNumber, requestStatus: r.status, stepStatus: step.status, stage: "DEFERRED_OPEN" });
    } else if (step.status === "PENDING" || step.status === "REJECTED") {
      if (TERMINAL.includes(r.status) || r.status === "DRAFT") continue;
      out.push({ stepId: step.id, requestId: r.id, requestNumber: r.requestNumber, requestStatus: r.status, stepStatus: step.status, stage: "INITIAL_PENDING" });
    }
  }
  return out;
}

export interface ExecutiveHandoverPreview {
  fromUser: { id: string; name: string; isActive: boolean; role: string } | null;
  toUser: { id: string; name: string } | null;
  currentHolder: { id: string; name: string } | null;
  /** problem with the chosen new executive (shown, never applied) */
  newExecutiveProblem: string | null;
  /** problem with the chosen previous executive */
  fromProblem: string | null;
  affectedRequests: number;
  initialPending: number;
  deferredOpen: number;
  requests: HandoverRequestRow[];
}

const PREVIEW_LIMIT = 200;

function validateFrom(fromUserId: string, toUserId: string | null): string | null {
  if (toUserId && fromUserId === toUserId) return "Өмнөх болон шинэ гүйцэтгэх захирал ижил байна";
  return null;
}

/** Read-only: what a handover from `fromUserId` to `toUserId` would move. */
export async function previewExecutiveHandover(fromUserId: string, toUserId: string | null, db: Db = prisma): Promise<ExecutiveHandoverPreview> {
  const [fromUser, toUser, holder, toProblem, rows] = await Promise.all([
    db.user.findUnique({ where: { id: fromUserId }, select: { id: true, name: true, isActive: true, role: true } }),
    toUserId ? db.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true } }) : null,
    currentExecutiveHolder(db),
    toUserId ? validateNewExecutive(db, toUserId) : null,
    candidates(db, fromUserId),
  ]);
  return {
    fromUser,
    toUser,
    currentHolder: holder ? { id: holder.id, name: holder.name } : null,
    newExecutiveProblem: toProblem?.error ?? null,
    fromProblem: fromUser ? validateFrom(fromUserId, toUserId) : "Өмнөх захирал олдсонгүй",
    affectedRequests: rows.length,
    initialPending: rows.filter((r) => r.stage === "INITIAL_PENDING").length,
    deferredOpen: rows.filter((r) => r.stage === "DEFERRED_OPEN").length,
    requests: rows.slice(0, PREVIEW_LIMIT).map((r) => ({ requestId: r.requestId, requestNumber: r.requestNumber, requestStatus: r.requestStatus, stepStatus: r.stepStatus, stage: r.stage })),
  };
}

export interface ExecutiveHandoverInput {
  fromUserId: string;
  toUserId: string;
  actorId: string;
  reason: string;
  /** Idempotency key: a resubmission of the same confirmed handover is acknowledged, not applied twice. */
  clientRequestId: string;
  /** The number of requests the admin reviewed; a different current count means the work changed under them. */
  expectedRequests: number;
}

export interface ExecutiveHandoverSummary {
  fromUserId: string;
  toUserId: string;
  requestIds: string[];
  initialPending: number;
  deferredOpen: number;
}

class Abort extends Error {
  constructor(readonly failure: HandoverFailure) {
    super(failure.error);
  }
}

/**
 * Moves the pending executive responsibility in one transaction:
 *   executive-position lock -> ADMIN + new-executive checks -> the request rows FOR UPDATE in id
 *   order (the same lock every quantity decision and purchase takes) -> re-read under the locks
 *   -> move each step with a conditional UPDATE (only while it is still the old assignee's;
 *   its status is read back from that very statement) -> immutable rows + audit.
 * The initial approval path claims its step with `assignedUserId = actor`, so a decision that
 * races this handover either wins first (and the work moves on already approved) or finds the
 * step reassigned and is refused: the replaced executive can never decide after the move.
 */
export async function executeExecutiveHandover(input: ExecutiveHandoverInput): Promise<HandoverFailure | { ok: true; duplicate: boolean; summary: ExecutiveHandoverSummary }> {
  const reason = input.reason.trim();
  if (reason.length < 3) return fail(400, "Шилжүүлэх шалтгаанаа бичнэ үү");
  const key = input.clientRequestId.trim();
  if (!key) return fail(400, "clientRequestId шаардлагатай");

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockExecutivePosition(tx);

      const prior = await tx.executiveApprovalReassignment.findMany({ where: { handoverKey: key } });
      if (prior.length > 0) {
        if (prior[0].fromUserId !== input.fromUserId || prior[0].toUserId !== input.toUserId) {
          throw new Abort(fail(409, "Энэ clientRequestId өөр шилжүүлэлтэд ашиглагдсан байна"));
        }
        return {
          duplicate: true as const,
          summary: summarise(input.fromUserId, input.toUserId, prior.map((p) => ({ requestId: p.requestId, stage: p.stepStatusBefore === "APPROVED" ? ("DEFERRED_OPEN" as const) : ("INITIAL_PENDING" as const) }))),
          notify: [] as string[],
        };
      }

      const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true, isActive: true } });
      if (!actor || !actor.isActive || actor.role !== "ADMIN") throw new Abort(fail(403, "Эрхгүй үйлдэл"));

      const sameness = validateFrom(input.fromUserId, input.toUserId);
      if (sameness) throw new Abort(fail(400, sameness));
      const from = await tx.user.findUnique({ where: { id: input.fromUserId }, select: { id: true, isActive: true } });
      if (!from) throw new Abort(fail(404, "Өмнөх захирал олдсонгүй"));
      const invalid = await validateNewExecutive(tx, input.toUserId);
      if (invalid) throw new Abort(invalid);

      const first = await candidates(tx, input.fromUserId);
      const requestIds = first.map((c) => c.requestId);
      const stepIds = first.map((c) => c.stepId).sort();
      // Lock order: the executive step rows, then the request rows (each in id order). The initial
      // approval locks its step first and the request second, so this order cannot deadlock with it;
      // quantity decisions and purchases take only the request lock.
      if (stepIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM "ApprovalStep" WHERE id = ANY(${stepIds}::text[]) ORDER BY id FOR UPDATE`;
      }
      if (requestIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM "MaterialRequest" WHERE id = ANY(${requestIds}::text[]) ORDER BY id FOR UPDATE`;
      }
      // re-validate under the locks: statuses and ownership as they are now
      const rows = await candidates(tx, input.fromUserId, requestIds);
      if (rows.length !== input.expectedRequests) {
        throw new Abort(fail(409, `Шилжүүлэх ажил урьдчилан харснаас өөрчлөгдсөн байна (${input.expectedRequests} → ${rows.length} захиалга). Дахин шалгаад баталгаажуулна уу`, "WORK_CHANGED"));
      }
      if (rows.length === 0) throw new Abort(fail(409, "Шилжүүлэх хүлээгдэж буй захиалга алга", "NOTHING_TO_TRANSFER"));

      // Conditional move: only steps that are still the old assignee's. RETURNING reports each step's
      // status exactly as it was when this statement got its row lock (a racing decision may have landed first).
      const moved = await tx.$queryRaw<{ id: string; status: string }[]>`
        UPDATE "ApprovalStep" SET "assignedUserId" = ${input.toUserId}
        WHERE id = ANY(${rows.map((r) => r.stepId)}::text[]) AND "assignedUserId" = ${input.fromUserId}
        RETURNING id, status::text AS status`;
      if (moved.length !== rows.length) throw new Abort(fail(409, "Хуваарилалт зэрэг өөрчлөгдсөн тул шилжүүлэлт цуцлагдлаа. Дахин оролдоно уу", "WORK_CHANGED"));
      const stepStatus = new Map(moved.map((m) => [m.id, m.status]));

      const created = [];
      for (const r of rows) {
        const row = await tx.executiveApprovalReassignment.create({
          data: {
            handoverKey: key,
            requestId: r.requestId,
            fromUserId: input.fromUserId,
            toUserId: input.toUserId,
            reassignedById: input.actorId,
            reason,
            stepStatusBefore: stepStatus.get(r.stepId) ?? r.stepStatus,
            requestStatusBefore: r.requestStatus,
          },
        });
        created.push(row);
      }
      await tx.auditLog.createMany({
        data: created.map((row) => ({
          entityType: "ExecutiveApprovalReassignment",
          entityId: row.id,
          action: "UPDATE" as const,
          actorId: input.actorId,
          beforeJson: JSON.stringify({ requestId: row.requestId, assignedUserId: input.fromUserId, stepStatus: row.stepStatusBefore, requestStatus: row.requestStatusBefore }),
          afterJson: JSON.stringify({ requestId: row.requestId, assignedUserId: input.toUserId, reason, handoverKey: key }),
        })),
      });

      const summary = summarise(
        input.fromUserId,
        input.toUserId,
        created.map((row) => ({ requestId: row.requestId, stage: row.stepStatusBefore === "APPROVED" ? ("DEFERRED_OPEN" as const) : ("INITIAL_PENDING" as const) }))
      );
      const notifications: Prisma.NotificationCreateManyInput[] = [
        {
          userId: input.toUserId,
          type: "APPROVAL_REQUIRED",
          title: "Гүйцэтгэх захирлын хүлээгдэж буй баталгаа танд шилжлээ",
          body: `${summary.requestIds.length} захиалга (${summary.initialPending} эхний батлалт, ${summary.deferredOpen} нэмэлт батлалт) танд шилжлээ. Шалтгаан: ${reason}`,
        },
      ];
      if (from.isActive) {
        notifications.push({ userId: from.id, type: "GENERIC", title: "Гүйцэтгэх захирлын баталгаа шилжлээ", body: `${summary.requestIds.length} захиалгын баталгаа өөр хүнд шилжлээ. Шалтгаан: ${reason}` });
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

function summarise(fromUserId: string, toUserId: string, rows: { requestId: string; stage: "INITIAL_PENDING" | "DEFERRED_OPEN" }[]): ExecutiveHandoverSummary {
  return {
    fromUserId,
    toUserId,
    requestIds: rows.map((r) => r.requestId),
    initialPending: rows.filter((r) => r.stage === "INITIAL_PENDING").length,
    deferredOpen: rows.filter((r) => r.stage === "DEFERRED_OPEN").length,
  };
}
