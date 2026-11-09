import bcrypt from "bcrypt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { LIMITS } from "@/lib/login-throttle";

// POST /api/me/password: guessing the current password is rate limited like logging in is.
// Only the session lookup is replaced; the route, the limiter and PostgreSQL are real.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { POST } from "./password/route";

const P = "pwt-";
const TAG = Date.now().toString(36);
const OLD = "Old-password-1";
const NEW = "Brand-new-pw-2";
let hash = "";
let n = 0;
const created: string[] = [];

async function user() {
  n += 1;
  const id = `${P}${TAG}-${n}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role: "EMPLOYEE", passwordHash: hash } });
  created.push(id);
  return id;
}
const as = (id: string | null) => {
  session.current = id ? { user: { id, role: "EMPLOYEE", name: id, email: `${id}@test.local` } } : null;
};
const change = (current: string, next = NEW, confirm = next, ip = "198.51.100.20") =>
  POST(
    new Request("http://localhost/api/me/password", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ currentPassword: current, newPassword: next, confirmPassword: confirm }),
    })
  );
const passwordOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash;
let ipCounter = 0;
const ip = () => `10.77.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY", "hops:1");
  hash = await bcrypt.hash(OLD, 4);
  await prisma.loginThrottle.deleteMany();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.stubEnv("TRUSTED_PROXY", "hops:1");
  await prisma.loginThrottle.deleteMany();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.loginThrottle.deleteMany();
  await prisma.auditLog.deleteMany({ where: { actorId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe("existing behaviour is unchanged", () => {
  it("401 without a session; a correct current password changes it (200) and the audit entry is written", async () => {
    as(null);
    expect((await change(OLD)).status).toBe(401);
    const id = await user();
    as(id);
    expect((await change(OLD, NEW, NEW, ip())).status).toBe(200);
    expect(await bcrypt.compare(NEW, await passwordOf(id))).toBe(true);
    expect(await prisma.auditLog.count({ where: { actorId: id, action: "CHANGE_PASSWORD" } })).toBe(1);
  });

  it("a wrong current password is the same 401 as before; validation errors are still 400", async () => {
    const id = await user();
    as(id);
    const before = await passwordOf(id);
    const wrong = await change("not-it", NEW, NEW, ip());
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe("Одоогийн нууц үг буруу байна");
    expect((await change(OLD, "short", "short", ip())).status).toBe(400);
    expect((await change(OLD, NEW, "different-1", ip())).status).toBe(400);
    expect(await passwordOf(id)).toBe(before);
  });
});

describe("current-password guessing is limited", () => {
  it("5 wrong guesses are 401, then 429 with Retry-After, and even the right password changes nothing while blocked", async () => {
    const id = await user();
    as(id);
    const compare = vi.spyOn(bcrypt, "compare");
    const before = await passwordOf(id);
    for (let i = 0; i < LIMITS.passwordUser; i++) expect((await change("guess", NEW, NEW, ip())).status, `guess ${i + 1}`).toBe(401);
    expect(compare).toHaveBeenCalledTimes(LIMITS.passwordUser);
    const blocked = await change(OLD, NEW, NEW, ip());
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(blocked.headers.get("Retry-After"))).toBeLessThanOrEqual(15 * 60);
    expect((await change("guess", NEW, NEW, ip())).status).toBe(429);
    expect(compare).toHaveBeenCalledTimes(LIMITS.passwordUser); // refused before any bcrypt work
    expect(await passwordOf(id)).toBe(before);
  });

  it("changing the address does not give a fresh budget (the limit is per account)", async () => {
    const id = await user();
    as(id);
    for (let i = 0; i < LIMITS.passwordUser; i++) await change("guess", NEW, NEW, ip());
    expect((await change(OLD, NEW, NEW, ip())).status).toBe(429);
    expect((await change(OLD, NEW, NEW, "203.0.113.99")).status).toBe(429);
  });

  it("20 simultaneous guesses: exactly 5 are evaluated", async () => {
    const id = await user();
    as(id);
    const compare = vi.spyOn(bcrypt, "compare");
    const statuses = await Promise.all(Array.from({ length: 20 }, () => change("guess", NEW, NEW, ip()).then((r) => r.status)));
    expect(statuses.filter((s) => s === 401)).toHaveLength(LIMITS.passwordUser);
    expect(statuses.filter((s) => s === 429)).toHaveLength(20 - LIMITS.passwordUser);
    expect(compare).toHaveBeenCalledTimes(LIMITS.passwordUser);
  });

  it("a burst that includes the right password changes it at most once and evaluates at most 5", async () => {
    const id = await user();
    as(id);
    const statuses = await Promise.all(Array.from({ length: 20 }, (_, i) => change(i === 11 ? OLD : "guess", NEW, NEW, ip()).then((r) => r.status)));
    expect(statuses.filter((s) => s === 401 || s === 200).length).toBeLessThanOrEqual(LIMITS.passwordUser);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1);
  });

  it("a success clears the account's budget; invalid input (400) costs nothing", async () => {
    const id = await user();
    as(id);
    for (let i = 0; i < 4; i++) await change("guess", NEW, NEW, ip());
    for (let i = 0; i < 10; i++) expect((await change("guess", NEW, "mismatch-9", ip())).status).toBe(400); // never reaches the check
    expect((await change(OLD, NEW, NEW, ip())).status).toBe(200); // the 5th real attempt still allowed
    // the password is now NEW and the budget is fresh again
    for (let i = 0; i < LIMITS.passwordUser; i++) expect((await change(OLD, "Another-pw-3", "Another-pw-3", ip())).status).toBe(401);
    expect((await change(NEW, "Another-pw-3", "Another-pw-3", ip())).status).toBe(429);
  });

  it("one user's guessing does not affect another user, even from the same address", async () => {
    const a = await user();
    const b = await user();
    const shared = ip();
    as(a);
    for (let i = 0; i < LIMITS.passwordUser + 2; i++) await change("guess", NEW, NEW, shared);
    as(b);
    expect((await change(OLD, NEW, NEW, shared)).status).toBe(200);
  });
});

describe("limiter failure", () => {
  it("refuses with a generic 503 (no detail), before any bcrypt work, and leaves the password alone", async () => {
    const id = await user();
    as(id);
    const compare = vi.spyOn(bcrypt, "compare");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await passwordOf(id);
    await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle" RENAME TO "LoginThrottle_away"`);
    let res: Response;
    try {
      res = await change(OLD, NEW, NEW, ip());
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle_away" RENAME TO "LoginThrottle"`);
    }
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/LoginThrottle|relation|postgres|SELECT|INSERT/i);
    expect(compare).not.toHaveBeenCalled();
    expect(await passwordOf(id)).toBe(before);
    expect((await change(OLD, NEW, NEW, ip())).status).toBe(200); // works again once the table is back
  });
});
