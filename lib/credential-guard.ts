import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Which accounts must NOT have their password reset by an ADMIN through the temporary-password endpoint.
//
// That endpoint hands the administrator a working password. For an account that can authorise anything, that
// would let the administrator sign in as the employee, create an approval PIN with that password and act in
// their name. So "approval-capable" is decided from the database, not from a list of role names alone, and it
// follows the way this application actually grants authority:
//
//   ROLE             any role other than EMPLOYEE and ADMIN (BOSS, DIRECTOR, STOREKEEPER, ENGINEERING,
//                    CHIEF_ACCOUNTANT, MANAGER -- who commits spend, classifies and hands over procurement --
//                    and any role added in the future: new roles are protected until someone decides otherwise)
//   DEPARTMENT_HEAD  heads a department (department-head approval is authorised by Department.headId, whatever
//                    the user's role says)
//   POSITION         holds an active ApprovalRoleAssignment (branch / finance / executive / storekeeper /
//                    accountant / procurement-manager positions)
//   PENDING_STEP     is the assignee of an open approval step
//   PROCUREMENT      is the responsible manager of procurement items
//
// Whether the account is active does not matter: a deactivated account that still holds an assignment is
// protected too. Anything that cannot be determined (the database is unreachable, the user vanished) counts as
// approval-capable: the reset is refused, never allowed on a guess. Reasons are short codes for logs and
// tests; they are never shown to the administrator.

type Db = Prisma.TransactionClient | typeof prisma;

export type CapabilityReason = "ROLE" | "DEPARTMENT_HEAD" | "POSITION" | "PENDING_STEP" | "PROCUREMENT" | "UNDETERMINED";

export interface ApprovalCapability {
  capable: boolean;
  reasons: CapabilityReason[];
}

/** Roles that carry no authority of their own. Everything else is treated as approval-capable. */
const ROLES_WITHOUT_AUTHORITY = new Set<string>(["EMPLOYEE", "ADMIN"]);

export async function approvalCapability(db: Db, userId: string): Promise<ApprovalCapability> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return { capable: true, reasons: ["UNDETERMINED"] };

  const [heads, positions, steps, procurement] = await Promise.all([
    db.department.count({ where: { headId: userId } }),
    db.approvalRoleAssignment.count({ where: { userId, isActive: true } }),
    db.approvalStep.count({ where: { assignedUserId: userId, status: "PENDING" } }),
    db.procurementItemAssignment.count({ where: { assignedManagerId: userId } }),
  ]);

  const reasons: CapabilityReason[] = [];
  if (!ROLES_WITHOUT_AUTHORITY.has(user.role)) reasons.push("ROLE");
  if (heads > 0) reasons.push("DEPARTMENT_HEAD");
  if (positions > 0) reasons.push("POSITION");
  if (steps > 0) reasons.push("PENDING_STEP");
  if (procurement > 0) reasons.push("PROCUREMENT");
  return { capable: reasons.length > 0, reasons };
}

/** Same, but fails closed: any error means "treat as approval-capable". */
export async function approvalCapabilityOrUnknown(db: Db, userId: string): Promise<ApprovalCapability> {
  try {
    return await approvalCapability(db, userId);
  } catch (err) {
    console.error("[admin] approval capability check failed:", err instanceof Error ? err.name : "unknown");
    return { capable: true, reasons: ["UNDETERMINED"] };
  }
}
