// What counts as an AUTHORITY GRANT, and what a position requires. Pure data and functions (no database, no server
// imports) so the admin UI and the API routes use exactly the same definitions.

/**
 * A role carries privileges unless it is EMPLOYEE. ADMIN counts: an ADMIN can manage every other account. Moving
 * to any privileged role (from EMPLOYEE or from another privileged role) is a grant of new authority; moving
 * to EMPLOYEE is a demotion and needs no step-up.
 */
export function isPrivilegedRole(role: string): boolean {
  return role !== "EMPLOYEE";
}

export function roleChangeIsGrant(oldRole: string, newRole: string): boolean {
  return newRole !== oldRole && isPrivilegedRole(newRole);
}

/** The role a person needs to hold an approval position (the same mapping the admin screen offers). */
export const POSITION_REQUIRED_ROLE: Record<string, string> = {
  ENGINEERING_CHIEF: "ENGINEERING",
  OPERATIONS_DIRECTOR: "DIRECTOR",
  FINANCE_DIRECTOR: "DIRECTOR",
  EXECUTIVE_DIRECTOR: "DIRECTOR",
  STOREKEEPER_LEAD: "STOREKEEPER",
  CHIEF_ACCOUNTANT_LEAD: "CHIEF_ACCOUNTANT",
  DOMESTIC_PROCUREMENT_MANAGER: "MANAGER",
  INTERNATIONAL_PROCUREMENT_MANAGER: "MANAGER",
};

export function positionEligibilityError(position: string, candidate: { role: string; isActive: boolean } | null): string | null {
  if (!candidate) return "Хэрэглэгч олдсонгүй";
  if (!candidate.isActive) return "Идэвхгүй хэрэглэгчийг энэ албан тушаалд томилох боломжгүй";
  const required = POSITION_REQUIRED_ROLE[position];
  if (required && candidate.role !== required) return `Энэ албан тушаалд зөвхөн «${required}» эрхтэй хэрэглэгчийг томилно`;
  return null;
}
