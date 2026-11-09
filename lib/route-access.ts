// Which roles may open which pages by URL (the middleware applies it to a DIRECT visit, e.g. a bookmarked or typed address).
// Pure and edge-safe: no database, no server imports. This is a FIRST line only: it reads the role from the session cookie,
// which can be up to a session lifetime old. The authoritative checks stay where they were and are repeated for every request:
// the (app) layout re-validates the session against the database (revocation, deactivation) and every API route and data
// endpoint checks the role itself. Hiding a page never replaces refusing the data.
//
// /admin/monitoring (and Time Machine under it) is deliberately NOT listed: its own server layout refuses and AUDIT-LOGS a
// denied attempt (lib/monitoring/audit.ts), and redirecting earlier would silence that record.

interface Rule {
  prefix: string;
  roles: readonly string[];
  /** a sub-path that is handled by its own, stricter gate and must not be caught by this rule */
  except?: readonly string[];
}

const RULES: readonly Rule[] = [
  { prefix: "/admin", roles: ["ADMIN"], except: ["/admin/monitoring"] },
  { prefix: "/accounting", roles: ["CHIEF_ACCOUNTANT", "ADMIN"] },
  { prefix: "/procurement", roles: ["MANAGER", "ADMIN"] },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");

export function pageAllowed(role: string | undefined | null, pathname: string): boolean {
  if (!role) return false;
  for (const rule of RULES) {
    if (!under(pathname, rule.prefix)) continue;
    if (rule.except?.some((e) => under(pathname, e))) continue;
    return rule.roles.includes(role);
  }
  return true; // any other page: any signed-in role (the page and its API decide what that role sees)
}
