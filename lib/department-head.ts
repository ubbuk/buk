import { prisma } from "./prisma";
import { departmentHeadError } from "./department-access";
import { recordGrant, type GrantContext } from "./authority-grant";

export type AssignHeadResult =
  | { ok: true; id: string; headId: string | null; reassignedRequests: number; changed: boolean; notified?: string[] }
  | { ok: false; status: number; error: string };

/**
 * Sets (or clears) a department's head and keeps in-flight Stage 2 approvals
 * consistent with it.
 *
 * - Only an existing, active BOSS may become head.
 * - Requests still waiting on the head (PENDING_DEPARTMENT_APPROVAL, step
 *   PENDING) are re-pointed to the new head and the new head is notified.
 *   Decided steps, ApprovalAction rows and earlier audit entries are history
 *   and are never touched. A request that was *returned* to its requester picks
 *   up the live head when it is resubmitted (resubmitDepartmentReturn).
 * - Clearing the head while requests are waiting on it is refused: nobody
 *   could approve them. Appoint a replacement instead.
 *
 * Everything happens in one transaction, with a before/after audit record. When the caller passes a `grant`
 * (the admin route always does, see lib/authority-grant.ts), the authority-grant audit row and the notifications
 * are written in that same transaction: if they cannot be written, the head is not changed.
 */
export async function assignDepartmentHead(
  departmentId: string,
  newHeadId: string | null,
  actorId: string,
  grant?: GrantContext
): Promise<AssignHeadResult> {
  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) return { ok: false, status: 404, error: "Цех, тасаг олдсонгүй" };

  if (newHeadId === department.headId) {
    return { ok: true, id: department.id, headId: department.headId, reassignedRequests: 0, changed: false };
  }

  if (newHeadId) {
    const candidate = await prisma.user.findUnique({ where: { id: newHeadId }, select: { role: true, isActive: true } });
    const error = departmentHeadError(candidate);
    if (error) return { ok: false, status: 400, error };
  }

  const result = await prisma.$transaction(async (tx) => {
    const pending = await tx.approvalStep.findMany({
      where: {
        type: "DEPARTMENT_HEAD",
        status: "PENDING",
        request: { departmentId, status: "PENDING_DEPARTMENT_APPROVAL" },
      },
      select: { id: true, requestId: true, request: { select: { requestNumber: true } } },
    });
    if (!newHeadId && pending.length > 0) return { blocked: pending.length } as const;

    const updated = await tx.department.update({ where: { id: departmentId }, data: { headId: newHeadId } });

    if (newHeadId && pending.length > 0) {
      await tx.approvalStep.updateMany({
        where: { id: { in: pending.map((s) => s.id) }, status: "PENDING" },
        data: { assignedUserId: newHeadId },
      });
      await tx.notification.createMany({
        data: pending.map((s) => ({
          userId: newHeadId,
          type: "APPROVAL_REQUIRED" as const,
          title: "Шинэ захиалга баталгаажуулах шаардлагатай",
          body: `№${s.request.requestNumber} захиалгыг хянана уу`,
          relatedRequestId: s.requestId,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        entityType: "Department",
        entityId: departmentId,
        action: "UPDATE",
        actorId,
        beforeJson: JSON.stringify({ headId: department.headId }),
        afterJson: JSON.stringify({ headId: newHeadId, reassignedPendingRequests: pending.length }),
      },
    });

    let notified: string[] = [];
    if (grant && newHeadId) {
      notified = await recordGrant(tx, grant, {
        subjectType: "Department",
        subjectId: departmentId,
        summary: `«${department.name}» цехийн даргаар томилогдлоо`,
        before: { headId: department.headId },
        after: { headId: newHeadId },
        previousHolderIds: department.headId ? [department.headId] : [],
      });
    }

    return { updated, reassigned: pending.length, notified } as const;
  });

  if ("blocked" in result) {
    return {
      ok: false,
      status: 409,
      error: `Батлах хүлээлттэй ${result.blocked} захиалга байна. Дарга хасахын оронд шинэ дарга томилно уу`,
    };
  }
  return { ok: true, id: result.updated.id, headId: result.updated.headId, reassignedRequests: result.reassigned, changed: true, notified: result.notified };
}
