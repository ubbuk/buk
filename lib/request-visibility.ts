import type { Prisma } from "@prisma/client";

type VisibilityStep = { type: string; status: string; assignedUserId: string | null; decidedById?: string | null };
type VisibilityRequest = {
  requestedById: string;
  department: { headId: string | null };
  approvalSteps: VisibilityStep[];
};

const LATE_STEPS = new Set(["BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL", "MANAGER_PROCUREMENT", "ACCOUNTING_RECORD"]);

// Roles that read requests across every department as part of the job:
// warehouse, engineering, finance/executive directors, accounting, the
// MANAGER who prices requests, and ADMIN. EMPLOYEE and BOSS are not on this
// list.
const GLOBAL_READ_ROLES = new Set(["ADMIN", "DIRECTOR", "MANAGER", "STOREKEEPER", "CHIEF_ACCOUNTANT", "ENGINEERING"]);

// Read policy for a request:
//  - ADMIN sees everything.
//  - EMPLOYEE sees ONLY requests they created themselves -- not a colleague's,
//    even in the same department, and not by being named on a step.
//  - The requester always sees their own request.
//  - BOSS sees requests of departments they currently head (never merely
//    because they belong to the department).
//  - Anyone assigned to, or who already decided, a step of the request is a
//    participant and keeps access. Stages 3-6 (branch, finance, executive,
//    accounting) additionally only see a request once the warehouse has
//    approved it AND left a shortfall for them -- if the warehouse hasn't
//    decided yet, or it fully covered the request (those steps become SKIPPED),
//    the request stays invisible to them.
//  - The other global read roles above see requests they hold no step on; one
//    who does hold a stage 3-6 step is restricted like any approver.
// Everyone else gets a 404.
export function isRequestHiddenFrom(request: VisibilityRequest, userId: string, role: string | undefined | null): boolean {
  if (role === "ADMIN") return false;
  if (request.requestedById === userId) return false;
  if (role === "EMPLOYEE") return true;
  if (request.department.headId === userId) return false;
  if (request.approvalSteps.some((s) => s.decidedById === userId)) return false;

  const mine = request.approvalSteps.filter((s) => s.assignedUserId === userId);
  if (mine.length > 0) {
    if (mine.some((s) => !LATE_STEPS.has(s.type))) return false;
    const warehouseApproved = request.approvalSteps.some((s) => s.type === "WAREHOUSE_CHECK" && s.status === "APPROVED");
    return !(warehouseApproved && mine.some((s) => s.status !== "SKIPPED"));
  }

  return !(role && GLOBAL_READ_ROLES.has(role));
}

// DB-side pre-filter matching isRequestHiddenFrom's coarse rules, for endpoints
// that page/limit in SQL (search). Callers still run isRequestHiddenFrom over
// the rows for the stage 3-6 refinement. undefined = no restriction.
export function requestScopeWhere(userId: string, role: string | undefined | null): Prisma.MaterialRequestWhereInput | undefined {
  if (role && GLOBAL_READ_ROLES.has(role)) return undefined;
  if (role === "EMPLOYEE") return { requestedById: userId };
  return {
    OR: [
      { requestedById: userId },
      { department: { headId: userId } },
      { approvalSteps: { some: { OR: [{ assignedUserId: userId }, { decidedById: userId }] } } },
    ],
  };
}

export const visibilitySelect = {
  requestedById: true,
  department: { select: { headId: true } },
  approvalSteps: { select: { type: true, status: true, assignedUserId: true, decidedById: true } },
} as const;
