import bcrypt from "bcrypt";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "./prisma";
import { emitBroadcast, emitUserEvent } from "./events";
import { generateTempPassword } from "./credentials";
import { approvalCapabilityOrUnknown, type CapabilityReason } from "./credential-guard";
import { isPrivilegedRole } from "./authority-roles";
import { recordGrant, STEP_UP_REQUIRED, type GrantContext } from "./authority-grant";
import { admit, credentialResetBuckets, userCreateBuckets } from "./login-throttle";
import { verifyAccountPassword } from "./pin-management";

// ADMIN credential operations that hand the administrator a temporary password: resetting an employee's
// password and creating a user. Stage 1 mitigation, NOT a complete fix: the administrator still learns the
// temporary password of the accounts these two operations touch, so what changes is who can be targeted, how
// often, with what proof, and what trace is left.
//
// Both operations require the administrator to be an active ADMIN in the database right now, to re-enter their
// OWN password (never an employee's), and are rate limited per administrator through the shared PostgreSQL
// throttle (lib/login-throttle.ts) before any bcrypt work: every attempt that gets that far is counted, failed
// or not, and an unavailable limiter refuses the operation. A password reset additionally needs a reason and the
// administrator's attestation that the employee's identity was verified, cannot target the administrator's own
// account, and is refused for any approval-capable account (lib/credential-guard.ts).
//
// Successful operations write an audit entry and, for a reset, a notification to the employee IN THE SAME
// TRANSACTION as the change: if either cannot be written, nothing changes at all, so a credential change is never
// left untraced. Refusals that got past the rate limiter leave a bounded audit entry (at most the limiter's few
// attempts per administrator and window); earlier refusals (malformed request, not an administrator) only reach
// the application log, which keeps the audit table from becoming a flood target.

export type CredentialFailure = { ok: false; status: number; error: string; retryAfterSeconds?: number; code?: string };
const fail = (status: number, error: string, retryAfterSeconds?: number, code?: string): CredentialFailure => ({ ok: false, status, error, retryAfterSeconds, code });

const FORBIDDEN = "Эрхгүй үйлдэл";
const UNAVAILABLE = "Түр хугацаанд боломжгүй байна. Дахин оролдоно уу";
const TOO_MANY = "Хэт олон оролдлого хийсэн байна. Хэсэг хүлээгээд дахин оролдоно уу";
const APPROVER_REFUSED =
  "Батлах эрхтэй (эсвэл батлах үүрэг хүлээсэн) хэрэглэгчийн нууц үгийг энэ аргаар сэргээх боломжгүй. Хэрэглэгч нэвтэрч чаддаг бол Тохиргоо хэсгээс өөрөө солино. Бүрэн түгжигдсэн бол албан ёсны хамгаалагдсан сэргээх журам хэрэгтэй (docs/admin-credential-security.md).";
const SELF_REFUSED = "Өөрийн нууц үгийг энд сэргээх боломжгүй. Тохиргоо хэсгээс нууц үгээ солино уу, эсвэл өөр админд хандана уу";

type RefusalCode = "APPROVAL_CAPABLE_TARGET" | "BAD_ADMIN_PASSWORD" | "NO_SUCH_USER";

/**
 * Bounded record of a refused reset. Only called for attempts that already passed the rate limiter, so at most
 * the limiter's budget of rows per administrator and window can ever be written. Never throws.
 */
async function auditRefusal(adminId: string, targetUserId: string, code: RefusalCode, reasons: CapabilityReason[] = []) {
  console.warn(`[admin] credential reset refused code=${code}`);
  try {
    await prisma.auditLog.create({
      data: {
        entityType: "UserCredentialReset",
        entityId: targetUserId,
        action: "REJECT",
        actorId: adminId,
        afterJson: JSON.stringify({ kind: "PASSWORD_RESET_REFUSED", code, ...(reasons.length ? { reasons } : {}) }),
      },
    });
  } catch {
    // monitoring must never turn a refusal into an error
  }
}

class Refusal extends Error {
  constructor(readonly failure: CredentialFailure, readonly code: RefusalCode, readonly reasons: CapabilityReason[] = []) {
    super(failure.error);
  }
}

async function activeAdmin(adminId: string): Promise<boolean> {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true, isActive: true } });
  return !!admin && admin.isActive && admin.role === "ADMIN";
}

export interface PasswordResetInput {
  /** From the authenticated session. */
  adminId: string;
  adminPassword: string;
  targetUserId: string;
  reason: string;
  /** The administrator's attestation that the employee's identity was verified. */
  identityVerified: boolean;
  ip: string | null;
}

export async function resetPasswordAsAdmin(input: PasswordResetInput): Promise<{ ok: true; tempPassword: string } | CredentialFailure> {
  const reason = input.reason.trim();
  if (reason.length < 3) return fail(400, "Сэргээх шалтгаанаа бичнэ үү");
  if (reason.length > 500) return fail(400, "Шалтгаан хэт урт байна");
  if (input.identityVerified !== true) return fail(400, "Ажилтны хувийн байдлыг баталгаажуулсан гэдгээ тэмдэглэнэ үү");
  if (!input.adminPassword) return fail(400, "Өөрийн нууц үгээ оруулна уу");

  // authorised for real, from the database, not from a session claim
  if (!(await activeAdmin(input.adminId))) return fail(403, FORBIDDEN);
  if (input.targetUserId === input.adminId) return fail(403, SELF_REFUSED);

  // counted before any bcrypt work, whatever happens next; unavailable limiter = refused
  let admission;
  try {
    admission = await admit(credentialResetBuckets(input.adminId, input.targetUserId));
  } catch {
    return fail(503, UNAVAILABLE);
  }
  if (!admission.ok) return fail(429, TOO_MANY, admission.retryAfterSeconds);

  // the administrator proves who they are with their OWN password (shares the budget of the other password checks)
  const denied = await verifyAccountPassword(input.adminId, input.adminPassword, input.ip);
  if (denied) {
    if (denied.status === 401) await auditRefusal(input.adminId, input.targetUserId, "BAD_ADMIN_PASSWORD");
    return fail(denied.status, denied.error, denied.retryAfterSeconds);
  }

  const target = await prisma.user.findUnique({ where: { id: input.targetUserId }, select: { id: true } });
  if (!target) {
    await auditRefusal(input.adminId, input.targetUserId, "NO_SUCH_USER");
    return fail(404, "Хэрэглэгч олдсонгүй");
  }
  const capability = await approvalCapabilityOrUnknown(prisma, target.id);
  if (capability.capable) {
    await auditRefusal(input.adminId, target.id, "APPROVAL_CAPABLE_TARGET", capability.reasons);
    return fail(403, APPROVER_REFUSED);
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const when = new Intl.DateTimeFormat("mn-MN", { timeZone: "Asia/Ulaanbaatar", dateStyle: "medium", timeStyle: "short" }).format(new Date());

  try {
    await prisma.$transaction(async (tx) => {
      // checked again inside the transaction: authority granted since the first look still blocks the reset
      const again = await approvalCapabilityOrUnknown(tx, target.id);
      if (again.capable) throw new Refusal(fail(403, APPROVER_REFUSED), "APPROVAL_CAPABLE_TARGET", again.reasons);

      await tx.user.update({ where: { id: target.id }, data: { passwordHash } });
      await tx.auditLog.create({
        data: {
          entityType: "User",
          entityId: target.id,
          action: "RESET_CREDENTIALS",
          actorId: input.adminId,
          ipAddress: input.ip,
          // no password, no hash: who, whom, why and the identity attestation
          afterJson: JSON.stringify({ kind: "PASSWORD_RESET", reason, identityVerified: true, targetUserId: target.id }),
        },
      });
      // The employee is told in the same transaction: if this cannot be written the whole reset is rolled back.
      await tx.notification.create({
        data: {
          userId: target.id,
          type: "GENERIC",
          title: "Таны нууц үг сэргээгдлээ",
          body: `Админ таны нэвтрэх нууц үгийг ${when}-д сэргээлээ. Хэрэв та үүнийг хүсээгүй бол даруй системийн удирдлагад мэдэгдэж, нууц үгээ Тохиргоо хэсэгт солино уу.`,
        },
      });
    });
  } catch (err) {
    if (err instanceof Refusal) {
      await auditRefusal(input.adminId, target.id, err.code, err.reasons);
      return err.failure;
    }
    console.error("[admin] credential reset failed:", err instanceof Error ? err.name : "unknown");
    return fail(500, "Нууц үг сэргээх үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй, дахин оролдоно уу");
  }
  emitUserEvent(target.id, { type: "notification" });
  return { ok: true, tempPassword };
}

export interface UserCreateInput {
  adminId: string;
  adminPassword: string;
  ip: string | null;
  data: { email: string; name: string; title?: string | null; role: UserRole; departmentId?: string | null };
  /** Required when the new account carries a privileged role (any role but EMPLOYEE): it is a grant of authority. */
  grant?: { reason?: string | null; confirmed?: boolean | null };
}

export async function createUserAsAdmin(input: UserCreateInput): Promise<{ ok: true; id: string; email: string; tempPassword: string } | CredentialFailure> {
  if (!input.adminPassword) return fail(400, "Өөрийн нууц үгээ оруулна уу");
  // Creating an account that already carries authority is a grant: reason and confirmation are mandatory.
  const privileged = isPrivilegedRole(input.data.role);
  const grantReason = (input.grant?.reason ?? "").trim();
  if (privileged && (grantReason.length < 3 || grantReason.length > 500 || input.grant?.confirmed !== true)) {
    return fail(400, "Эрхтэй хэрэглэгч үүсгэхийн тулд шалтгаан болон баталгаажуулалтыг оруулна уу", undefined, STEP_UP_REQUIRED);
  }
  if (!(await activeAdmin(input.adminId))) return fail(403, FORBIDDEN);

  let admission;
  try {
    admission = await admit(userCreateBuckets(input.adminId));
  } catch {
    return fail(503, UNAVAILABLE);
  }
  if (!admission.ok) return fail(429, TOO_MANY, admission.retryAfterSeconds);

  const denied = await verifyAccountPassword(input.adminId, input.adminPassword, input.ip);
  if (denied) return fail(denied.status, denied.error, denied.retryAfterSeconds);

  const existing = await prisma.user.findUnique({ where: { email: input.data.email }, select: { id: true } });
  if (existing) return fail(409, "Энэ и-мэйл хаягтай хэрэглэгч бүртгэлтэй байна");

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  try {
    let notified: string[] = [];
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.data.email,
          name: input.data.name,
          title: input.data.title ?? null,
          role: input.data.role,
          departmentId: input.data.departmentId ?? null,
          passwordHash,
        },
      });
      await tx.auditLog.create({
        data: {
          entityType: "User",
          entityId: created.id,
          action: "CREATE_USER",
          actorId: input.adminId,
          ipAddress: input.ip,
          // role and department only: never the temporary password or its hash
          afterJson: JSON.stringify({
            kind: "USER_CREATE",
            role: created.role,
            departmentId: created.departmentId,
            roleCarriesAuthority: created.role !== "EMPLOYEE" && created.role !== "ADMIN",
          }),
        },
      });
      if (privileged) {
        // the credential is admin-issued by definition; evidence for the record, no custody check on a new account
        const grant: GrantContext = {
          adminId: input.adminId,
          kind: "USER_CREATE_PRIVILEGED",
          reason: grantReason,
          targetUserId: created.id,
          ip: input.ip,
          custody: { state: "ADMIN_ISSUED_UNCHANGED", issuedAt: new Date().toISOString() },
        };
        notified = await recordGrant(tx, grant, {
          subjectType: "User",
          subjectId: created.id,
          summary: `${created.name} «${created.role}» эрхтэй шинэ хэрэглэгчээр бүртгэгдлээ`,
          before: null,
          after: { role: created.role, departmentId: created.departmentId },
        });
      }
      return created;
    });
    for (const id of notified) emitUserEvent(id, { type: "notification" });
    emitBroadcast({ type: "data-changed" });
    return { ok: true, id: user.id, email: user.email, tempPassword };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return fail(409, "Энэ и-мэйл хаягтай хэрэглэгч бүртгэлтэй байна");
    throw err;
  }
}
