import bcrypt from "bcrypt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authOptions } from "./auth";
import { prisma } from "./prisma";
import { LIMITS, WINDOW_MS, admit, loginBuckets, normalizeEmail, purgeStaleThrottles } from "./login-throttle";

// Login rate limiting against the isolated test database, through the real NextAuth `authorize`.
// The counters live in PostgreSQL and change by single atomic statements, so the concurrency tests fire
// many attempts at once (separate pooled connections stand in for separate app instances).
const P = "thr-";
const PASSWORD = "Correct-pw-1";
const TAG = Date.now().toString(36);
let hash = "";
let n = 0;
const created: string[] = [];

type Authorize = (credentials: { email: string; password: string }, req: { headers: Record<string, string> }) => Promise<unknown>;
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize;

// Our single trusted proxy appends the address it saw: with hops:1 that is the rightmost entry.
const from = (ip: string, spoofed = "") => ({ headers: { "x-forwarded-for": (spoofed ? `${spoofed}, ` : "") + ip } });
let ipCounter = 0;
// every test uses addresses of its own so the shared buckets of other tests never interfere
const uniqueIp = () => `10.${Math.floor(++ipCounter / 250) % 250}.${ipCounter % 250}.${(ipCounter * 7) % 250}`;

async function user(opts: { active?: boolean } = {}) {
  n += 1;
  const id = `${P}${TAG}-${n}`;
  const email = `${id}@Test.Local`;
  await prisma.user.create({ data: { id, email, name: id, role: "EMPLOYEE", passwordHash: hash, isActive: opts.active ?? true } });
  created.push(id);
  return { id, email };
}
const throttleCounts = async () => Object.fromEntries((await prisma.loginThrottle.findMany()).map((r) => [r.key.split(":").slice(0, 2).join(":"), r.count]));
const login = (email: string, password: string, ip: string) => authorize({ email, password }, from(ip));
const outcome = async (p: Promise<unknown>) => {
  try {
    return (await p) ? "ok" : "null";
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY", "hops:1");
  hash = await bcrypt.hash(PASSWORD, 4);
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
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe("a correct password still logs in and keeps the session behaviour", () => {
  it("returns the same user object, updates lastLoginAt and clears the failure counters", async () => {
    const u = await user();
    const ip = uniqueIp();
    expect(await outcome(login(u.email, "wrong", ip))).toBe("null");
    expect(await outcome(login(u.email, "wrong", ip))).toBe("null");
    const result = (await login(u.email, PASSWORD, ip)) as { id: string; email: string; role: string; departmentId: string | null };
    expect(result).toMatchObject({ id: u.id, email: u.email, role: "EMPLOYEE", departmentId: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt).not.toBeNull();
    // pair and account are cleared; the address keeps its 2 net failures (the success gave back only its own unit)
    expect(await throttleCounts()).toMatchObject({ "login:ip": 2, "login:pair": 0, "login:acct": 0 });
  });

  it("e-mail case, surrounding spaces and Unicode forms reach the same buckets as the login finds the account with", async () => {
    expect(normalizeEmail("  Ａdmin@Test.LOCAL ")).toBe("admin@test.local");
    const a = loginBuckets("User@Test.Local", "1.2.3.4").map((b) => b.key);
    expect(loginBuckets("  user@test.local ", "1.2.3.4").map((b) => b.key)).toEqual(a);
    expect(loginBuckets("user@test.local", "1.2.3.5").map((b) => b.key)).not.toEqual(a);
    // and no clear e-mail or address is ever part of a key
    for (const key of a) expect(key).not.toMatch(/user|test|1\.2\.3\.4/i);
  });
});

describe("wrong passwords", () => {
  it("5 wrong attempts are answered normally, the 6th is refused before any bcrypt work, even with the right password", async () => {
    const u = await user();
    const ip = uniqueIp();
    const compare = vi.spyOn(bcrypt, "compare");
    for (let i = 0; i < LIMITS.loginPair; i++) expect(await outcome(login(u.email, "wrong", ip)), `attempt ${i + 1}`).toBe("null");
    expect(compare).toHaveBeenCalledTimes(LIMITS.loginPair);
    expect(await outcome(login(u.email, "wrong", ip))).toBe("RATE_LIMITED");
    expect(await outcome(login(u.email, PASSWORD, ip))).toBe("RATE_LIMITED");
    expect(compare).toHaveBeenCalledTimes(LIMITS.loginPair); // refused attempts cost no bcrypt
  });

  it("an unknown or disabled account behaves exactly like a real one (no enumeration, same bcrypt work)", async () => {
    const disabled = await user({ active: false });
    const compare = vi.spyOn(bcrypt, "compare");
    for (const email of [`nobody-${TAG}@test.local`, disabled.email]) {
      const ip = uniqueIp();
      compare.mockClear();
      const seen: string[] = [];
      for (let i = 0; i < LIMITS.loginPair + 2; i++) seen.push(await outcome(login(email, PASSWORD, ip)));
      expect(seen).toEqual(["null", "null", "null", "null", "null", "RATE_LIMITED", "RATE_LIMITED"]);
      expect(compare).toHaveBeenCalledTimes(LIMITS.loginPair); // a dummy comparison stands in for the missing hash
    }
  });

  it("a correct login between failures restarts the budget", async () => {
    const u = await user();
    const ip = uniqueIp();
    for (let i = 0; i < 4; i++) await outcome(login(u.email, "wrong", ip));
    expect(await outcome(login(u.email, PASSWORD, ip))).toBe("ok");
    for (let i = 0; i < 5; i++) expect(await outcome(login(u.email, "wrong", ip))).toBe("null");
    expect(await outcome(login(u.email, "wrong", ip))).toBe("RATE_LIMITED");
  });
});

describe("concurrency", () => {
  it("40 simultaneous guesses on one account from one address: exactly 5 are evaluated", async () => {
    const u = await user();
    const ip = uniqueIp();
    const compare = vi.spyOn(bcrypt, "compare");
    const results = await Promise.all(Array.from({ length: 40 }, () => outcome(login(u.email, "wrong", ip))));
    expect(results.filter((r) => r === "null")).toHaveLength(LIMITS.loginPair);
    expect(results.filter((r) => r === "RATE_LIMITED")).toHaveLength(35);
    expect(compare).toHaveBeenCalledTimes(LIMITS.loginPair);
  });

  it("a burst that includes the right password still gets at most 5 evaluations", async () => {
    for (let round = 0; round < 3; round++) {
      const u = await user();
      const ip = uniqueIp();
      const pws = Array.from({ length: 50 }, (_, i) => (i === 33 ? PASSWORD : "wrong"));
      const results = await Promise.all(pws.map((p) => outcome(login(u.email, p, ip))));
      expect(results.filter((r) => r === "null" || r === "ok").length).toBeLessThanOrEqual(LIMITS.loginPair);
    }
  });

  it("spraying one account from many addresses is capped by the account limit", async () => {
    const u = await user();
    const results = await Promise.all(Array.from({ length: 60 }, () => outcome(login(u.email, "wrong", uniqueIp()))));
    expect(results.filter((r) => r === "null")).toHaveLength(LIMITS.loginAccount);
    expect(results.filter((r) => r === "RATE_LIMITED")).toHaveLength(60 - LIMITS.loginAccount);
  });

  it("counters stay exact under a mixed concurrent load on shared buckets", async () => {
    const ip = uniqueIp();
    const users = await Promise.all(Array.from({ length: 6 }, () => user()));
    const jobs = users.flatMap((u) => Array.from({ length: 10 }, () => outcome(login(u.email, "wrong", ip))));
    const results = await Promise.all(jobs);
    expect(results.filter((r) => r === "null")).toHaveLength(6 * LIMITS.loginPair); // 5 per account/address pair
    const counts = await throttleCounts();
    expect(counts["login:ip"]).toBe(60); // every attempt, even a refused one, used an address unit
  });
});

describe("one attacker cannot lock the real user out", () => {
  it("an attacker exhausts only their own pair; refused attempts never reach the account bucket", async () => {
    const victim = await user();
    const attackerIp = uniqueIp();
    for (let i = 0; i < 50; i++) await outcome(login(victim.email, "guess", attackerIp));
    const counts = await throttleCounts();
    expect(counts["login:pair"]).toBe(LIMITS.loginPair);
    expect(counts["login:acct"]).toBe(LIMITS.loginPair); // not 50
    // the real user, from their own address, logs in normally
    expect(await outcome(login(victim.email, PASSWORD, uniqueIp()))).toBe("ok");
  });

  it("only a distributed attack (accountLimit / pairLimit addresses) can lock an account, and it ends by itself", async () => {
    const victim = await user();
    for (let i = 0; i < LIMITS.loginAccount / LIMITS.loginPair; i++) {
      const ip = uniqueIp();
      for (let j = 0; j < LIMITS.loginPair; j++) await outcome(login(victim.email, "guess", ip));
    }
    expect(await outcome(login(victim.email, PASSWORD, uniqueIp()))).toBe("RATE_LIMITED");
    // the window passes: everything is allowed again without any clean-up job
    await prisma.$executeRaw`UPDATE "LoginThrottle" SET "windowStart" = "windowStart" - interval '16 minutes'`;
    expect(await outcome(login(victim.email, PASSWORD, uniqueIp()))).toBe("ok");
  });

  it("a whole office behind one address does not lock itself: successful logins give their unit back", async () => {
    const ip = uniqueIp();
    const staff = await Promise.all(Array.from({ length: 12 }, () => user()));
    for (let round = 0; round < 15; round++) {
      const results = await Promise.all(staff.map((u) => outcome(login(u.email, PASSWORD, ip))));
      expect(results.every((r) => r === "ok")).toBe(true); // 180 successful logins from one address
    }
    expect((await throttleCounts())["login:ip"]).toBe(0);
  });

  it("an address that fails too often is stopped for every account (spraying), then recovers when the window passes", async () => {
    const ip = uniqueIp();
    vi.spyOn(bcrypt, "compare").mockResolvedValue(false as never); // only the counting matters here
    const seen: string[] = [];
    for (let i = 0; i < LIMITS.loginIp + 3; i++) seen.push(await outcome(login(`nobody-${i}-${TAG}@test.local`, "x", ip)));
    expect(seen.filter((r) => r === "null")).toHaveLength(LIMITS.loginIp);
    expect(seen.slice(LIMITS.loginIp)).toEqual(["RATE_LIMITED", "RATE_LIMITED", "RATE_LIMITED"]);
    vi.restoreAllMocks();
    const u = await user();
    expect(await outcome(login(u.email, PASSWORD, ip))).toBe("RATE_LIMITED"); // even a valid account from that address
    await prisma.$executeRaw`UPDATE "LoginThrottle" SET "windowStart" = "windowStart" - interval '16 minutes'`;
    expect(await outcome(login(u.email, PASSWORD, ip))).toBe("ok");
  });
});

describe("expiry, reset and clean-up", () => {
  it("an expired window counts as empty and restarts at 1", async () => {
    const u = await user();
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) await outcome(login(u.email, "wrong", ip));
    expect(await outcome(login(u.email, PASSWORD, ip))).toBe("RATE_LIMITED");
    const [pair] = loginBuckets(u.email, ip).filter((b) => b.key.startsWith("login:pair:"));
    await prisma.loginThrottle.update({ where: { key: pair.key }, data: { windowStart: new Date(Date.now() - WINDOW_MS - 60_000) } });
    expect(await outcome(login(u.email, "wrong", ip))).toBe("null"); // allowed again...
    expect((await prisma.loginThrottle.findUniqueOrThrow({ where: { key: pair.key } })).count).toBe(1); // ...and counting from 1
    expect(Date.now() - (await prisma.loginThrottle.findUniqueOrThrow({ where: { key: pair.key } })).windowStart.getTime()).toBeLessThan(60_000);
  });

  it("the window is measured by the database clock in UTC, whatever the session time zone", async () => {
    const [bucket] = loginBuckets("tz@test.local", null);
    await admit([bucket]);
    const row = await prisma.loginThrottle.findUniqueOrThrow({ where: { key: bucket.key } });
    expect(Math.abs(Date.now() - row.windowStart.getTime())).toBeLessThan(60_000);
    expect(Math.abs(Date.now() - row.updatedAt.getTime())).toBeLessThan(60_000);
  });

  it("purgeStaleThrottles removes buckets long past their window and keeps current and recent ones", async () => {
    const old = new Date(Date.now() - WINDOW_MS - 3 * 60 * 60 * 1000);
    const recentlyExpired = new Date(Date.now() - WINDOW_MS - 5 * 60 * 1000);
    await prisma.loginThrottle.createMany({
      data: [
        { key: "login:acct:old-1", count: 3, windowStart: old, updatedAt: old },
        { key: "login:acct:old-2", count: 3, windowStart: old, updatedAt: old },
        { key: "login:acct:recent", count: 3, windowStart: recentlyExpired, updatedAt: recentlyExpired },
        { key: "login:acct:live", count: 3, windowStart: new Date(), updatedAt: new Date() },
      ],
    });
    expect(await purgeStaleThrottles()).toBe(2);
    expect((await prisma.loginThrottle.findMany({ orderBy: { key: "asc" } })).map((r) => r.key)).toEqual(["login:acct:live", "login:acct:recent"]);
    // a batch limit is honoured
    await prisma.loginThrottle.createMany({ data: [1, 2, 3].map((i) => ({ key: `login:acct:o${i}`, count: 1, windowStart: old, updatedAt: old })) });
    expect(await purgeStaleThrottles(2)).toBe(2);
    expect(await purgeStaleThrottles(2)).toBe(1);
  });
});

describe("address handling cannot be spoofed", () => {
  it("hops:1 — headers a client prepends do not give it a fresh budget", async () => {
    const u = await user();
    const ip = uniqueIp();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => outcome(authorize({ email: u.email, password: "wrong" }, from(ip, `9.9.${i}.${i}`)))) // a different forged left side each time
    );
    expect(results.filter((r) => r === "null")).toHaveLength(LIMITS.loginPair);
  });

  it("TRUSTED_PROXY unset off Vercel (or 'none'): headers are ignored, only the account bucket applies", async () => {
    vi.stubEnv("TRUSTED_PROXY", "none");
    const u = await user();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => outcome(authorize({ email: u.email, password: "wrong" }, from(`203.0.113.${i + 1}`)))));
    expect(results.filter((r) => r === "null")).toHaveLength(LIMITS.loginAccount);
    const counts = await throttleCounts();
    expect(counts["login:ip"]).toBeUndefined(); // nothing is keyed by an address nobody vouches for
    expect(counts["login:pair"]).toBeUndefined();
  });

  it("with no usable address header on a trusted-proxy setup, nothing by address is invented", async () => {
    const u = await user();
    expect(await outcome(authorize({ email: u.email, password: PASSWORD }, { headers: {} }))).toBe("ok");
    expect((await throttleCounts())["login:ip"]).toBeUndefined();
  });
});

describe("database failure", () => {
  // The limiter's table is made unavailable for real (renamed inside the isolated test database), instead of mocking Prisma.
  async function withoutTable<T>(fn: () => Promise<T>): Promise<T> {
    await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle" RENAME TO "LoginThrottle_away"`);
    try {
      return await fn();
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle_away" RENAME TO "LoginThrottle"`);
    }
  }

  it("fails closed with a generic error that carries no detail, and does no bcrypt work", async () => {
    const u = await user();
    const compare = vi.spyOn(bcrypt, "compare");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await withoutTable(async () => {
      try {
        await login(u.email, PASSWORD, uniqueIp());
        return null;
      } catch (e) {
        return e as Error;
      }
    });
    expect(error?.message).toBe("THROTTLE_UNAVAILABLE");
    expect(compare).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
    for (const call of logged.mock.calls) expect(JSON.stringify(call)).not.toMatch(/LoginThrottle|relation|does not exist|SELECT|INSERT|postgres/i);
    // and the next attempt works again once the database is back
    vi.restoreAllMocks();
    expect(await outcome(login(u.email, PASSWORD, uniqueIp()))).toBe("ok");
  });

  it("a failure while clearing the counters after a good login does not turn it into a failure", async () => {
    const u = await user();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // takes still work (count >= 1) but resetting a bucket to 0 is rejected by the database
    await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle" ADD CONSTRAINT "tmp_no_zero" CHECK ("count" <> 0)`);
    try {
      expect(await outcome(login(u.email, PASSWORD, uniqueIp()))).toBe("ok");
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "LoginThrottle" DROP CONSTRAINT "tmp_no_zero"`);
    }
  });
});

describe("keep buckets (plain rate limits)", () => {
  it("a bucket marked keep is not cleared or refunded by a success, while reset and refund buckets still are", async () => {
    const key = (name: string) => `pwd:test:${name}-${TAG}`;
    const buckets = [
      { key: key("keep"), limit: 10, onSuccess: "keep" as const },
      { key: key("reset"), limit: 10, onSuccess: "reset" as const },
      { key: key("refund"), limit: 10, onSuccess: "refund" as const },
    ];
    for (let i = 0; i < 3; i++) {
      const a = await admit(buckets);
      expect(a.ok).toBe(true);
      if (a.ok && i === 2) await a.settle();
    }
    const rows = Object.fromEntries((await prisma.loginThrottle.findMany({ where: { key: { in: buckets.map((b) => b.key) } } })).map((r) => [r.key, r.count]));
    expect(rows[key("keep")]).toBe(3); // untouched
    expect(rows[key("reset")]).toBe(0);
    expect(rows[key("refund")]).toBe(2); // one unit given back
    // and it blocks at its limit like the others
    const small = [{ key: key("small"), limit: 2, onSuccess: "keep" as const }];
    expect((await admit(small)).ok).toBe(true);
    expect((await admit(small)).ok).toBe(true);
    expect((await admit(small)).ok).toBe(false);
  });
});
