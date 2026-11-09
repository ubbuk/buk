import { prisma } from "./prisma";

// Private employee profile, phase 1: what a signed-in employee sees about THEMSELVES. It is served
// from the existing User / Department rows (no new table: every phase-1 field already lives there).
//
// Privacy rules this module enforces by construction:
//  - the only input is the id of the authenticated session's user; there is no way to ask for anybody
//    else (the route takes no id, and ADMIN gets no exception: an admin sees their own profile here);
//  - fields are picked explicitly, so a new column on User can never leak through this path, and the
//    password hash, PIN credential, login times and ids are not selectable at all.
const PROFILE_SELECT = {
  name: true,
  email: true,
  title: true,
  role: true,
  isActive: true,
  department: { select: { name: true, type: true } },
} as const;

export interface OwnProfile {
  name: string;
  email: string;
  /** Job title as entered by an administrator, if any. */
  title: string | null;
  role: string;
  isActive: boolean;
  department: { name: string; type: "OFFICE" | "FACTORY" } | null;
}

/** The profile of the user the SESSION belongs to. Never call this with an id taken from a request. */
export async function getOwnProfile(sessionUserId: string): Promise<OwnProfile | null> {
  const user = await prisma.user.findUnique({ where: { id: sessionUserId }, select: PROFILE_SELECT });
  return user;
}
