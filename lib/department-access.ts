type Actor = { role?: string | null; departmentId?: string | null };

/**
 * A request may only be filed for the requester's own department. ADMIN is the
 * single explicit exception (can file on behalf of any department). Everyone
 * else, including a user with no department, is bound to their own.
 */
export function canCreateRequestForDepartment(actor: Actor, departmentId: string): boolean {
  if (actor.role === "ADMIN") return true;
  return !!actor.departmentId && actor.departmentId === departmentId;
}

type HeadCandidate = { role: string; isActive: boolean } | null | undefined;

/** A department head must be an existing, active user holding the BOSS role. */
export function departmentHeadError(candidate: HeadCandidate): string | null {
  if (!candidate) return "Хэрэглэгч олдсонгүй";
  if (!candidate.isActive) return "Идэвхгүй хэрэглэгчийг цехийн даргаар томилох боломжгүй";
  if (candidate.role !== "BOSS") return "Зөвхөн «Цехийн дарга» (BOSS) эрхтэй хэрэглэгчийг цехийн даргаар томилно";
  return null;
}
