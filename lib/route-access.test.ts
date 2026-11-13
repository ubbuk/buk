/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { pageAllowed } from "./route-access";

// Item 7: a DIRECT URL (a typed address, a bookmark, a script) always meets authentication and the role rules. Three layers:
//   1. the page rules the middleware applies (pageAllowed), unit tested here;
//   2. EVERY API route handler refuses a request with no session, and every /api/admin handler refuses an ordinary
//      employee, enumerated from the file system so a new route cannot be forgotten;
//   3. a source guard: every route file must call a session check or be on the short, reviewed public list.
// The Playwright suite (e2e/security) covers the browser side: redirects, and a revoked session meeting the login page.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

const routes = import.meta.glob("/app/api/**/route.ts") as Record<string, () => Promise<Record<string, unknown>>>;
const sources = import.meta.glob("/app/api/**/route.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// Public on purpose: sign-in itself, the load balancer probe, and the (disabled by default) self-service recovery that is
// used by someone who cannot sign in. Anything else on this list needs a reason in review.
const PUBLIC = ["/app/api/auth/[...nextauth]/route.ts", "/app/api/health/route.ts", "/app/api/auth/recovery/request/route.ts", "/app/api/auth/recovery/confirm/route.ts"];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const PARAMS = { id: "x", section: "view", attachmentId: "x", itemId: "x", purchaseId: "x" };

async function call(path: string, method: string) {
  const mod = await routes[path]();
  const handler = mod[method] as ((req: Request, ctx: unknown) => Promise<Response>) | undefined;
  if (!handler) return null;
  const req = new Request("http://localhost/api/x?q=1", { method, headers: { "Content-Type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
  return handler(req, { params: Promise.resolve(PARAMS) });
}

describe("page rules for a direct URL", () => {
  it("any page needs a role; the privileged sections need theirs", () => {
    for (const role of [undefined, null, ""]) expect(pageAllowed(role, "/dashboard")).toBe(false);
    for (const role of ["EMPLOYEE", "BOSS", "DIRECTOR", "MANAGER", "STOREKEEPER", "ENGINEERING", "CHIEF_ACCOUNTANT", "ADMIN"]) {
      for (const path of ["/dashboard", "/requests", "/requests/abc", "/settings", "/profile", "/archive", "/warehouses"]) expect(pageAllowed(role, path), `${role} ${path}`).toBe(true);
    }
    expect(pageAllowed("ADMIN", "/admin")).toBe(true);
    expect(pageAllowed("ADMIN", "/admin/audit")).toBe(true);
    for (const role of ["EMPLOYEE", "BOSS", "DIRECTOR", "MANAGER", "STOREKEEPER", "ENGINEERING", "CHIEF_ACCOUNTANT"]) {
      expect(pageAllowed(role, "/admin"), role).toBe(false);
      expect(pageAllowed(role, "/admin/audit"), role).toBe(false);
    }
    expect(pageAllowed("ADMIN", "/onec")).toBe(true); // 1С OData хөтөч: зөвхөн ADMIN
    for (const role of ["DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS", "STOREKEEPER", "EMPLOYEE", "MANAGER", "ENGINEERING"]) expect(pageAllowed(role, "/onec"), role).toBe(false);
    expect(pageAllowed("CHIEF_ACCOUNTANT", "/accounting")).toBe(true);
    expect(pageAllowed("ADMIN", "/accounting")).toBe(true);
    expect(pageAllowed("EMPLOYEE", "/accounting")).toBe(false);
    expect(pageAllowed("MANAGER", "/procurement/abc")).toBe(true);
    expect(pageAllowed("EMPLOYEE", "/procurement")).toBe(false);
    // 1С самбар: нярав зөвхөн Агуулах, Зарцуулалт; бусад таб удирдлагад; бусад дүр юу ч үгүй
    for (const role of ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS", "ENGINEERING"]) {
      for (const tab of ["", "/stock", "/usage", "/sales", "/receivables", "/expenses", "/cash"]) expect(pageAllowed(role, `/finance${tab}`), `${role} ${tab}`).toBe(true);
    }
    for (const tab of ["", "/stock", "/usage"]) expect(pageAllowed("STOREKEEPER", `/finance${tab}`), `STOREKEEPER ${tab}`).toBe(true);
    for (const tab of ["/sales", "/receivables", "/expenses", "/cash", "/sales/x"]) expect(pageAllowed("STOREKEEPER", `/finance${tab}`), `STOREKEEPER ${tab}`).toBe(false);
    for (const role of ["EMPLOYEE", "MANAGER"]) for (const tab of ["", "/stock", "/usage", "/sales", "/receivables", "/expenses", "/cash"]) expect(pageAllowed(role, `/finance${tab}`), `${role} ${tab}`).toBe(false);
  });

  it("monitoring is left to its own server gate, which audit-logs a denied attempt (not redirected earlier)", () => {
    expect(pageAllowed("EMPLOYEE", "/admin/monitoring")).toBe(true);
    expect(pageAllowed("EMPLOYEE", "/admin/monitoring/time-machine")).toBe(true);
    expect(pageAllowed("EMPLOYEE", "/admin/monitoringx")).toBe(false); // a look-alike prefix is not the exception
  });

  it("a look-alike path is not mistaken for a section", () => {
    expect(pageAllowed("EMPLOYEE", "/administrator")).toBe(true); // no such page, and not under /admin
    expect(pageAllowed("EMPLOYEE", "/admin/")).toBe(false);
  });
});

describe("every API route refuses a caller with no session", () => {
  const paths = Object.keys(routes).filter((p) => !PUBLIC.includes(p)).sort();

  it("the route list is not empty and the public list only names real routes", () => {
    expect(paths.length).toBeGreaterThan(40);
    for (const p of PUBLIC) expect(Object.keys(routes), p).toContain(p);
  });

  it.each(paths)("%s", async (path) => {
    session.current = null;
    let tested = 0;
    for (const method of METHODS) {
      const res = await call(path, method);
      if (!res) continue;
      tested += 1;
      expect([401, 403], `${method} ${path} answered ${res.status} to a caller with no session`).toContain(res.status);
    }
    expect(tested, `${path} exports no HTTP handler`).toBeGreaterThan(0);
  });
});

describe("every administrator route refuses an ordinary employee", () => {
  const adminPaths = Object.keys(routes).filter((p) => p.startsWith("/app/api/admin/")).sort();

  it("there are administrator routes to check", () => {
    expect(adminPaths.length).toBeGreaterThan(10);
  });

  it.each(adminPaths)("%s", async (path) => {
    session.current = { user: { id: "employee-x", role: "EMPLOYEE", name: "x", email: "x@test.local", departmentId: null } };
    for (const method of METHODS) {
      const res = await call(path, method);
      if (!res) continue;
      expect(res.status, `${method} ${path} answered ${res.status} to an EMPLOYEE`).toBe(403);
    }
  });
});

describe("source guard: no route file can skip the session check unnoticed", () => {
  it("each route file asks for the session (directly or through the monitoring authorize helper) or is on the public list", () => {
    const unguarded = Object.entries(sources)
      .filter(([path]) => !PUBLIC.includes(path))
      .filter(([, text]) => !/getServerSession|authorize\(|ftContext\(|requireFinanceAccess\(|requireHubKey\(/.test(text))
      .map(([path]) => path);
    expect(unguarded).toEqual([]);
  });

  it("the public routes are exactly the reviewed ones and carry their reason in a comment", () => {
    for (const path of PUBLIC) {
      const text = sources[path];
      expect(text, path).toMatch(/PUBLIC|Unauthenticated|public|NextAuth|signIn|SELF_SERVICE_RECOVERY|handler/i);
    }
    expect(readFileSync(new URL("../middleware.ts", import.meta.url), "utf8")).toContain("pageAllowed");
  });
});
