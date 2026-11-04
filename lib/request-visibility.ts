type VisibilityStep = { type: string; status: string; assignedUserId: string | null };
type VisibilityRequest = {
  requestedById: string;
  department: { headId: string | null };
  approvalSteps: VisibilityStep[];
};

const LATE_STEPS = new Set(["BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL", "ACCOUNTING_RECORD"]);

// Stages 3-6 (branch, finance, executive, accounting) only see a request once
// the warehouse has approved it AND left a shortfall for them -- if the
// warehouse hasn't decided yet, or it fully covered the request (those steps
// become SKIPPED), the request stays invisible to them. Requester, department
// head, storekeeper and ADMIN are never restricted. A DIRECTOR with no stage 3-6
// assignment still sees everything, but one who holds such a step is restricted like any approver.
export function isRequestHiddenFrom(request: VisibilityRequest, userId: string, role: string | undefined | null): boolean {
  if (role === "ADMIN") return false;
  if (request.requestedById === userId || request.department.headId === userId) return false;

  const mine = request.approvalSteps.filter((s) => s.assignedUserId === userId);
  if (mine.length === 0) return false;
  if (mine.some((s) => !LATE_STEPS.has(s.type))) return false;

  const warehouseApproved = request.approvalSteps.some((s) => s.type === "WAREHOUSE_CHECK" && s.status === "APPROVED");
  return !(warehouseApproved && mine.some((s) => s.status !== "SKIPPED"));
}
