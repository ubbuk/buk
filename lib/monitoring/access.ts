import type { Session } from "next-auth";

// Monitoring exposes cross-department data, so it is limited to the roles that
// already oversee the whole system. Always evaluated on the server against the
// session (whose role is re-validated against the DB on every request, see the
// jwt callback in lib/auth.ts) -- never trust a client-supplied role.
const MONITORING_ROLES = new Set(["ADMIN", "DIRECTOR"]);

export function canViewMonitoring(role: string | undefined | null): boolean {
  return !!role && MONITORING_ROLES.has(role);
}

export function requireMonitoring(session: Session | null): session is Session {
  return !!session && canViewMonitoring(session.user.role);
}
