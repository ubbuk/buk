import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// PostgreSQL-backed rate limiting for credential checks (login, current-password verification).
// Every app instance shares the same counters; each counter change is ONE atomic statement, so the
// limits hold however many requests arrive at once and from however many instances.
//
// What is counted, and why it is shaped like this:
//   ip      attempts from one address (IPv6: one /64). Stops password spraying across many accounts and
//           bounds the bcrypt work an anonymous client can cause. The limit is generous because a whole
//           company can sit behind one NAT address; a successful login gives its unit back, so only
//           net failures (and attempts still in flight) accumulate.
//   pair    attempts on one account FROM one address. A stranger exhausts only their own pair bucket.
//   account attempts on one account from anywhere. Stops distributed guessing. Its limit is much higher
//           than the pair limit on purpose, so one attacker cannot lock the real user out: it takes
//           accountLimit / pairLimit distinct addresses to do that.
// A blocked attempt is refused BEFORE any bcrypt work, and refused attempts never touch the buckets that
// are checked after the one that refused them (buckets are consumed ip -> pair -> account). A success
// resets pair and account and refunds the ip unit. Windows are fixed (WINDOW_MS from the first attempt in
// the bucket); an expired bucket counts as empty, so lock-outs end by themselves with no cleanup job.
//
// Keys never contain an e-mail or an IP in clear: they are hashed, and an e-mail that belongs to nobody
// gets exactly the same treatment as a real one (so throttling reveals nothing about who exists).

export const WINDOW_MS = 15 * 60 * 1000;

export const LIMITS = {
  loginIp: 200,
  loginPair: 5,
  loginAccount: 20,
  passwordUser: 5,
  passwordIp: 60,
  // PIN reset by an ADMIN: how many one administrator may do, and how often one person's PIN may be reset.
  pinResetAdmin: 20,
  pinResetTarget: 3,
  // Password reset by an ADMIN (hands the admin a temporary password): every attempt counts, failed or not.
  credentialResetAdmin: 5,
  credentialResetTarget: 3,
  // Creating a user (also hands the admin a temporary password); higher because onboarding comes in batches.
  userCreateAdmin: 20,
  // Granting authority (role elevation, positions, department head, procurement positions): per administrator.
  authorityGrantAdmin: 20,
} as const;

const WINDOW_SECONDS = WINDOW_MS / 1000;
// `windowStart` / `updatedAt` are TIMESTAMP(3) WITHOUT time zone that Prisma writes in UTC: read the
// database clock as UTC (it is also the one clock every instance agrees on).
const DB_NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

export class ThrottleUnavailableError extends Error {
  constructor() {
    super("THROTTLE_UNAVAILABLE");
    this.name = "ThrottleUnavailableError";
  }
}

export interface Bucket {
  key: string;
  limit: number;
  /** What a successful check does to this bucket: clear it, give its unit back, or leave it counted ("keep": a plain rate limit on completed operations). */
  onSuccess: "reset" | "refund" | "keep";
}

export type Admission = { ok: true; settle: () => Promise<void> } | { ok: false; retryAfterSeconds: number; blockedBy: string };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Same normalisation the login uses to find the account: case, spaces and Unicode compatibility forms collapse. */
export function normalizeEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

export function loginBuckets(email: string, ip: string | null): Bucket[] {
  const account = sha(normalizeEmail(email));
  const buckets: Bucket[] = [];
  if (ip) {
    buckets.push({ key: `login:ip:${sha(ip)}`, limit: LIMITS.loginIp, onSuccess: "refund" });
    buckets.push({ key: `login:pair:${sha(`${account}|${ip}`)}`, limit: LIMITS.loginPair, onSuccess: "reset" });
  }
  buckets.push({ key: `login:acct:${account}`, limit: LIMITS.loginAccount, onSuccess: "reset" });
  return buckets;
}

export function passwordChangeBuckets(userId: string, ip: string | null): Bucket[] {
  const buckets: Bucket[] = [];
  if (ip) buckets.push({ key: `pwd:ip:${sha(ip)}`, limit: LIMITS.passwordIp, onSuccess: "refund" });
  buckets.push({ key: `pwd:user:${sha(userId)}`, limit: LIMITS.passwordUser, onSuccess: "reset" });
  return buckets;
}

/** Rate limit on completed PIN resets: per administrator, and per person whose PIN is reset. Never cleared by success. */
export function pinResetBuckets(adminId: string, targetUserId: string): Bucket[] {
  return [
    { key: `pinreset:admin:${sha(adminId)}`, limit: LIMITS.pinResetAdmin, onSuccess: "keep" },
    { key: `pinreset:target:${sha(targetUserId)}`, limit: LIMITS.pinResetTarget, onSuccess: "keep" },
  ];
}

/** Admin password reset: per administrator and per employee. Every attempt that gets this far is counted, whatever its outcome. */
export function credentialResetBuckets(adminId: string, targetUserId: string): Bucket[] {
  return [
    { key: `credreset:admin:${sha(adminId)}`, limit: LIMITS.credentialResetAdmin, onSuccess: "keep" },
    { key: `credreset:target:${sha(targetUserId)}`, limit: LIMITS.credentialResetTarget, onSuccess: "keep" },
  ];
}

/** Authority grants made by one administrator. Every attempt that gets this far counts. */
export function authorityGrantBuckets(adminId: string): Bucket[] {
  return [{ key: `authgrant:admin:${sha(adminId)}`, limit: LIMITS.authorityGrantAdmin, onSuccess: "keep" }];
}

/** Admin user creation: per administrator. */
export function userCreateBuckets(adminId: string): Bucket[] {
  return [{ key: `usercreate:admin:${sha(adminId)}`, limit: LIMITS.userCreateAdmin, onSuccess: "keep" }];
}

/**
 * Takes one unit from a bucket if there is room. A single INSERT ... ON CONFLICT DO UPDATE ... WHERE: the row
 * lock serialises concurrent callers, the WHERE makes the decision on the freshly locked row, and an
 * expired window restarts at 1. No row back = full, so the attempt is refused.
 */
async function take(bucket: Bucket): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "LoginThrottle" ("key", "count", "windowStart", "updatedAt")
    VALUES (${bucket.key}, 1, ${DB_NOW_UTC}, ${DB_NOW_UTC})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "LoginThrottle"."windowStart" <= ${DB_NOW_UTC} - (${WINDOW_SECONDS} * interval '1 second') THEN 1 ELSE "LoginThrottle"."count" + 1 END,
      "windowStart" = CASE WHEN "LoginThrottle"."windowStart" <= ${DB_NOW_UTC} - (${WINDOW_SECONDS} * interval '1 second') THEN ${DB_NOW_UTC} ELSE "LoginThrottle"."windowStart" END,
      "updatedAt" = ${DB_NOW_UTC}
    WHERE "LoginThrottle"."windowStart" <= ${DB_NOW_UTC} - (${WINDOW_SECONDS} * interval '1 second')
       OR "LoginThrottle"."count" < ${bucket.limit}
    RETURNING "count"`;
  return rows.length > 0;
}

async function secondsUntilReset(key: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ seconds: number }[]>`
    SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("windowStart" + (${WINDOW_SECONDS} * interval '1 second') - ${DB_NOW_UTC}))))::int AS seconds
    FROM "LoginThrottle" WHERE "key" = ${key}`;
  return rows[0]?.seconds ?? WINDOW_SECONDS;
}

/**
 * Asks to make one credential check. `buckets` are consumed in the order given (put the broadest first).
 * Any database failure throws ThrottleUnavailableError: the check is refused rather than let through
 * unmetered (the error carries no detail; the cause is logged by name only).
 */
export async function admit(buckets: Bucket[]): Promise<Admission> {
  try {
    for (const bucket of buckets) {
      if (!(await take(bucket))) {
        return { ok: false, retryAfterSeconds: await secondsUntilReset(bucket.key), blockedBy: bucket.key.split(":").slice(0, 2).join(":") };
      }
    }
  } catch (err) {
    console.error("[auth] rate limiter unavailable:", err instanceof Error ? err.name : "unknown");
    throw new ThrottleUnavailableError();
  }
  void maybePurge();
  return { ok: true, settle: () => settleSuccess(buckets) };
}

/** After a successful check: clear the per-account buckets and give back the shared-IP unit. Never throws. */
async function settleSuccess(buckets: Bucket[]): Promise<void> {
  const reset = buckets.filter((b) => b.onSuccess === "reset").map((b) => b.key);
  // "keep" buckets are not touched at all
  const all = buckets.filter((b) => b.onSuccess !== "keep").map((b) => b.key);
  if (all.length === 0) return;
  try {
    await prisma.$executeRaw`
      UPDATE "LoginThrottle"
      SET "count" = CASE WHEN "key" = ANY(${reset}::text[]) THEN 0 ELSE GREATEST("count" - 1, 0) END, "updatedAt" = ${DB_NOW_UTC}
      WHERE "key" = ANY(${all}::text[])`;
  } catch (err) {
    // the credentials were right; leaving the counters as they are only errs on the strict side
    console.error("[auth] rate limiter settle failed:", err instanceof Error ? err.name : "unknown");
  }
}

// --- clean-up ---------------------------------------------------------------------------------------------
// A bucket is dead once its window has passed (it reads as empty), so rows are kept an hour past that for
// inspection and then deleted. No scheduler is needed: about one admitted attempt in PURGE_ONE_IN deletes
// a bounded batch in the background, and purgeStaleThrottles() can also be run by hand or from any cron.
const PURGE_ONE_IN = 50;
const PURGE_BATCH = 1000;
const KEEP_AFTER_EXPIRY_SECONDS = 60 * 60;

export async function purgeStaleThrottles(batch = PURGE_BATCH): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "LoginThrottle" WHERE "key" IN (
      SELECT "key" FROM "LoginThrottle"
      WHERE "windowStart" < ${DB_NOW_UTC} - (${WINDOW_SECONDS + KEEP_AFTER_EXPIRY_SECONDS} * interval '1 second')
      LIMIT ${batch})`;
}

async function maybePurge(): Promise<void> {
  if (Math.random() * PURGE_ONE_IN >= 1) return;
  try {
    await purgeStaleThrottles();
  } catch {
    // best effort: stale rows are harmless
  }
}
