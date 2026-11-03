import type { Session } from "next-auth";

export function requireAdmin(session: Session | null): session is Session {
  return !!session && session.user.role === "ADMIN";
}
