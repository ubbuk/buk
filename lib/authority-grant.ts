import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { emitUserEvent } from "./events";
import { admit, authorityGrantBuckets } from "./login-throttle";
import { verifyAccountPassword } from "./pin-management";

// ONE place that decides whether an ADMIN may GRANT authority, used by every endpoint that can: changing a user's
// role into a privileged one, re-activating a privileged account, assigning an approval position, naming a
// department head, handing procurement positions to a manager, and creating a user with a privileged role.
//
// A grant needs (Stage 1.5):
//   - a reason (3-500 characters), an explicit confirmation, and the administrator's OWN password;
//   - an active ADMIN in the database right now (not a session claim);
//   - the shared PostgreSQL rate limit (every attempt counts; an unavailable limiter refuses the grant);
//   - for an existing account: evidence that the OWNER holds the credential (see custodyOf).
// and, when it is made, a before/after audit row, a notification to the person concerned, to the previous holder, to
// every other administrator and to the executive director, all written in the SAME transaction as the change: if
// the record or a notification cannot be written, the grant does not happen.
//
// The administrator grants directly: there is NO second approval step. Two Stage 3 rules remain: nobody may grant
// authority to themselves, and the ADMIN role can not be granted through the application at all (see isAdminRoleGrantLocked).
//
// IMPORTANT, what the custody check is and is not. It is a BARRIER and a DETECTOR, not a guarantee. It reads the
// audit log: an account whose password the administrator issued (user creation, password reset) and which the
// owner has not changed since is refused. But an administrator who knows the temporary password can sign in as the
// employee and change the password themselves, which leaves exactly the evidence the check looks for. Only
// out-of-band delivery (self-service recovery) closes that; this guard makes
// the takeover slower, visible and reportable. See docs/admin-credential-security.md.

type Db = Prisma.TransactionClient | typeof prisma;

export type GrantKind = "ROLE_ELEVATION" | "REACTIVATION" | "POSITION_ASSIGNMENT" | "DEPARTMENT_HEAD" | "PROCUREMENT_POSITION" | "USER_CREATE_PRIVILEGED";

export interface StepUp {
  adminPassword?: string | null;
  reason?: string | null;
  confirmed?: boolean | null;
}

export type CustodyState = "OWNER_HELD" | "ADMIN_ISSUED_UNCHANGED" | "UNKNOWN";
export interface Custody {
  state: CustodyState;
  issuedAt: string | null;
}

export interface GrantContext {
  adminId: string;
  kind: GrantKind;
  reason: string;
  targetUserId: string;
  ip: string | null;
  custody: Custody;
}

export type GrantFailure = { ok: false; status: number; error: string; code?: string; retryAfterSeconds?: number };
const fail = (status: number, error: string, code?: string, retryAfterSeconds?: number): GrantFailure => ({ ok: false, status, error, code, retryAfterSeconds });

/** The JSON answer for a refused grant, identical for every route (status, stable code, Retry-After). */
export function grantFailureResponse(f: GrantFailure): Response {
  return Response.json({ error: f.error, code: f.code }, { status: f.status, headers: f.retryAfterSeconds ? { "Retry-After": String(f.retryAfterSeconds) } : undefined });
}

export const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";
export const CUSTODY_CODE = "CREDENTIAL_NOT_OWNER_HELD";
const STEP_UP_MESSAGE = "Эрх олгохын тулд шалтгаан, баталгаажуулалт болон өөрийн нууц үгээ оруулна уу";
const CUSTODY_MESSAGE =
  "Энэ хэрэглэгчийн нууц үгийг админ саяхан үүсгэсэн эсвэл сэргээсэн бөгөөд хэрэглэгч өөрөө нууц үгээ солиогүй байна. Эхлээд хэрэглэгч нэвтэрч нууц үгээ (Тохиргоо) солино уу, дараа нь эрх олгоно.";
const UNAVAILABLE = "Түр хугацаанд боломжгүй байна. Дахин оролдоно уу";
const TOO_MANY = "Хэт олон оролдлого хийсэн байна. Хэсэг хүлээгээд дахин оролдоно уу";

/**
 * Whether the account's credential is (as far as the audit log can tell) in its owner's hands.
 *
 * The latest ISSUE event for the account is a user creation or an admin password reset that carries the Stage 1 `kind`
 * marker (older events have none and are ignored: accounts issued before this release are not covered). The owner holds
 * the credential if the account itself changed its own password after that issue event. No issue event = owner-held.
 * Any error reads as UNKNOWN, which the caller treats as a refusal.
 */
export async function custodyOf(db: Db, userId: string): Promise<Custody> {
  try {
    const issue = await db.auditLog.findFirst({
      where: {
        entityType: "User",
        entityId: userId,
        OR: [
          { action: "RESET_CREDENTIALS", afterJson: { contains: '"kind":"PASSWORD_RESET"' } },
          { action: "CREATE_USER", afterJson: { contains: '"kind":"USER_CREATE"' } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!issue) return { state: "OWNER_HELD", issuedAt: null };
    const own = await db.auditLog.findFirst({
      where: { entityType: "User", entityId: userId, action: "CHANGE_PASSWORD", actorId: userId, createdAt: { gt: issue.createdAt } },
      select: { id: true },
    });
    return { state: own ? "OWNER_HELD" : "ADMIN_ISSUED_UNCHANGED", issuedAt: issue.createdAt.toISOString() };
  } catch (err) {
    console.error("[admin] custody check failed:", err instanceof Error ? err.name : "unknown");
    return { state: "UNKNOWN", issuedAt: null };
  }
}

export interface AuthorizeGrantInput {
  /** From the authenticated session. */
  adminId: string;
  stepUp: StepUp;
  kind: GrantKind;
  targetUserId: string;
  ip: string | null;
  /** Existing accounts: require owner custody of the credential. Not for a user being created in this very request. */
  checkCustody?: boolean;
}

export async function authorizeGrant(input: AuthorizeGrantInput): Promise<{ ok: true; grant: GrantContext } | GrantFailure> {
  const reason = (input.stepUp.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500 || input.stepUp.confirmed !== true || !input.stepUp.adminPassword) {
    return fail(400, STEP_UP_MESSAGE, STEP_UP_REQUIRED);
  }

  const admin = await prisma.user.findUnique({ where: { id: input.adminId }, select: { role: true, isActive: true } });
  if (!admin || !admin.isActive || admin.role !== "ADMIN") return fail(403, "Эрхгүй үйлдэл");
  // nobody grants authority to themselves
  if (input.targetUserId === input.adminId) return fail(403, "Өөртөө эрх олгох боломжгүй", "SELF_GRANT_FORBIDDEN");

  let admission;
  try {
    admission = await admit(authorityGrantBuckets(input.adminId));
  } catch {
    return fail(503, UNAVAILABLE);
  }
  if (!admission.ok) return fail(429, TOO_MANY, undefined, admission.retryAfterSeconds);

  const denied = await verifyAccountPassword(input.adminId, input.stepUp.adminPassword, input.ip);
  if (denied) return fail(denied.status, denied.error, undefined, denied.retryAfterSeconds);

  const custody: Custody = input.checkCustody === false ? { state: "OWNER_HELD", issuedAt: null } : await custodyOf(prisma, input.targetUserId);
  if (custody.state === "ADMIN_ISSUED_UNCHANGED") return fail(409, CUSTODY_MESSAGE, CUSTODY_CODE);
  if (custody.state === "UNKNOWN") return fail(403, "Хэрэглэгчийн нууц үгийн байдлыг тодорхойлж чадсангүй тул эрх олгохоос татгалзлаа");

  return { ok: true, grant: { adminId: input.adminId, kind: input.kind, reason, targetUserId: input.targetUserId, ip: input.ip, custody } };
}

export interface GrantRecord {
  /** What was changed: e.g. "User", "ApprovalRoleAssignment", "Department". */
  subjectType: string;
  subjectId: string;
  /** One line, no secrets: what the grant is. Shown in the notifications. */
  summary: string;
  before: unknown;
  after: unknown;
  /** Previous holder(s) of what is granted: they are told too. */
  previousHolderIds?: string[];
}

/**
 * Writes the before/after audit row and the notifications of a grant. Call it INSIDE the transaction that makes the
 * change, and emit `announce(ids)` after the commit. Returns the ids that were notified.
 */
export async function recordGrant(tx: Prisma.TransactionClient, grant: GrantContext, record: GrantRecord): Promise<string[]> {
  const admin = await tx.user.findUnique({ where: { id: grant.adminId }, select: { name: true } });
  await tx.auditLog.create({
    data: {
      entityType: "AuthorityGrant",
      entityId: grant.targetUserId,
      action: "UPDATE_USER",
      actorId: grant.adminId,
      ipAddress: grant.ip,
      beforeJson: JSON.stringify(record.before),
      // reason, confirmation, custody evidence and what changed; never a password, a hash or a token
      afterJson: JSON.stringify({
        kind: "AUTHORITY_GRANT",
        grantKind: grant.kind,
        reason: grant.reason,
        confirmed: true,
        subject: { type: record.subjectType, id: record.subjectId },
        summary: record.summary,
        after: record.after,
        custody: grant.custody,
      }),
    },
  });

  const [admins, executive] = await Promise.all([
    tx.user.findMany({ where: { role: "ADMIN", isActive: true, id: { not: grant.adminId } }, select: { id: true } }),
    tx.approvalRoleAssignment.findFirst({ where: { role: "EXECUTIVE_DIRECTOR", isActive: true }, select: { userId: true } }),
  ]);
  const concerned = new Set<string>([grant.targetUserId, ...(record.previousHolderIds ?? [])]);
  const oversight = new Set<string>([...admins.map((a) => a.id), ...(executive ? [executive.userId] : [])]);
  concerned.delete(grant.adminId);
  oversight.delete(grant.adminId);

  const when = new Intl.DateTimeFormat("mn-MN", { timeZone: "Asia/Ulaanbaatar", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const adminName = admin?.name ?? "Админ";
  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const userId of new Set([...concerned, ...oversight])) {
    const isConcerned = concerned.has(userId);
    rows.push({
      userId,
      type: "GENERIC",
      title: isConcerned ? "Таны эрх, албан тушаал өөрчлөгдлөө" : "Эрх олгох үйлдэл хийгдлээ",
      body: isConcerned
        ? `${adminName} ${when}-д: ${record.summary}. Шалтгаан: ${grant.reason}. Хэрэв та үүнийг мэдээгүй бол даруй системийн удирдлагад мэдэгдээрэй.`
        : `${adminName} ${when}-д: ${record.summary}. Шалтгаан: ${grant.reason}.`,
    });
  }
  if (rows.length > 0) await tx.notification.createMany({ data: rows });
  return rows.map((r) => r.userId);
}

/** After the commit: wake the notified users' open sessions. */
export function announce(userIds: string[]) {
  for (const id of userIds) emitUserEvent(id, { type: "notification" });
}
