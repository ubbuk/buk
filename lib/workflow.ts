import { prisma } from "./prisma";
import { requestInclude, serializeRequest } from "./serialize";
import type { MaterialRequestView } from "./types";

type WorkflowResult =
  | { ok: true; request: MaterialRequestView }
  | { ok: false; status: number; error: string };

/**
 * Approves the request's current DEPARTMENT_HEAD step.
 *
 * Authorization and the "already decided" race are both enforced by a single
 * atomic conditional UPDATE (`updateMany` with a WHERE on the step's current
 * PENDING status): under concurrent double-clicks or two requests racing,
 * only the first one can match a PENDING row, so the second always sees
 * `count === 0` and is told the step was already processed — no separate
 * row lock needed.
 */
export async function departmentApprove(requestId: string, actorId: string): Promise<WorkflowResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { department: true, approvalSteps: true },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };

  if (request.department.headId !== actorId) {
    return { ok: false, status: 403, error: "Та энэ цэхийн даргын эрхгүй тул баталгаажуулах боломжгүй" };
  }

  const step = request.approvalSteps.find((s) => s.type === "DEPARTMENT_HEAD");
  if (!step) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.approvalStep.updateMany({
      where: { id: step.id, status: "PENDING" },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById: actorId },
    });
    if (updated.count === 0) return null;

    const materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: { status: "PENDING_WAREHOUSE_CHECK", version: { increment: 1 } },
      include: requestInclude,
    });

    await tx.approvalAction.create({
      data: { approvalStepId: step.id, actorId, action: "APPROVE" },
    });
    await tx.auditLog.create({
      data: { entityType: "MaterialRequest", entityId: requestId, action: "APPROVE", actorId },
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

  if (!result) {
    return { ok: false, status: 409, error: "Энэ хүсэлтийг өөр хэрэглэгч аль хэдийн шийдвэрлэсэн байна" };
  }

  return { ok: true, request: serializeRequest(result) };
}

export async function departmentReturn(
  requestId: string,
  actorId: string,
  reason: string
): Promise<WorkflowResult> {
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    include: { department: true, approvalSteps: true },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };

  if (request.department.headId !== actorId) {
    return { ok: false, status: 403, error: "Та энэ цэхийн даргын эрхгүй тул буцаах боломжгүй" };
  }

  const step = request.approvalSteps.find((s) => s.type === "DEPARTMENT_HEAD");
  if (!step) return { ok: false, status: 500, error: "Баталгаажуулалтын шат олдсонгүй" };

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.approvalStep.updateMany({
      where: { id: step.id, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: new Date(), decidedById: actorId, comment: reason },
    });
    if (updated.count === 0) return null;

    await tx.approvalStep.updateMany({
      where: { requestId, sequence: { gt: step.sequence } },
      data: { status: "SKIPPED" },
    });

    const materialRequest = await tx.materialRequest.update({
      where: { id: requestId },
      data: { status: "RETURNED_BY_DEPARTMENT", version: { increment: 1 } },
      include: requestInclude,
    });

    await tx.approvalAction.create({
      data: { approvalStepId: step.id, actorId, action: "RETURN", reason },
    });
    await tx.auditLog.create({
      data: { entityType: "MaterialRequest", entityId: requestId, action: "RETURN", actorId },
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

  if (!result) {
    return { ok: false, status: 409, error: "Энэ хүсэлтийг өөр хэрэглэгч аль хэдийн шийдвэрлэсэн байна" };
  }

  return { ok: true, request: serializeRequest(result) };
}
