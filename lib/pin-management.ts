import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { emitUserEvent } from "./events";
import { isValidPinFormat } from "./pin";
import { admit, passwordChangeBuckets, pinResetBuckets } from "./login-throttle";

// Creating, changing and resetting the 4-digit approval PIN.
//
// Rules (verification itself, the atomic attempt counter and the 15-minute lockout live in lib/pin.ts and are
// not touched here):
//  - Setting or changing a PIN needs the account's CURRENT PASSWORD. A session alone (a stolen cookie, an
//    unattended browser) can no longer swap the PIN. The password check shares the budget of the other
//    current-password checks (lib/login-throttle.ts, passwordChangeBuckets), so the two endpoints cannot be
//    alternated to double the guesses.
//  - A PIN cannot be created or changed while the account is LOCKED, and doing so never clears the lock or the
//    attempt counter. The check and the write are ONE conditional statement, so a lockout that lands between them
//    cannot be bypassed.
//  - Only an ADMIN can reset somebody else's PIN, and a reset only DELETES the credential: nobody -- the ADMIN
//    included -- ever sees, chooses or receives a PIN. The employee then proves who they are with their own
//    password and creates a new one. A reset needs a reason, the ADMIN's attestation that the employee's identity
//    was verified, and the ADMIN's own password; it is rate limited per administrator and per employee and is
//    recorded in the audit log. It grants no approval authority: approvals still belong to whoever the workflow
//    assigns them to.

export type PinFailure = { ok: false; status: number; error: string; retryAfterSeconds?: number };
const fail = (status: number, error: string, retryAfterSeconds?: number): PinFailure => ({ ok: false, status, error, retryAfterSeconds });

const DB_NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

const WRONG_PASSWORD = "Нууц үг буруу байна";
const TOO_MANY = "Хэт олон удаа буруу оролдлоо. Хэсэг хүлээгээд дахин оролдоно уу";
const UNAVAILABLE = "Түр хугацаанд боломжгүй байна. Дахин оролдоно уу";

/**
 * Checks `userId`'s current password: throttled before any bcrypt work, and a success clears the account's
 * password-attempt bucket. Used both for the employee's own PIN setup and for an ADMIN's re-authentication.
 */
async function verifyAccountPassword(userId: string, password: string, ip: string | null): Promise<PinFailure | null> {
  let admission;
  try {
    admission = await admit(passwordChangeBuckets(userId, ip));
  } catch {
    return fail(503, UNAVAILABLE);
  }
  if (!admission.ok) return fail(429, TOO_MANY, admission.retryAfterSeconds);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, isActive: true } });
  if (!user || !user.isActive) return fail(403, "Эрхгүй үйлдэл");
  if (!(await bcrypt.compare(password, user.passwordHash))) return fail(401, WRONG_PASSWORD);
  await admission.settle();
  return null;
}

export interface SetPinInput {
  /** From the authenticated session, never from the request body. */
  userId: string;
  currentPassword: string;
  pin: string;
  ip: string | null;
}

export async function setOwnPin(input: SetPinInput): Promise<{ ok: true; created: boolean } | PinFailure> {
  // the cheap checks first: a malformed PIN costs neither a password attempt nor any bcrypt work
  if (!isValidPinFormat(input.pin)) return fail(400, "PIN яг дөрөв оронтой тоо байх ёстой");

  const denied = await verifyAccountPassword(input.userId, input.currentPassword, input.ip);
  if (denied) return denied;

  const pinHash = await bcrypt.hash(input.pin, 10);
  // One statement: create the credential or replace its hash, but only when the account is not locked. The
  // attempt counter and lock are deliberately not part of the SET list, so this can never clear them.
  const rows = await prisma.$queryRaw<{ inserted: boolean }[]>`
    INSERT INTO "ApprovalPinCredential" ("id", "userId", "pinHash", "failedAttempts", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${input.userId}, ${pinHash}, 0, ${DB_NOW_UTC}, ${DB_NOW_UTC})
    ON CONFLICT ("userId") DO UPDATE SET "pinHash" = EXCLUDED."pinHash", "updatedAt" = ${DB_NOW_UTC}
    WHERE "ApprovalPinCredential"."lockedUntil" IS NULL OR "ApprovalPinCredential"."lockedUntil" <= ${DB_NOW_UTC}
    RETURNING (xmax = 0) AS inserted`;
  if (rows.length === 0) {
    const credential = await prisma.approvalPinCredential.findUnique({ where: { userId: input.userId }, select: { lockedUntil: true } });
    const minutes = credential?.lockedUntil ? Math.max(1, Math.ceil((credential.lockedUntil.getTime() - Date.now()) / 60000)) : 15;
    return fail(423, `Таны PIN түр хугацаагаар түгжигдсэн байна. ${minutes} минутын дараа эсвэл админаар цуцлуулж дахин оролдоно уу`, minutes * 60);
  }

  const created = rows[0].inserted;
  // No PIN value or hash in the log: only the fact that it was created or changed.
  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: input.userId,
      action: "PIN_SETUP",
      actorId: input.userId,
      afterJson: JSON.stringify({ event: created ? "PIN_CREATED" : "PIN_CHANGED" }),
    },
  });
  return { ok: true, created };
}

export interface AdminResetInput {
  /** From the authenticated session. */
  adminId: string;
  adminPassword: string;
  targetUserId: string;
  reason: string;
  /** The ADMIN's attestation that the employee's identity was verified (in person, by phone with call-back, ...). */
  identityVerified: boolean;
  ip: string | null;
}

export async function resetPinAsAdmin(input: AdminResetInput): Promise<{ ok: true; hadPin: boolean } | PinFailure> {
  const reason = input.reason.trim();
  if (reason.length < 3) return fail(400, "Цуцлах шалтгаанаа бичнэ үү");
  if (reason.length > 500) return fail(400, "Шалтгаан хэт урт байна");
  if (input.identityVerified !== true) return fail(400, "Ажилтны хувийн байдлыг баталгаажуулсан гэдгээ тэмдэглэнэ үү");

  // authorised for real, not just "the session says ADMIN"
  const admin = await prisma.user.findUnique({ where: { id: input.adminId }, select: { role: true, isActive: true } });
  if (!admin || !admin.isActive || admin.role !== "ADMIN") return fail(403, "Эрхгүй үйлдэл");
  // resetting your own PIN would be a way around the lockout with nothing but a password; another ADMIN does that
  if (input.targetUserId === input.adminId) return fail(400, "Өөрийн PIN-ийг энд цуцлах боломжгүй. Өөр админд хандана уу");
  const target = await prisma.user.findUnique({ where: { id: input.targetUserId }, select: { id: true, name: true } });
  if (!target) return fail(404, "Хэрэглэгч олдсонгүй");

  const denied = await verifyAccountPassword(input.adminId, input.adminPassword, input.ip);
  if (denied) return denied;

  let limited;
  try {
    limited = await admit(pinResetBuckets(input.adminId, input.targetUserId));
  } catch {
    return fail(503, UNAVAILABLE);
  }
  if (!limited.ok) return fail(429, "PIN цуцлах оролдлого хэт олон байна. Хэсэг хүлээгээд дахин оролдоно уу", limited.retryAfterSeconds);

  // Deleting the credential is the whole reset: the lock and counter go with it, and the employee must create a new PIN
  // with their own password. The record and the employee's notice are written in the same transaction.
  const hadPin = await prisma.$transaction(async (tx) => {
    const removed = await tx.approvalPinCredential.deleteMany({ where: { userId: target.id } });
    await tx.auditLog.create({
      data: {
        entityType: "User",
        entityId: target.id,
        action: "RESET_CREDENTIALS",
        actorId: input.adminId,
        afterJson: JSON.stringify({ kind: "PIN_RESET", reason, identityVerified: true, hadPin: removed.count > 0, targetUserId: target.id }),
      },
    });
    await tx.notification.create({
      data: {
        userId: target.id,
        type: "GENERIC",
        title: "Таны PIN цуцлагдлаа",
        body: "Админ таны баталгаажуулах PIN-ийг цуцаллаа. Тохиргоо хэсэгт өөрийн нууц үгээрээ шинэ PIN тохируулна уу. Хэрэв та үүнийг хүсээгүй бол админд мэдэгдээрэй.",
      },
    });
    return removed.count > 0;
  });
  emitUserEvent(target.id, { type: "notification" });
  return { ok: true, hadPin };
}
