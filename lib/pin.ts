import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export type PinResult = { ok: true } | { ok: false; status: number; error: string };

const GENERIC_WRONG_PIN = "PIN буруу байна";
const NO_PIN_SET = "Та эхлээд баталгаажуулах дөрвөн оронтой PIN тохируулна уу";
const TOO_MANY_ATTEMPTS = "Хэт олон оролдлого хийсэн байна. Хэсэг хүлээгээд дахин оролдоно уу";

function minutesRemaining(lockedUntil: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
}

// `lockedUntil` is a TIMESTAMP(3) WITHOUT time zone that Prisma writes in UTC. Comparing it to a bare
// now() would shift by the database session's time zone, so the database clock is read as UTC here.
// (The database clock, not the app's, also keeps several app instances consistent with each other.)
const DB_NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/**
 * Takes one attempt from the account's budget, atomically, BEFORE the PIN is compared.
 *
 * One conditional UPDATE both checks "not locked and budget left" and counts the attempt, so
 * concurrent requests (any number of app instances) are serialised by PostgreSQL's row lock: at most
 * MAX_ATTEMPTS of them ever reach the comparison, however many are fired at once. The previous
 * read -> compare -> write sequence let every parallel guess read the same counter, so a burst of
 * guesses was all compared and none of them locked the account. An expired lock restarts the budget
 * (this attempt becomes attempt 1). Returns null when the account is locked, the budget is used up, or
 * there is no PIN.
 */
async function takeAttempt(userId: string): Promise<{ pinHash: string; attempt: number } | null> {
  const rows = await prisma.$queryRaw<{ pinHash: string; failedAttempts: number }[]>`
    UPDATE "ApprovalPinCredential"
    SET "failedAttempts" = CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedAttempts" + 1 END,
        "lockedUntil" = NULL
    WHERE "userId" = ${userId}
      AND (("lockedUntil" IS NOT NULL AND "lockedUntil" <= ${DB_NOW_UTC})
        OR ("lockedUntil" IS NULL AND "failedAttempts" < ${MAX_ATTEMPTS}))
    RETURNING "pinHash", "failedAttempts"`;
  return rows[0] ? { pinHash: rows[0].pinHash, attempt: rows[0].failedAttempts } : null;
}

/**
 * Verifies an approver's four-digit PIN before a decision is recorded.
 * Called after the caller has already confirmed the actor is the real
 * assignee of the step being decided — a wrong user never reaches here,
 * so a wrong PIN or a lockout only ever affects the real approver's own
 * account. Never logs or returns the PIN value itself; failures are
 * recorded to AuditLog with no body (see callers in lib/workflow.ts).
 *
 * MAX_ATTEMPTS wrong PINs lock the account for LOCKOUT_MINUTES. The counter is kept in PostgreSQL and
 * every change is one atomic statement (see takeAttempt), so the limit holds under parallel requests.
 */
export async function verifyPin(actorId: string, pin: string): Promise<PinResult> {
  const taken = await takeAttempt(actorId);
  if (!taken) {
    const credential = await prisma.approvalPinCredential.findUnique({ where: { userId: actorId }, select: { lockedUntil: true } });
    if (!credential) return { ok: false, status: 400, error: NO_PIN_SET };
    if (credential.lockedUntil && credential.lockedUntil > new Date()) {
      return {
        ok: false,
        status: 423,
        error: `Та түр хугацаагаар түгжигдсэн байна. ${minutesRemaining(credential.lockedUntil)} минутын дараа дахин оролдоно уу`,
      };
    }
    // the budget is spent by attempts still being checked; the last one is about to lock (or clear) the account
    return { ok: false, status: 423, error: TOO_MANY_ATTEMPTS };
  }

  const valid = await bcrypt.compare(pin, taken.pinHash);
  if (valid) {
    // Skips the write when nothing needs clearing (the common case of a first-try success on a clean account).
    await prisma.$executeRaw`
      UPDATE "ApprovalPinCredential" SET "failedAttempts" = 0, "lockedUntil" = NULL
      WHERE "userId" = ${actorId} AND ("failedAttempts" <> 0 OR "lockedUntil" IS NOT NULL)`;
    return { ok: true };
  }

  // Only the attempt that used up the budget locks the account. The counter is cleared at the same moment
  // (as before), and the lock applies to every other attempt still in flight, which can no longer start.
  let lockedOut = false;
  if (taken.attempt >= MAX_ATTEMPTS) {
    const locked = await prisma.$executeRaw`
      UPDATE "ApprovalPinCredential"
      SET "lockedUntil" = ${DB_NOW_UTC} + (${LOCKOUT_MINUTES} * interval '1 minute'), "failedAttempts" = 0
      WHERE "userId" = ${actorId} AND "failedAttempts" >= ${MAX_ATTEMPTS} AND "lockedUntil" IS NULL`;
    lockedOut = locked > 0;
  }
  await prisma.auditLog.create({
    data: { entityType: "User", entityId: actorId, action: lockedOut ? "PIN_LOCKOUT" : "PIN_FAILURE", actorId },
  });

  return {
    ok: false,
    status: lockedOut ? 423 : 401,
    error: lockedOut ? `Хэт олон удаа буруу оруулсан тул ${LOCKOUT_MINUTES} минутын турш түгжигдлээ` : GENERIC_WRONG_PIN,
  };
}

export async function hasPinSet(userId: string): Promise<boolean> {
  const credential = await prisma.approvalPinCredential.findUnique({ where: { userId } });
  return !!credential;
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
