import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { emitUserEvent } from "./events";
import { approvalCapabilityOrUnknown } from "./credential-guard";
import { admit, normalizeEmail, recoveryConfirmBuckets, recoveryRequestBuckets } from "./login-throttle";
import { credentialChange, forgetSession } from "./session-revocation";

// SELF-SERVICE PASSWORD RECOVERY (Stage 4). The account owner proves they own the account by receiving a one-time token
// on a channel the administrator cannot read (e-mail), and sets their OWN new password with it. The administrator never
// sees a password or a token, so this removes the administrator's ability to learn a credential, which is the root of the
// impersonation risk that Stage 1 / 1.5 / 3 only make slower and more visible.
//
// STATUS: the architecture and the whole server side are here and tested, but the feature is OFF and INERT until BOTH
//   - SELF_SERVICE_RECOVERY=on, and
//   - a delivery channel is registered with setRecoveryDelivery() (an e-mail provider the organisation has approved).
// No provider is bundled and none is added here: sending mail is a new external service and needs your decision.
// Until then the Stage 1 administrator reset (temporary password) stays as it is; once the feature is ready that reset is
// refused (see resetPasswordAsAdmin) so there is exactly one way in and the administrator is not in it.
//
// Rules:
//   - A request never reveals whether the e-mail belongs to an account (same answer, same work, throttled on the hashed e-mail).
//   - Tokens are 256 random bits, stored only as a SHA-256 hash, valid 30 minutes, single use, and a new request voids
//     the older tokens. Confirming is throttled per address and per token.
//   - ADMIN and every account that carries authority are EXCLUDED: a mailbox alone must not be enough to take over such an
//     account, so they get no token. They recover through Settings (while signed in) or the break-glass procedure
//     (docs/single-admin-recovery.md).
//   - Completing a recovery revokes every session of the account (lib/session-revocation.ts), records an audit entry that
//     counts as the owner's own password change (custody evidence for lib/authority-grant.ts), and notifies the owner.

export const TOKEN_TTL_MS = 30 * 60 * 1000;

export interface RecoveryDelivery {
  /** Sends the clear token to the account owner. The token must never be logged. */
  send(input: { to: string; name: string; token: string; expiresAt: Date }): Promise<void>;
}

let delivery: RecoveryDelivery | null = null;
/** Registers the approved channel (and, in tests, a fake one). `null` removes it. */
export function setRecoveryDelivery(d: RecoveryDelivery | null) {
  delivery = d;
}

export function recoveryEnabled(): boolean {
  return process.env.SELF_SERVICE_RECOVERY?.trim().toLowerCase() === "on";
}
/** Both the switch and a delivery channel: only then does recovery do anything. */
export function recoveryReady(): boolean {
  return recoveryEnabled() && delivery !== null;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const hashToken = (token: string) => sha(token);

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= bcrypt.hash(`recovery-dummy-${Math.random()}`, 10));

export type RecoveryRequestResult = { ok: true } | { ok: false; status: number; error: string; retryAfterSeconds?: number };

/** Always the same outcome for the caller, whether or not an account exists or a token was issued. */
export async function requestRecovery(input: { email: string; ip: string | null }): Promise<RecoveryRequestResult> {
  if (!recoveryReady()) return { ok: true };

  let admission;
  try {
    admission = await admit(recoveryRequestBuckets(input.email, input.ip));
  } catch {
    return { ok: false, status: 503, error: "Түр хугацаанд боломжгүй байна. Дахин оролдоно уу" };
  }
  if (!admission.ok) return { ok: false, status: 429, error: "Хэт олон оролдлого хийсэн байна. Хэсэг хүлээгээд дахин оролдоно уу", retryAfterSeconds: admission.retryAfterSeconds };

  const user = await prisma.user.findFirst({
    where: { email: { equals: normalizeEmail(input.email), mode: "insensitive" }, isActive: true },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) {
    await bcrypt.compare("x", await dummyHash()); // comparable work for an unknown address
    return { ok: true };
  }

  // an account that carries authority is not recoverable by e-mail alone: same answer, no token, no mail
  const privileged = user.role !== "EMPLOYEE" || (await approvalCapabilityOrUnknown(prisma, user.id)).capable;
  if (privileged) {
    console.warn("[recovery] request ignored: account carries authority");
    return { ok: true };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  try {
    await prisma.$transaction(async (tx) => {
      // a new request voids every older unused token
      await tx.passwordRecoveryToken.updateMany({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } });
      await tx.passwordRecoveryToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } });
      await tx.auditLog.create({
        data: { entityType: "User", entityId: user.id, action: "RESET_CREDENTIALS", actorId: user.id, ipAddress: input.ip, afterJson: JSON.stringify({ kind: "SELF_SERVICE_RECOVERY_REQUESTED" }) },
      });
    });
    await delivery!.send({ to: user.email, name: user.name, token, expiresAt });
  } catch (err) {
    console.error("[recovery] request failed:", err instanceof Error ? err.name : "unknown");
  }
  return { ok: true };
}

export type RecoveryConfirmResult = { ok: true } | { ok: false; status: number; error: string; retryAfterSeconds?: number };
const INVALID: RecoveryConfirmResult = { ok: false, status: 400, error: "Холбоос хүчингүй эсвэл хугацаа нь дууссан байна. Дахин хүсэлт гаргана уу" };

export async function confirmRecovery(input: { token: string; newPassword: string; ip: string | null }): Promise<RecoveryConfirmResult> {
  if (!recoveryReady()) return { ok: false, status: 404, error: "Боломжгүй" };
  if (input.newPassword.length < 8) return { ok: false, status: 400, error: "Шинэ нууц үг дор хаяж 8 тэмдэгт байх ёстой" };
  if (!input.token || input.token.length > 200) return INVALID;

  const tokenHash = hashToken(input.token);
  let admission;
  try {
    admission = await admit(recoveryConfirmBuckets(tokenHash, input.ip));
  } catch {
    return { ok: false, status: 503, error: "Түр хугацаанд боломжгүй байна. Дахин оролдоно уу" };
  }
  if (!admission.ok) return { ok: false, status: 429, error: "Хэт олон оролдлого хийсэн байна. Хэсэг хүлээгээд дахин оролдоно уу", retryAfterSeconds: admission.retryAfterSeconds };

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  let userId = "";
  try {
    await prisma.$transaction(async (tx) => {
      // single use, atomic: only one caller can move an unused, unexpired token
      const moved = await tx.passwordRecoveryToken.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (moved.count !== 1) throw new Error("INVALID_TOKEN");
      const row = await tx.passwordRecoveryToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true } });
      const user = await tx.user.findUnique({ where: { id: row.userId }, select: { id: true, isActive: true, role: true } });
      // an account that gained authority after the token was issued is not recoverable this way either
      if (!user || !user.isActive || user.role !== "EMPLOYEE" || (await approvalCapabilityOrUnknown(tx, user.id)).capable) throw new Error("INVALID_TOKEN");
      userId = user.id;
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, ...credentialChange() } });
      await tx.passwordRecoveryToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      // the owner has now set their own password: the same fact a Settings password change records (custody evidence)
      await tx.auditLog.createMany({
        data: [
          { entityType: "User", entityId: user.id, action: "RESET_CREDENTIALS", actorId: user.id, ipAddress: input.ip, afterJson: JSON.stringify({ kind: "SELF_SERVICE_RECOVERY_COMPLETED", sessionsRevoked: true }) },
          { entityType: "User", entityId: user.id, action: "CHANGE_PASSWORD", actorId: user.id, ipAddress: input.ip, afterJson: JSON.stringify({ via: "SELF_SERVICE_RECOVERY", sessionsRevoked: true }) },
        ],
      });
      await tx.notification.create({
        data: { userId: user.id, type: "GENERIC", title: "Таны нууц үг сэргээгдлээ", body: "Таны нууц үг сэргээх холбоосоор солигдож, бүх нэвтрэлт хаагдлаа. Хэрэв та хийгээгүй бол даруй системийн удирдлагад мэдэгдээрэй." },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_TOKEN") return INVALID;
    console.error("[recovery] confirm failed:", err instanceof Error ? err.name : "unknown");
    return { ok: false, status: 500, error: "Нууц үг сэргээх үед алдаа гарлаа. Дахин оролдоно уу" };
  }
  forgetSession(userId);
  emitUserEvent(userId, { type: "notification" });
  return { ok: true };
}
