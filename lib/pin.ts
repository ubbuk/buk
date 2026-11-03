import bcrypt from "bcrypt";
import { prisma } from "./prisma";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export type PinResult = { ok: true } | { ok: false; status: number; error: string };

const GENERIC_WRONG_PIN = "PIN буруу байна";
const NO_PIN_SET = "Та эхлээд баталгаажуулах дөрвөн оронтой PIN тохируулна уу";

function minutesRemaining(lockedUntil: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
}

/**
 * Verifies an approver's four-digit PIN before a decision is recorded.
 * Called after the caller has already confirmed the actor is the real
 * assignee of the step being decided — a wrong user never reaches here,
 * so a wrong PIN or a lockout only ever affects the real approver's own
 * account. Never logs or returns the PIN value itself; failures are
 * recorded to AuditLog with no body (see callers in lib/workflow.ts).
 */
export async function verifyPin(actorId: string, pin: string): Promise<PinResult> {
  const credential = await prisma.approvalPinCredential.findUnique({ where: { userId: actorId } });
  if (!credential) return { ok: false, status: 400, error: NO_PIN_SET };

  if (credential.lockedUntil && credential.lockedUntil > new Date()) {
    return {
      ok: false,
      status: 423,
      error: `Та түр хугацаагаар түгжигдсэн байна. ${minutesRemaining(credential.lockedUntil)} минутын дараа дахин оролдоно уу`,
    };
  }

  const valid = await bcrypt.compare(pin, credential.pinHash);
  if (!valid) {
    const failedAttempts = credential.failedAttempts + 1;
    const lockedOut = failedAttempts >= MAX_ATTEMPTS;

    await prisma.approvalPinCredential.update({
      where: { userId: actorId },
      data: {
        failedAttempts: lockedOut ? 0 : failedAttempts,
        lockedUntil: lockedOut ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null,
      },
    });
    await prisma.auditLog.create({
      data: { entityType: "User", entityId: actorId, action: lockedOut ? "PIN_LOCKOUT" : "PIN_FAILURE", actorId },
    });

    return {
      ok: false,
      status: lockedOut ? 423 : 401,
      error: lockedOut ? `Хэт олон удаа буруу оруулсан тул ${LOCKOUT_MINUTES} минутын турш түгжигдлээ` : GENERIC_WRONG_PIN,
    };
  }

  await prisma.approvalPinCredential.update({
    where: { userId: actorId },
    data: { failedAttempts: 0, lockedUntil: null },
  });

  return { ok: true };
}

export async function hasPinSet(userId: string): Promise<boolean> {
  const credential = await prisma.approvalPinCredential.findUnique({ where: { userId } });
  return !!credential;
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
