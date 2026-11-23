import { prisma } from "./prisma";
import { APPROVER_ROLES } from "./types";

// Roles that decide with a PIN: the approver roles plus the MANAGER (the price review is decided by the role, not by a single assignee).
const PIN_ROLES = new Set<string>([...APPROVER_ROLES, "MANAGER"]);

/**
 * Whether this person decides things with a PIN: an approver or manager role, an active approval position
 * (finance / executive director, ...) or the head of a department. The settings page and the sign-in banner use it
 * to ask for a PIN before the first approval fails.
 */
export async function needsApprovalPin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, _count: { select: { approvalAssignments: { where: { isActive: true } }, headOfDepartments: true } } },
  });
  if (!user || !user.isActive) return false;
  return PIN_ROLES.has(user.role) || user._count.approvalAssignments > 0 || user._count.headOfDepartments > 0;
}
