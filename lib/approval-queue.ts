import type { ApprovalStepView, MaterialRequestView } from "./types";

/**
 * The step a request is waiting on right now (first PENDING one). Warehouse
 * check is included here; callers that list "approvals" drop it, because the
 * storekeeper works from the warehouse pages.
 */
export function currentPendingStep(request: MaterialRequestView): ApprovalStepView | undefined {
  return request.approvalSteps.find((s) => s.status === "PENDING");
}

/**
 * Whether `userId` is the person this step is waiting on. Stage 2 is decided by
 * the department's live head (the server authorises on it too), so a head
 * reassignment is honoured even before the step row is re-pointed; every other
 * stage is the user the step was assigned to.
 */
export function isStepAssignedTo(request: MaterialRequestView, step: ApprovalStepView, userId: string | undefined | null): boolean {
  if (!userId) return false;
  if (step.type === "DEPARTMENT_HEAD" && request.departmentHeadId !== undefined) {
    return request.departmentHeadId === userId;
  }
  return step.assignedUserId === userId;
}

/**
 * Requests in a user's approval queue: the current pending step is an approval
 * step (not the warehouse check) and is assigned to them. ADMIN oversees every
 * pending approval.
 */
export function approvalQueueFor(
  requests: MaterialRequestView[],
  userId: string | undefined | null,
  role: string | undefined | null
): (MaterialRequestView & { pendingStep: ApprovalStepView })[] {
  const queue: (MaterialRequestView & { pendingStep: ApprovalStepView })[] = [];
  for (const request of requests) {
    const pendingStep = currentPendingStep(request);
    // Warehouse check and Manager procurement are worked from their own pages; neither is an approval.
    if (!pendingStep || pendingStep.type === "WAREHOUSE_CHECK" || pendingStep.type === "MANAGER_PROCUREMENT") continue;
    // The price review belongs to the MANAGER role as a whole (no single assignee).
    if (pendingStep.type === "MANAGER_PRICING" && role === "MANAGER") {
      queue.push({ ...request, pendingStep });
      continue;
    }
    if (role === "ADMIN" || isStepAssignedTo(request, pendingStep, userId)) queue.push({ ...request, pendingStep });
  }
  return queue;
}
