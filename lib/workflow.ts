import { createHash } from "node:crypto";
import { Prisma, type RequestStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { requestInclude, serializeRequest } from "./serialize";
import { verifyPin, type PinResult } from "./pin";
import { emitBroadcast, emitUserEvent } from "./events";
import { openProcurement } from "./procurement";
import { planInitialDecision, recordInitialDecision, type InitialPlan, type WantedQuantity } from "./executive-approval";
import type { MaterialRequestView } from "./types";

type WorkflowResult =
  | { ok: true; request: MaterialRequestView }
  | { ok: false; status: number; error: string };

const ALREADY_DECIDED_ERROR = "Энэ хүсэлтийг өөр хэрэглэгч аль хэдийн шийдвэрлэсэн байна";
const VERSION_CONFLICT_ERROR = "Баримт бичиг шинэчлэгдсэн байна. Хуудсыг дахин ачаалж, дахин оролдоно уу";
const WRONG_STAGE_ERROR = "Энэ шат одоогоор идэвхгүй байна — өмнөх шат шийдвэрлэгдээгүй байна";
const NOT_HEAD_ERROR = "Та энэ цэхийн даргын эрхгүй тул баталгаажуулах боломжгүй";
const TERMINAL_REQUEST_STATUSES = ["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "ACCOUNTING_COMPLETED"];

/** Lets a PinResult failure be returned directly as a WorkflowResult. */
function pinFailure(result: PinResult & { ok: false }): WorkflowResult {
  return { ok: false, status: result.status, error: result.error };
}

/**
 * SHA-256 over a canonical, order-independent view of what was actually
 * reviewed (material + quantity + price per line) — the "document hash"
 * on `ApprovalAction`/`MaterialRequest`. This is an internal integrity
 * record, not a legally recognized digital signature.
 */
function computeDocumentHash(
  items: {
    materialId: string | null;
    requestedQuantity: Prisma.Decimal | number;
    unitPrice: Prisma.Decimal | number | null;
  }[]
): string {
  const canonical = items
    .map((i) => ({
      materialId: i.materialId,
      requestedQuantity: Number(i.requestedQuantity),
      // Keep "no price entered" (null) distinct from an actual price of 0 —
      // coercing through Number() first would turn null into 0 and make the
      // two cases hash identically.
      unitPrice: i.unitPrice === null ? null : Number(i.unitPrice),
    }))
    .sort((a, b) => (a.materialId ?? "").localeCompare(b.materialId ?? ""));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Re-reads the department head inside the transaction. The up-front check in
 * departmentApprove/departmentReturn runs before the transaction, so an admin
 * reassigning the head in between would otherwise let the outgoing head's
 * in-flight decision through.
 */
async function isCurrentDepartmentHead(tx: Prisma.TransactionClient, departmentId: string, actorId: string) {
  const department = await tx.department.findUnique({ where: { id: departmentId }, select: { headId: true } });
  return department?.headId === actorId;
}

function notifyBroadcastAndUser(userId: string | null | undefined) {
  emitBroadcast({ type: "request-changed" });
  if (userId) emitUserEvent(userId, { type: "notification" });
}

/**
 * Approves the request's current DEPARTMENT_HEAD step.
 *
 * Authorization and the "already decided" race are both enforced by a single
 * atomic conditional UPDATE (`updateMany` with a WHERE on the step's current
 * PENDING status): under concurrent double-clicks or two requests racing,
 * only the first one can match a PENDING row, so the second always sees
 * `count === 0` and is told the step was already processed — no separate
 * row lock needed. Document-version staleness is checked with a plain read
 * at the top of the same transaction, before any write, so a mismatch can
 * be returned without needing to roll anything back.
 */
export async function departmentApprove(
  requestId: string,
  actorId: string,
  pin: string,
  expectedVersion: number
): Promise<WorkflowResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { department: true, approvalSteps: true, items: true },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };

  if (request.department.headId !== actorId) {
    return { ok: false, status: 403, error: "Та энэ цэхийн даргын эрхгүй тул баталгаажуулах боломжгүй" };
  }
  if (request.status !== "PENDING_DEPARTMENT_APPROVAL") {
    return { ok: false, status: 409, error: WRONG_STAGE_ERROR };
  }

  const step = request.approvalSteps.find((s) => s.type === "DEPARTMENT_HEAD");
  if (!step) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };

  const pinResult = await verifyPin(actorId, pin);
  if (!pinResult.ok) return pinFailure(pinResult);

  const documentHash = computeDocumentHash(request.items);

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, select: { version: true, status: true } });
    if (fresh.version !== expectedVersion) return "VERSION_CONFLICT" as const;
    if (fresh.status !== "PENDING_DEPARTMENT_APPROVAL") return "WRONG_STAGE" as const;
    if (!(await isCurrentDepartmentHead(tx, request.departmentId, actorId))) return "NOT_HEAD" as const;

    const updated = await tx.approvalStep.updateMany({
      where: { id: step.id, status: "PENDING" },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById: actorId },
    });
    if (updated.count === 0) return "ALREADY_DECIDED" as const;

    await tx.approvalAction.create({
      data: { approvalStepId: step.id, actorId, action: "APPROVE", documentHash },
    });
    await tx.auditLog.create({
      data: { entityType: "MaterialRequest", entityId: requestId, action: "APPROVE", actorId },
    });

    // The ApprovalAction above must exist before this fetch (it includes
    // each step's latest action for the UI's signature block) or the
    // response would show last decision's signature instead of this one.
    const materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: { status: "PENDING_WAREHOUSE_CHECK", version: { increment: 1 }, documentHash },
      include: requestInclude,
    });

    const warehouseStep = materialRequest.approvalSteps.find((s) => s.type === "WAREHOUSE_CHECK");
    if (warehouseStep?.assignedUserId) {
      await tx.notification.create({
        data: {
          userId: warehouseStep.assignedUserId,
          type: "WAREHOUSE_CHECK_NEEDED",
          title: "Агуулахын шалгалт шаардлагатай",
          body: `№${materialRequest.requestNumber} захиалгыг шалгана уу`,
          relatedRequestId: requestId,
        },
      });
    }

    return materialRequest;
  });

  if (result === "VERSION_CONFLICT") return { ok: false, status: 409, error: VERSION_CONFLICT_ERROR };
  if (result === "ALREADY_DECIDED") return { ok: false, status: 409, error: ALREADY_DECIDED_ERROR };
  if (result === "WRONG_STAGE") return { ok: false, status: 409, error: WRONG_STAGE_ERROR };
  if (result === "NOT_HEAD") return { ok: false, status: 403, error: NOT_HEAD_ERROR };

  notifyBroadcastAndUser(result.approvalSteps.find((s) => s.type === "WAREHOUSE_CHECK")?.assignedUserId);
  return { ok: true, request: serializeRequest(result) };
}

export async function departmentReturn(
  requestId: string,
  actorId: string,
  reason: string,
  expectedVersion: number
): Promise<WorkflowResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { department: true, approvalSteps: true, items: true },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };

  if (request.department.headId !== actorId) {
    return { ok: false, status: 403, error: "Та энэ цэхийн даргын эрхгүй тул буцаах боломжгүй" };
  }
  if (request.status !== "PENDING_DEPARTMENT_APPROVAL") {
    return { ok: false, status: 409, error: WRONG_STAGE_ERROR };
  }

  const step = request.approvalSteps.find((s) => s.type === "DEPARTMENT_HEAD");
  if (!step) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };

  const documentHash = computeDocumentHash(request.items);

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, select: { version: true, status: true } });
    if (fresh.version !== expectedVersion) return "VERSION_CONFLICT" as const;
    if (fresh.status !== "PENDING_DEPARTMENT_APPROVAL") return "WRONG_STAGE" as const;
    if (!(await isCurrentDepartmentHead(tx, request.departmentId, actorId))) return "NOT_HEAD" as const;

    const updated = await tx.approvalStep.updateMany({
      where: { id: step.id, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: new Date(), decidedById: actorId, comment: reason },
    });
    if (updated.count === 0) return "ALREADY_DECIDED" as const;

    await tx.approvalStep.updateMany({
      where: { requestId, sequence: { gt: step.sequence } },
      data: { status: "SKIPPED" },
    });

    await tx.approvalAction.create({
      data: { approvalStepId: step.id, actorId, action: "RETURN", reason, documentHash },
    });
    await tx.auditLog.create({
      data: { entityType: "MaterialRequest", entityId: requestId, action: "RETURN", actorId },
    });

    const materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: { status: "RETURNED_BY_DEPARTMENT", version: { increment: 1 }, documentHash },
      include: requestInclude,
    });

    await tx.notification.create({
      data: {
        userId: materialRequest.requestedById,
        type: "REQUEST_RETURNED",
        title: "Захиалга буцаагдлаа",
        body: `№${materialRequest.requestNumber}: ${reason}`,
        relatedRequestId: requestId,
      },
    });

    return materialRequest;
  });

  if (result === "VERSION_CONFLICT") return { ok: false, status: 409, error: VERSION_CONFLICT_ERROR };
  if (result === "ALREADY_DECIDED") return { ok: false, status: 409, error: ALREADY_DECIDED_ERROR };
  if (result === "WRONG_STAGE") return { ok: false, status: 409, error: WRONG_STAGE_ERROR };
  if (result === "NOT_HEAD") return { ok: false, status: 403, error: NOT_HEAD_ERROR };

  notifyBroadcastAndUser(result.requestedById);
  return { ok: true, request: serializeRequest(result) };
}

/**
 * Storekeeper's stock verification for the request's WAREHOUSE_CHECK step.
 * For each item with a real `materialId`, allocates min(clerk-entered
 * count, live on-hand balance, requested quantity) and issues it
 * immediately (there's no separate "confirm hand-over" step anywhere in
 * the UI — the clerk's submitted count *is* the confirmation). The
 * remainder is recorded on `WarehouseCheckItem.missingQuantity` and, if
 * any item has a shortfall, the request proceeds to BRANCH_APPROVAL for
 * that shortfall to be reviewed; if nothing is missing the request
 * completes immediately (spec Stage 3.A — a fully-stocked request never
 * visits Branch/Finance/Executive/Accounting). Items with no `materialId`
 * (manual/ad-hoc entries) have no stock to allocate from and are fully
 * missing.
 *
 * `InventoryBalance.quantityOnHand` is decremented with a compare-and-swap
 * (update guarded by the value just read) rather than raw SQL, matching the
 * request-number collision retry already used in `app/api/requests/route.ts`:
 * if a concurrent check for a different request touched the same balance
 * between our read and write, the whole attempt is retried against fresh
 * numbers. PIN and document-version are only meaningful once, before this
 * loop starts — the loop itself only ever retries over inventory state.
 */
export async function warehouseCheck(
  requestId: string,
  actorId: string,
  counts: { requestItemId: string; availableQuantity: number }[],
  pin: string,
  expectedVersion: number
): Promise<WorkflowResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { items: true, approvalSteps: true },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };

  const step = request.approvalSteps.find((s) => s.type === "WAREHOUSE_CHECK");
  if (!step) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };
  if (step.assignedUserId !== actorId) {
    return { ok: false, status: 403, error: "Та агуулахын шалгалт хийх эрхгүй байна" };
  }
  if (request.status !== "PENDING_WAREHOUSE_CHECK") {
    return { ok: false, status: 409, error: WRONG_STAGE_ERROR };
  }

  const pinResult = await verifyPin(actorId, pin);
  if (!pinResult.ok) return pinFailure(pinResult);

  const countByItem = new Map(counts.map((c) => [c.requestItemId, Math.max(0, c.availableQuantity)]));
  const materialIds = [...new Set(request.items.map((i) => i.materialId).filter((id): id is string => !!id))];
  const branchStep = request.approvalSteps.find((s) => s.type === "BRANCH_APPROVAL");

  for (let attempt = 0; attempt < 5; attempt++) {
    // There's exactly one InventoryBalance row per material in all current
    // data (single warehouse, see prisma/seed.ts) — picking the first row
    // keeps this simple instead of modeling multi-warehouse allocation that
    // nothing in the UI can create or exercise yet.
    const balances = await prisma.inventoryBalance.findMany({ where: { materialId: { in: materialIds } } });
    const balanceByMaterial = new Map(balances.map((b) => [b.materialId, b]));

    const plan: {
      itemId: string;
      requestedQuantity: number;
      allocated: number;
      missing: number;
      warehouseId?: string;
    }[] = [];
    const consumedByBalanceId = new Map<string, number>();

    for (const item of request.items) {
      const requestedQuantity = Number(item.requestedQuantity);
      const clerkAvailable = countByItem.get(item.id) ?? 0;
      let allocated = 0;
      let warehouseId: string | undefined;

      const balance = item.materialId ? balanceByMaterial.get(item.materialId) : undefined;
      if (balance) {
        const alreadyConsumed = consumedByBalanceId.get(balance.id) ?? 0;
        const liveAvailable = Number(balance.quantityOnHand) - alreadyConsumed;
        allocated = Math.min(clerkAvailable, liveAvailable, requestedQuantity);
        if (allocated > 0) {
          consumedByBalanceId.set(balance.id, alreadyConsumed + allocated);
          warehouseId = balance.warehouseId;
        }
      }

      plan.push({ itemId: item.id, requestedQuantity, allocated, missing: requestedQuantity - allocated, warehouseId });
    }

    const documentHash = computeDocumentHash(request.items);

    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, select: { version: true, status: true } });
      if (fresh.version !== expectedVersion) return "VERSION_CONFLICT" as const;
      if (fresh.status !== "PENDING_WAREHOUSE_CHECK") return "WRONG_STAGE" as const;

      const claimed = await tx.approvalStep.updateMany({
        where: { id: step.id, status: "PENDING" },
        data: { status: "APPROVED", decidedAt: new Date(), decidedById: actorId },
      });
      if (claimed.count === 0) return "ALREADY_DECIDED" as const;

      for (const [balanceId, amount] of consumedByBalanceId) {
        const balance = balances.find((b) => b.id === balanceId)!;
        const updated = await tx.inventoryBalance.updateMany({
          where: { id: balanceId, quantityOnHand: balance.quantityOnHand },
          data: { quantityOnHand: { decrement: amount } },
        });
        if (updated.count === 0) return "CONFLICT" as const;
      }

      const warehouseCheckRow = await tx.warehouseCheck.create({ data: { requestId, checkedById: actorId } });

      for (const p of plan) {
        await tx.warehouseCheckItem.create({
          data: {
            warehouseCheckId: warehouseCheckRow.id,
            requestItemId: p.itemId,
            availableQuantity: new Prisma.Decimal(countByItem.get(p.itemId) ?? 0),
            allocatedQuantity: new Prisma.Decimal(p.allocated),
            missingQuantity: new Prisma.Decimal(p.missing),
          },
        });

        if (p.allocated > 0 && p.warehouseId) {
          const reservation = await tx.stockReservation.create({
            data: {
              requestItemId: p.itemId,
              warehouseId: p.warehouseId,
              quantity: new Prisma.Decimal(p.allocated),
              status: "ISSUED",
            },
          });
          await tx.stockIssue.create({
            data: { reservationId: reservation.id, issuedById: actorId, quantity: new Prisma.Decimal(p.allocated) },
          });
        }
      }

      await tx.approvalAction.create({ data: { approvalStepId: step.id, actorId, action: "APPROVE", documentHash } });
      await tx.auditLog.create({ data: { entityType: "MaterialRequest", entityId: requestId, action: "RESERVE_STOCK", actorId } });

      const hasMissing = plan.some((p) => p.missing > 0);

      if (hasMissing) {
        await tx.materialRequest.update({
          where: { id: requestId },
          data: { status: "PENDING_BRANCH_APPROVAL", version: { increment: 1 }, documentHash },
        });
        if (branchStep?.assignedUserId) {
          await tx.notification.create({
            data: {
              userId: branchStep.assignedUserId,
              type: "APPROVAL_REQUIRED",
              title: "Захиалгын дутуу материалыг баталгаажуулах шаардлагатай",
              body: `№${request.requestNumber} захиалгын дутуу материалыг хянана уу`,
              relatedRequestId: requestId,
            },
          });
        }
      } else {
        await tx.approvalStep.updateMany({
          where: { requestId, type: { in: ["BRANCH_APPROVAL", "MANAGER_PRICING", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL", "MANAGER_PROCUREMENT", "ACCOUNTING_RECORD"] } },
          data: { status: "SKIPPED" },
        });
        await tx.materialRequest.update({
          where: { id: requestId },
          data: { status: "COMPLETED", completedAt: new Date(), version: { increment: 1 }, documentHash },
        });
        await tx.notification.create({
          data: {
            userId: request.requestedById,
            type: "REQUEST_COMPLETED",
            title: "Захиалга дуусгавар боллоо",
            body: `№${request.requestNumber} — бүх материал агуулахаас олгогдлоо`,
            relatedRequestId: requestId,
          },
        });
      }

      return tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude });
    });

    if (result === "CONFLICT") continue;
    if (result === "VERSION_CONFLICT") return { ok: false, status: 409, error: VERSION_CONFLICT_ERROR };
    if (result === "ALREADY_DECIDED") return { ok: false, status: 409, error: ALREADY_DECIDED_ERROR };
    if (result === "WRONG_STAGE") return { ok: false, status: 409, error: WRONG_STAGE_ERROR };

    notifyBroadcastAndUser(branchStep?.assignedUserId ?? request.requestedById);
    return { ok: true, request: serializeRequest(result) };
  }

  return { ok: false, status: 409, error: "Агуулахын үлдэгдэл зэрэг өөрчлөгдсөн тул дахин оролдоно уу" };
}

// --- Generalized position-held approval stages (Branch / Finance / Executive) ---
//
// These three stages are structurally identical (CAS-claim step -> version
// check -> audit -> advance status -> notify the next assignee), differing
// only in which RequestStatus values and which step comes next. Boss
// (auth via department.headId, not a position) and Storekeeper (bespoke
// stock-allocation logic) keep their own functions above; Chief Accountant
// (terminal, no approve/return, no PIN) has its own function below.
type PositionStepType = "BRANCH_APPROVAL" | "FINANCE_APPROVAL" | "EXECUTIVE_APPROVAL";

const POSITION_STEP_CONFIG: Record<
  PositionStepType,
  {
    pendingStatus: RequestStatus;
    approveStatus: RequestStatus;
    returnStatus: RequestStatus;
    nextStepType: ApprovalStepTypeLiteral | null;
    nextNotifyTitle: string;
  }
> = {
  BRANCH_APPROVAL: {
    pendingStatus: "PENDING_BRANCH_APPROVAL",
    approveStatus: "PENDING_FINANCE_APPROVAL",
    returnStatus: "RETURNED_BY_BRANCH_APPROVER",
    nextStepType: "FINANCE_APPROVAL",
    nextNotifyTitle: "Санхүү эрхэлсэн захирлын баталгаа хүлээж байна",
  },
  FINANCE_APPROVAL: {
    pendingStatus: "PENDING_FINANCE_APPROVAL",
    approveStatus: "PENDING_EXECUTIVE_APPROVAL",
    returnStatus: "RETURNED_BY_FINANCE",
    nextStepType: "EXECUTIVE_APPROVAL",
    nextNotifyTitle: "Гүйцэтгэх захирлын баталгаа хүлээж байна",
  },
  EXECUTIVE_APPROVAL: {
    pendingStatus: "PENDING_EXECUTIVE_APPROVAL",
    // CEO approval hands over to the Manager's procurement stage, not to
    // accounting; the Manager's completion moves it on (lib/procurement.ts).
    approveStatus: "PENDING_PROCUREMENT",
    returnStatus: "RETURNED_BY_EXECUTIVE",
    nextStepType: "MANAGER_PROCUREMENT",
    nextNotifyTitle: "Худалдан авалт хийх шаардлагатай",
  },
};

type ApprovalStepTypeLiteral =
  | "DEPARTMENT_HEAD"
  | "WAREHOUSE_CHECK"
  | PositionStepType
  | "MANAGER_PRICING"
  | "MANAGER_PROCUREMENT"
  | "ACCOUNTING_RECORD";

/**
 * Tells every active MANAGER that a request is waiting for its prices. The pricing and procurement
 * stages belong to the MANAGER role as a whole rather than to one assignee.
 */
async function notifyPricingManagers(tx: Prisma.TransactionClient, request: { id: string; requestNumber: string }): Promise<string[]> {
  const managers = await tx.user.findMany({ where: { role: "MANAGER", isActive: true }, select: { id: true } });
  if (managers.length > 0) {
    await tx.notification.createMany({
      data: managers.map((m) => ({
        userId: m.id,
        type: "APPROVAL_REQUIRED" as const,
        title: "Нэгж үнэ судлах шаардлагатай",
        body: `№${request.requestNumber} захиалгын дутуу материалын үнийг оруулна уу`,
        relatedRequestId: request.id,
      })),
    });
  }
  return managers.map((m) => m.id);
}

async function decidePositionStep(
  stepType: PositionStepType,
  action: "APPROVE" | "RETURN",
  requestId: string,
  actorId: string,
  opts: { pin?: string; reason?: string; expectedVersion: number; allocations?: WantedQuantity[]; comment?: string }
): Promise<WorkflowResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { approvalSteps: true, items: true },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };

  const step = request.approvalSteps.find((s) => s.type === stepType);
  if (!step) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };
  if (step.assignedUserId !== actorId) {
    return {
      ok: false,
      status: 403,
      error: action === "APPROVE" ? "Та энэ хүсэлтийг баталгаажуулах эрхгүй байна" : "Та энэ хүсэлтийг буцаах эрхгүй байна",
    };
  }

  const config = POSITION_STEP_CONFIG[stepType];
  if (request.status !== config.pendingStatus) {
    return { ok: false, status: 409, error: WRONG_STAGE_ERROR };
  }
  // Requests created before the price-review stage existed have no such step and go straight to finance.
  const goesToPricing = stepType === "BRANCH_APPROVAL" && action === "APPROVE" && request.approvalSteps.some((s) => s.type === "MANAGER_PRICING");

  if (action === "APPROVE") {
    const pinResult = await verifyPin(actorId, opts.pin!);
    if (!pinResult.ok) return pinFailure(pinResult);
  }

  const documentHash = computeDocumentHash(request.items);

  let managersToNotify: string[] = [];
  let allocationFailure: { status: number; error: string } | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, select: { version: true, status: true } });
    if (fresh.version !== opts.expectedVersion) return "VERSION_CONFLICT" as const;
    if (fresh.status !== config.pendingStatus) return "WRONG_STAGE" as const;

    // Executive approval may authorise only part of the quantity; validate (read-only)
    // before anything is written so a bad quantity rolls nothing back.
    let initialPlan: InitialPlan | null = null;
    if (action === "APPROVE" && stepType === "EXECUTIVE_APPROVAL") {
      const planned = await planInitialDecision(tx, requestId, opts.allocations);
      if (!planned.ok) {
        allocationFailure = planned;
        return "INVALID_ALLOCATION" as const;
      }
      initialPlan = planned.plan;
    }

    // The executive must still be an active DIRECTOR when the decision lands (a deactivated one cannot decide).
    if (stepType === "EXECUTIVE_APPROVAL") {
      const decider = await tx.user.findUnique({ where: { id: actorId }, select: { isActive: true, role: true } });
      if (!decider || !decider.isActive || decider.role !== "DIRECTOR") return "NOT_ASSIGNED" as const;
    }

    // Claimed only while the step is still this actor's: an ADMIN handover of the executive
    // responsibility (lib/executive-handover.ts) that commits first makes this count 0.
    const updated = await tx.approvalStep.updateMany({
      where: { id: step.id, status: "PENDING", assignedUserId: actorId },
      data:
        action === "APPROVE"
          ? { status: "APPROVED", decidedAt: new Date(), decidedById: actorId }
          : { status: "REJECTED", decidedAt: new Date(), decidedById: actorId, comment: opts.reason },
    });
    if (updated.count === 0) {
      const current = await tx.approvalStep.findUnique({ where: { id: step.id }, select: { status: true, assignedUserId: true } });
      return current?.status === "PENDING" && current.assignedUserId !== actorId ? ("NOT_ASSIGNED" as const) : ("ALREADY_DECIDED" as const);
    }

    if (action === "RETURN") {
      await tx.approvalStep.updateMany({
        where: { requestId, sequence: { gt: step.sequence } },
        data: { status: "SKIPPED" },
      });
    }

    await tx.approvalAction.create({
      data: { approvalStepId: step.id, actorId, action, reason: opts.reason ?? opts.comment, documentHash },
    });
    await tx.auditLog.create({
      data: { entityType: "MaterialRequest", entityId: requestId, action: action === "APPROVE" ? "APPROVE" : "RETURN", actorId },
    });
    if (initialPlan) await recordInitialDecision(tx, initialPlan, actorId, opts.comment);

    let materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: {
        status: action === "APPROVE" ? (goesToPricing ? "PENDING_MANAGER_PRICING" : config.approveStatus) : config.returnStatus,
        version: { increment: 1 },
        documentHash,
      },
      include: requestInclude,
    });

    if (action === "APPROVE" && stepType === "EXECUTIVE_APPROVAL") {
      // The next stage belongs to every MANAGER rather than one assignee, and
      // requests created before it existed have no step for it yet.
      managersToNotify = await openProcurement(tx, materialRequest);
      materialRequest = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude });
    } else if (goesToPricing) {
      managersToNotify = await notifyPricingManagers(tx, materialRequest);
    } else if (action === "APPROVE") {
      const nextStep = config.nextStepType ? materialRequest.approvalSteps.find((s) => s.type === config.nextStepType) : null;
      if (nextStep?.assignedUserId) {
        await tx.notification.create({
          data: {
            userId: nextStep.assignedUserId,
            type: "APPROVAL_REQUIRED",
            title: config.nextNotifyTitle,
            body: `№${materialRequest.requestNumber} захиалгыг хянана уу`,
            relatedRequestId: requestId,
          },
        });
      }
    } else {
      await tx.notification.create({
        data: {
          userId: materialRequest.requestedById,
          type: "REQUEST_RETURNED",
          title: "Захиалга буцаагдлаа",
          body: `№${materialRequest.requestNumber}: ${opts.reason}`,
          relatedRequestId: requestId,
        },
      });
    }

    return materialRequest;
  });

  if (result === "VERSION_CONFLICT") return { ok: false, status: 409, error: VERSION_CONFLICT_ERROR };
  if (result === "ALREADY_DECIDED") return { ok: false, status: 409, error: ALREADY_DECIDED_ERROR };
  if (result === "WRONG_STAGE") return { ok: false, status: 409, error: WRONG_STAGE_ERROR };
  if (result === "NOT_ASSIGNED") return { ok: false, status: 403, error: "Та энэ хүсэлтийг баталгаажуулах эрхгүй байна" };
  if (result === "INVALID_ALLOCATION") return { ok: false, status: allocationFailure!.status, error: allocationFailure!.error };

  for (const managerId of managersToNotify) emitUserEvent(managerId, { type: "notification" });
  const notifyTarget =
    action === "APPROVE"
      ? stepType === "EXECUTIVE_APPROVAL" || goesToPricing
        ? undefined
        : config.nextStepType
        ? result.approvalSteps.find((s) => s.type === config.nextStepType)?.assignedUserId
        : undefined
      : result.requestedById;
  notifyBroadcastAndUser(notifyTarget);
  return { ok: true, request: serializeRequest(result) };
}

export const branchApprove = (requestId: string, actorId: string, pin: string, expectedVersion: number) =>
  decidePositionStep("BRANCH_APPROVAL", "APPROVE", requestId, actorId, { pin, expectedVersion });
export const branchReturn = (requestId: string, actorId: string, reason: string, expectedVersion: number) =>
  decidePositionStep("BRANCH_APPROVAL", "RETURN", requestId, actorId, { reason, expectedVersion });
export const financeApprove = (requestId: string, actorId: string, pin: string, expectedVersion: number) =>
  decidePositionStep("FINANCE_APPROVAL", "APPROVE", requestId, actorId, { pin, expectedVersion });
export const financeReturn = (requestId: string, actorId: string, reason: string, expectedVersion: number) =>
  decidePositionStep("FINANCE_APPROVAL", "RETURN", requestId, actorId, { reason, expectedVersion });
/**
 * `allocations` omitted = approve everything that needs buying (the previous
 * behaviour). Provided = partial approval: the listed quantities are approved
 * now and the rest stays deferred (see lib/executive-approval.ts).
 */
export const executiveApprove = (
  requestId: string,
  actorId: string,
  pin: string,
  expectedVersion: number,
  extra: { allocations?: WantedQuantity[]; comment?: string } = {}
) => decidePositionStep("EXECUTIVE_APPROVAL", "APPROVE", requestId, actorId, { pin, expectedVersion, ...extra });
export const executiveReturn = (requestId: string, actorId: string, reason: string, expectedVersion: number) =>
  decidePositionStep("EXECUTIVE_APPROVAL", "RETURN", requestId, actorId, { reason, expectedVersion });

const PRICING_NOT_MANAGER_ERROR = "Зөвхөн идэвхтэй Manager эрхтэй хэрэглэгч үнэ судалж баталгаажуулах боломжтой";

/**
 * Price-review stage between the branch approver and the finance director. Any active MANAGER (no
 * single assignee, like procurement) enters the unit prices of what has to be bought, then approves
 * with a PIN or returns the request with a reason. Prices are entered with managerUpdateItemPrice
 * while the request is in this status; approval is refused while a still-missing item has no price.
 */
async function decideManagerPricing(
  action: "APPROVE" | "RETURN",
  requestId: string,
  actorId: string,
  opts: { pin?: string; reason?: string; expectedVersion: number }
): Promise<WorkflowResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { approvalSteps: true, items: { include: { warehouseCheckItems: true } } },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };

  const step = request.approvalSteps.find((s) => s.type === "MANAGER_PRICING");
  if (!step) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };
  if (request.status !== "PENDING_MANAGER_PRICING") return { ok: false, status: 409, error: WRONG_STAGE_ERROR };

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor || !actor.isActive || actor.role !== "MANAGER") return { ok: false, status: 403, error: PRICING_NOT_MANAGER_ERROR };

  if (action === "APPROVE") {
    const pinResult = await verifyPin(actorId, opts.pin!);
    if (!pinResult.ok) return pinFailure(pinResult);

    // What still has to be bought: the warehouse shortfall of the latest check (items covered by stock need no price).
    const unpriced = request.items.filter((i) => {
      const check = i.warehouseCheckItems[i.warehouseCheckItems.length - 1];
      const required = check ? Number(check.missingQuantity) : Number(i.requestedQuantity);
      return required > 0 && i.unitPrice === null;
    });
    if (unpriced.length > 0) {
      const names = unpriced.map((i) => i.manualMaterialName ?? `#${i.lineNo}`).join(", ");
      return { ok: false, status: 400, error: `Нэгж үнэ оруулаагүй мөр байна: ${names}` };
    }
  }

  const documentHash = computeDocumentHash(request.items);

  let financeAssigneeId: string | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, select: { version: true, status: true } });
    if (fresh.version !== opts.expectedVersion) return "VERSION_CONFLICT" as const;
    if (fresh.status !== "PENDING_MANAGER_PRICING") return "WRONG_STAGE" as const;

    const updated = await tx.approvalStep.updateMany({
      where: { id: step.id, status: "PENDING" },
      data:
        action === "APPROVE"
          ? { status: "APPROVED", decidedAt: new Date(), decidedById: actorId }
          : { status: "REJECTED", decidedAt: new Date(), decidedById: actorId, comment: opts.reason },
    });
    if (updated.count === 0) return "ALREADY_DECIDED" as const;

    if (action === "RETURN") {
      await tx.approvalStep.updateMany({ where: { requestId, sequence: { gt: step.sequence } }, data: { status: "SKIPPED" } });
    }

    await tx.approvalAction.create({ data: { approvalStepId: step.id, actorId, action, reason: opts.reason, documentHash } });
    await tx.auditLog.create({ data: { entityType: "MaterialRequest", entityId: requestId, action, actorId } });

    const materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: {
        status: action === "APPROVE" ? "PENDING_FINANCE_APPROVAL" : "RETURNED_BY_MANAGER_PRICING",
        version: { increment: 1 },
        documentHash,
      },
      include: requestInclude,
    });

    if (action === "APPROVE") {
      const financeStep = materialRequest.approvalSteps.find((s) => s.type === "FINANCE_APPROVAL");
      if (financeStep?.assignedUserId) {
        financeAssigneeId = financeStep.assignedUserId;
        await tx.notification.create({
          data: {
            userId: financeStep.assignedUserId,
            type: "APPROVAL_REQUIRED",
            title: "Санхүү эрхэлсэн захирлын баталгаа хүлээж байна",
            body: `№${materialRequest.requestNumber} захиалгыг хянана уу`,
            relatedRequestId: requestId,
          },
        });
      }
    } else {
      await tx.notification.create({
        data: {
          userId: materialRequest.requestedById,
          type: "REQUEST_RETURNED",
          title: "Захиалга буцаагдлаа",
          body: `№${materialRequest.requestNumber}: ${opts.reason}`,
          relatedRequestId: requestId,
        },
      });
    }

    return materialRequest;
  });

  if (result === "VERSION_CONFLICT") return { ok: false, status: 409, error: VERSION_CONFLICT_ERROR };
  if (result === "ALREADY_DECIDED") return { ok: false, status: 409, error: ALREADY_DECIDED_ERROR };
  if (result === "WRONG_STAGE") return { ok: false, status: 409, error: WRONG_STAGE_ERROR };

  notifyBroadcastAndUser(action === "APPROVE" ? financeAssigneeId : result.requestedById);
  return { ok: true, request: serializeRequest(result) };
}

export const managerPricingApprove = (requestId: string, actorId: string, pin: string, expectedVersion: number) =>
  decideManagerPricing("APPROVE", requestId, actorId, { pin, expectedVersion });
export const managerPricingReturn = (requestId: string, actorId: string, reason: string, expectedVersion: number) =>
  decideManagerPricing("RETURN", requestId, actorId, { reason, expectedVersion });

/**
 * Stage 7 — Chief Accountant's terminal financial record. This is data
 * entry, not a decision: no approve/return branch, no PIN (spec: "MANAGER
 * болон CHIEF_ACCOUNTANT approval signature хийхгүй"). Once recorded the
 * request is done — "энэ бол одоогийн хөгжүүлэлтийн эцсийн шат".
 */
export async function recordAccountingEntry(
  requestId: string,
  actorId: string,
  input: { ledgerNumber: string; recordDate: Date; note?: string },
  expectedVersion: number
): Promise<WorkflowResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { approvalSteps: true, items: true },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };

  const step = request.approvalSteps.find((s) => s.type === "ACCOUNTING_RECORD");
  if (!step) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };
  if (step.assignedUserId !== actorId) {
    return { ok: false, status: 403, error: "Та санхүүгийн бүртгэл хийх эрхгүй байна" };
  }
  if (request.status !== "PENDING_ACCOUNTING") {
    return { ok: false, status: 409, error: WRONG_STAGE_ERROR };
  }
  // Registration is only reachable after the Manager has completed procurement.
  // Requests that predate that stage have no such step and go straight through.
  const procurementStep = request.approvalSteps.find((s) => s.type === "MANAGER_PROCUREMENT");
  if (procurementStep && procurementStep.status !== "APPROVED") {
    return { ok: false, status: 409, error: "Худалдан авалт дуусаагүй байна" };
  }

  const documentHash = computeDocumentHash(request.items);

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.materialRequest.findUniqueOrThrow({ where: { id: requestId }, select: { version: true, status: true } });
    if (fresh.version !== expectedVersion) return "VERSION_CONFLICT" as const;
    if (fresh.status !== "PENDING_ACCOUNTING") return "WRONG_STAGE" as const;

    const claimed = await tx.approvalStep.updateMany({
      where: { id: step.id, status: "PENDING" },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById: actorId },
    });
    if (claimed.count === 0) return "ALREADY_DECIDED" as const;

    await tx.accountingRecord.create({
      data: {
        requestId,
        ledgerNumber: input.ledgerNumber,
        recordDate: input.recordDate,
        note: input.note,
        recordedById: actorId,
      },
    });

    await tx.auditLog.create({
      data: { entityType: "MaterialRequest", entityId: requestId, action: "ACCOUNTING_RECORD", actorId },
    });

    const materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: { status: "ACCOUNTING_COMPLETED", completedAt: new Date(), version: { increment: 1 }, documentHash },
      include: requestInclude,
    });

    await tx.notification.create({
      data: {
        userId: materialRequest.requestedById,
        type: "REQUEST_COMPLETED",
        title: "Захиалга дуусгавар боллоо",
        body: `№${materialRequest.requestNumber} — санхүүгийн бүртгэл хийгдлээ`,
        relatedRequestId: requestId,
      },
    });

    return materialRequest;
  });

  if (result === "VERSION_CONFLICT") return { ok: false, status: 409, error: VERSION_CONFLICT_ERROR };
  if (result === "ALREADY_DECIDED") return { ok: false, status: 409, error: ALREADY_DECIDED_ERROR };
  if (result === "WRONG_STAGE") return { ok: false, status: 409, error: WRONG_STAGE_ERROR };

  notifyBroadcastAndUser(result.requestedById);
  return { ok: true, request: serializeRequest(result) };
}

/**
 * MANAGER price review: edits a single item's unit price while the request
 * is still in flight. Deliberately has no approve/return power and no PIN
 * (MANAGER never decides the request's fate) — the caller (the API route)
 * is responsible for checking the actor's role is MANAGER.
 */
export async function managerUpdateItemPrice(
  requestId: string,
  itemId: string,
  actorId: string,
  unitPrice: number,
  expectedVersion: number
): Promise<WorkflowResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };
  if (TERMINAL_REQUEST_STATUSES.includes(request.status)) {
    return { ok: false, status: 409, error: "Дууссан захиалгын үнийг өөрчлөх боломжгүй" };
  }

  const item = request.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, status: 404, error: "Захиалгын мөр олдсонгүй" };

  const newUnitPrice = new Prisma.Decimal(unitPrice);
  const newTotalPrice = newUnitPrice.mul(item.requestedQuantity);
  // item.unitPrice can be null here — a price filled in for the first time
  // for an item that was submitted with no price at all.
  const beforeUnitPrice = item.unitPrice === null ? null : item.unitPrice.toString();

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.materialRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { version: true, status: true },
    });
    if (fresh.version !== expectedVersion) return "VERSION_CONFLICT" as const;
    if (TERMINAL_REQUEST_STATUSES.includes(fresh.status)) return "TERMINAL" as const;

    await tx.materialRequestItem.update({
      where: { id: itemId },
      data: { unitPrice: newUnitPrice, totalPrice: newTotalPrice },
    });

    await tx.auditLog.create({
      data: {
        entityType: "MaterialRequestItem",
        entityId: itemId,
        action: "UPDATE_PRICE",
        actorId,
        beforeJson: JSON.stringify({ unitPrice: beforeUnitPrice }),
        afterJson: JSON.stringify({ unitPrice: newUnitPrice.toString() }),
      },
    });

    const materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: { version: { increment: 1 } },
      include: requestInclude,
    });

    return materialRequest;
  });

  if (result === "VERSION_CONFLICT") return { ok: false, status: 409, error: VERSION_CONFLICT_ERROR };
  if (result === "TERMINAL") return { ok: false, status: 409, error: "Дууссан захиалгын үнийг өөрчлөх боломжгүй" };

  notifyBroadcastAndUser(result.requestedById);
  return { ok: true, request: serializeRequest(result) };
}

/**
 * Resubmission after a DEPARTMENT_HEAD return. Nothing downstream has run
 * yet at this point (no warehouse check, no stock movement) so the item
 * list can be freely replaced — add/remove/change material, quantity,
 * price — same shape as creating a request.
 */
export async function resubmitDepartmentReturn(
  requestId: string,
  actorId: string,
  expectedVersion: number,
  items: {
    materialId: string | null;
    materialName: string;
    unit: string;
    requestedQuantity: number;
    unitPrice: number | null;
    note?: string;
  }[],
  note?: string
): Promise<WorkflowResult> {
  if (items.length === 0) return { ok: false, status: 400, error: "Хамгийн багадаа нэг мөр нэмнэ үү" };

  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { approvalSteps: true, department: true },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };
  if (request.requestedById !== actorId) {
    return { ok: false, status: 403, error: "Зөвхөн захиалга үүсгэсэн ажилтан дахин илгээх боломжтой" };
  }
  if (request.status !== "RETURNED_BY_DEPARTMENT") {
    return { ok: false, status: 409, error: "Энэ захиалга дахин илгээх боломжгүй төлөвт байна" };
  }

  const step = request.approvalSteps.find((s) => s.type === "DEPARTMENT_HEAD");
  if (!step) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };
  // The head may have been reassigned since the return; the reopened step goes
  // to whoever heads the department now, not the person who returned it.
  const headId = request.department.headId;
  if (!headId) {
    return { ok: false, status: 400, error: "Энэ цэхийн дарга тохируулагдаагүй байна. Тохиргоо хуудаснаас тохируулна уу." };
  }

  // Batch the material lookups into one query instead of one findUnique per
  // item -- same N+1 fix as app/api/requests/route.ts's create path, which
  // this resubmission path mirrors.
  const requestedMaterialIds = [...new Set(items.map((item) => item.materialId).filter((id): id is string => !!id))];
  const materials = requestedMaterialIds.length
    ? await prisma.material.findMany({
        where: { id: { in: requestedMaterialIds } },
        include: { inventoryBalances: true },
      })
    : [];
  const materialsById = new Map(materials.map((m) => [m.id, m]));

  const resolvedItems: {
    materialId: string | null;
    manualMaterialName: string | null;
    unit: string;
    requestedQuantity: Prisma.Decimal;
    warehouseBalanceAtRequest: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal | null;
    totalPrice: Prisma.Decimal | null;
    note: string | undefined;
  }[] = [];
  for (const item of items) {
    let warehouseBalanceAtRequest: number | null = null;
    let materialNameAtRequest = item.materialName;
    if (item.materialId) {
      const material = materialsById.get(item.materialId);
      if (!material) return { ok: false, status: 400, error: `Материал олдсонгүй: ${item.materialName}` };
      materialNameAtRequest = material.name;
      warehouseBalanceAtRequest = material.inventoryBalances.reduce((s, b) => s + Number(b.quantityOnHand), 0);
    }
    const hasPrice = item.unitPrice !== null && item.unitPrice !== undefined;
    resolvedItems.push({
      materialId: item.materialId,
      // Same name-snapshot rule as request creation (app/api/requests/route.ts).
      manualMaterialName: materialNameAtRequest,
      unit: item.unit,
      requestedQuantity: new Prisma.Decimal(item.requestedQuantity),
      warehouseBalanceAtRequest:
        warehouseBalanceAtRequest === null ? null : new Prisma.Decimal(warehouseBalanceAtRequest),
      unitPrice: hasPrice ? new Prisma.Decimal(item.unitPrice as number) : null,
      totalPrice: hasPrice ? new Prisma.Decimal(item.requestedQuantity * (item.unitPrice as number)) : null,
      note: item.note,
    });
  }

  const documentHash = computeDocumentHash(resolvedItems);

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.materialRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { version: true, status: true },
    });
    if (fresh.version !== expectedVersion || fresh.status !== "RETURNED_BY_DEPARTMENT") {
      return "VERSION_CONFLICT" as const;
    }

    await tx.materialRequestItem.deleteMany({ where: { requestId } });
    await tx.materialRequestItem.createMany({
      data: resolvedItems.map((it, i) => ({ ...it, requestId, lineNo: i + 1 })),
    });

    await tx.approvalStep.update({
      where: { id: step.id },
      data: { status: "PENDING", decidedAt: null, decidedById: null, comment: null, assignedUserId: headId },
    });

    const materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: {
        status: "PENDING_DEPARTMENT_APPROVAL",
        version: { increment: 1 },
        documentHash,
        note: note ?? request.note,
        submittedAt: new Date(),
      },
      include: requestInclude,
    });

    await tx.auditLog.create({ data: { entityType: "MaterialRequest", entityId: requestId, action: "RESUBMIT", actorId } });
    await tx.notification.create({
      data: {
        userId: headId,
        type: "APPROVAL_REQUIRED",
        title: "Засварласан захиалга дахин баталгаажуулах шаардлагатай",
        body: `№${materialRequest.requestNumber} захиалгыг хянана уу`,
        relatedRequestId: requestId,
      },
    });

    return materialRequest;
  });

  if (result === "VERSION_CONFLICT") return { ok: false, status: 409, error: VERSION_CONFLICT_ERROR };

  notifyBroadcastAndUser(headId);
  return { ok: true, request: serializeRequest(result) };
}

const RETURNED_STATUS_TO_STEP: Record<string, PositionStepType | "MANAGER_PRICING"> = {
  RETURNED_BY_BRANCH_APPROVER: "BRANCH_APPROVAL",
  RETURNED_BY_MANAGER_PRICING: "MANAGER_PRICING",
  RETURNED_BY_FINANCE: "FINANCE_APPROVAL",
  RETURNED_BY_EXECUTIVE: "EXECUTIVE_APPROVAL",
};

/**
 * Resubmission after a BRANCH_APPROVAL / FINANCE_APPROVAL /
 * EXECUTIVE_APPROVAL return. By this point the available portion of every
 * item was already physically issued for real during the warehouse check
 * — that history can't be rewritten. Only the still-open shortfall
 * (`WarehouseCheckItem.missingQuantity`) is adjustable: lower it, or
 * cancel it (0) if it's no longer needed. If every remaining shortfall
 * gets cancelled, nothing is left for Branch/Finance/Executive/Accountant
 * to review, so the request completes immediately; otherwise the step
 * that returned it is simply reopened.
 */
export async function resubmitPositionStepReturn(
  requestId: string,
  actorId: string,
  expectedVersion: number,
  adjustments: { requestItemId: string; quantity: number }[]
): Promise<WorkflowResult> {
  if (adjustments.length === 0) return { ok: false, status: 400, error: "Хамгийн багадаа нэг мөр тохируулна уу" };

  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { approvalSteps: true, items: { include: { warehouseCheckItems: true } } },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };
  if (request.requestedById !== actorId) {
    return { ok: false, status: 403, error: "Зөвхөн захиалга үүсгэсэн ажилтан дахин илгээх боломжтой" };
  }

  const stepType = RETURNED_STATUS_TO_STEP[request.status];
  if (!stepType) return { ok: false, status: 409, error: "Энэ захиалга дахин илгээх боломжгүй төлөвт байна" };

  const stepToReopen = request.approvalSteps.find((s) => s.type === stepType);
  if (!stepToReopen) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };

  for (const adj of adjustments) {
    const item = request.items.find((i) => i.id === adj.requestItemId);
    const check = item?.warehouseCheckItems[item.warehouseCheckItems.length - 1];
    if (!item || !check || Number(check.missingQuantity) <= 0) {
      return { ok: false, status: 400, error: "Зөвхөн дутуу материалын мөрийг засах боломжтой" };
    }
    if (adj.quantity < 0) return { ok: false, status: 400, error: "Тоо хэмжээ сөрөг байж болохгүй" };
    if (adj.quantity > Number(check.missingQuantity)) {
      return { ok: false, status: 400, error: "Тоо хэмжээг нэмэгдүүлэх боломжгүй" };
    }
  }

  const documentHash = computeDocumentHash(request.items);

  let reopenedManagerIds: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.materialRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { version: true, status: true },
    });
    if (fresh.version !== expectedVersion || fresh.status !== request.status) return "VERSION_CONFLICT" as const;

    for (const adj of adjustments) {
      const item = request.items.find((i) => i.id === adj.requestItemId)!;
      const check = item.warehouseCheckItems[item.warehouseCheckItems.length - 1];
      await tx.warehouseCheckItem.update({
        where: { id: check.id },
        data: { missingQuantity: new Prisma.Decimal(adj.quantity) },
      });
    }

    await tx.auditLog.create({ data: { entityType: "MaterialRequest", entityId: requestId, action: "RESUBMIT", actorId } });

    const refreshedItems = await tx.materialRequestItem.findMany({
      where: { requestId },
      include: { warehouseCheckItems: true },
    });
    const stillMissing = refreshedItems.some((i) => {
      const c = i.warehouseCheckItems[i.warehouseCheckItems.length - 1];
      return c && Number(c.missingQuantity) > 0;
    });

    if (!stillMissing) {
      const materialRequest = await tx.materialRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", completedAt: new Date(), version: { increment: 1 }, documentHash },
        include: requestInclude,
      });

      await tx.notification.create({
        data: {
          userId: materialRequest.requestedById,
          type: "REQUEST_COMPLETED",
          title: "Захиалга дуусгавар боллоо",
          body: `№${materialRequest.requestNumber} — үлдсэн дутуу материалыг цуцаллаа`,
          relatedRequestId: requestId,
        },
      });

      return materialRequest;
    }

    await tx.approvalStep.update({
      where: { id: stepToReopen.id },
      data: { status: "PENDING", decidedAt: null, decidedById: null, comment: null },
    });
    // The return skipped every later step; they have to run again once this one is re-approved.
    await tx.approvalStep.updateMany({
      where: { requestId, status: "SKIPPED", sequence: { gt: stepToReopen.sequence } },
      data: { status: "PENDING" },
    });

    const nextStatus =
      stepType === "BRANCH_APPROVAL"
        ? "PENDING_BRANCH_APPROVAL"
        : stepType === "MANAGER_PRICING"
          ? "PENDING_MANAGER_PRICING"
          : stepType === "FINANCE_APPROVAL"
            ? "PENDING_FINANCE_APPROVAL"
            : "PENDING_EXECUTIVE_APPROVAL";

    const materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: { status: nextStatus, version: { increment: 1 }, documentHash },
      include: requestInclude,
    });

    if (stepType === "MANAGER_PRICING") {
      reopenedManagerIds = await notifyPricingManagers(tx, materialRequest);
    } else if (stepToReopen.assignedUserId) {
      await tx.notification.create({
        data: {
          userId: stepToReopen.assignedUserId,
          type: "APPROVAL_REQUIRED",
          title: "Засварласан захиалга дахин баталгаажуулах шаардлагатай",
          body: `№${materialRequest.requestNumber} захиалгыг хянана уу`,
          relatedRequestId: requestId,
        },
      });
    }

    return materialRequest;
  });

  if (result === "VERSION_CONFLICT") return { ok: false, status: 409, error: VERSION_CONFLICT_ERROR };

  for (const managerId of reopenedManagerIds) emitUserEvent(managerId, { type: "notification" });
  emitBroadcast({ type: "request-changed" });
  return { ok: true, request: serializeRequest(result) };
}
