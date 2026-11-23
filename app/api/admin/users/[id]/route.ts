import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions, userSessionCacheKey } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { announce, authorizeGrant, grantFailureResponse, recordGrant, type GrantContext } from "@/lib/authority-grant";
import { isAdminRoleGrantLocked, isPrivilegedRole, roleChangeIsGrant } from "@/lib/authority-roles";
import { approvalCapabilityOrUnknown } from "@/lib/credential-guard";
import { clientIp } from "@/lib/client-ip";
import { emitBroadcast } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { invalidate } from "@/lib/cache";
import { sessionRevocation } from "@/lib/session-revocation";
import { orphanableWork } from "@/lib/procurement-handover";
import { USER_ROLES } from "@/lib/types";
import { removeUser } from "@/lib/user-removal";

const patchSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  title: z.string().trim().min(1).nullable().optional(),
  departmentId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  // deliberate override when the person still holds unfinished procurement work (see below)
  acknowledgeUnfinishedProcurement: z.boolean().optional(),
  // Step-up, required only when the change GRANTS authority (a privileged role, re-activating a privileged account)
  adminPassword: z.string().optional(),
  reason: z.string().optional(),
  confirmed: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.deletedAt) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

  if (parsed.data.departmentId && !(await prisma.department.findUnique({ where: { id: parsed.data.departmentId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Сонгосон цех, тасаг олдсонгүй. Жагсаалтыг шинэчлээд дахин сонгоно уу", code: "DEPARTMENT_NOT_FOUND" }, { status: 400 });
  }

  // Deactivating a procurement manager, or taking away the MANAGER role, would strand the
  // items assigned to them (nobody else may buy them) and, for the International manager,
  // the classification queue. Refuse unless the ADMIN explicitly acknowledges it; the
  // safe path is the handover first (it works for an already inactive manager too).
  const leavesWork = (parsed.data.isActive === false && user.isActive) || (parsed.data.role !== undefined && parsed.data.role !== "MANAGER" && user.role === "MANAGER");
  let acknowledged: { items: number; requests: number; classification: number } | null = null;
  if (leavesWork) {
    const work = await orphanableWork(id);
    if (work.items > 0 || work.classification > 0) {
      if (!parsed.data.acknowledgeUnfinishedProcurement) {
        return NextResponse.json(
          {
            error: `Энэ менежерт ${work.requests} захиалгын ${work.items} дуусаагүй материал${work.classification > 0 ? `, ${work.classification} ангилах захиалга` : ""} байна. Эхлээд «Дуусаагүй ажлыг шилжүүлэх» үйлдлийг хийнэ үү`,
            code: "HANDOVER_REQUIRED",
            affectedRequests: work.requests,
            affectedItems: work.items,
            pendingClassification: work.classification,
          },
          { status: 409 }
        );
      }
      acknowledged = work;
    }
  }

  // Does this change GRANT authority? A privileged role it did not have, or bringing back an account that carries
  // authority (by role or by an assignment it kept). Anything else (title, department, demotion, an ordinary
  // employee's re-activation) is unchanged and needs no step-up.
  const roleGrant = parsed.data.role !== undefined && roleChangeIsGrant(user.role, parsed.data.role);
  // The ADMIN role is never granted through the application (one administrator, see lib/authority-roles.ts) ...
  if (roleGrant && isAdminRoleGrantLocked(parsed.data.role as string)) {
    return NextResponse.json({ error: "ADMIN эрхийг систем дотроос олгох боломжгүй. Зөвхөн баримтжуулсан break-glass журмаар олгоно", code: "ADMIN_ROLE_LOCKED" }, { status: 403 });
  }
  // ... and the last active administrator can be neither demoted nor deactivated: that would lock everybody out.
  if (user.role === "ADMIN" && user.isActive && ((parsed.data.role !== undefined && parsed.data.role !== "ADMIN") || parsed.data.isActive === false)) {
    const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
    if (activeAdmins <= 1) {
      return NextResponse.json({ error: "Сүүлчийн идэвхтэй админы эрхийг бууруулах, идэвхгүй болгох боломжгүй", code: "LAST_ADMIN" }, { status: 409 });
    }
  }
  const reactivation = parsed.data.isActive === true && !user.isActive;
  const reactivationGrant = reactivation && (isPrivilegedRole(parsed.data.role ?? user.role) || (await approvalCapabilityOrUnknown(prisma, id)).capable);
  let grant: GrantContext | null = null;
  if (roleGrant || reactivationGrant) {
    const authorised = await authorizeGrant({
      adminId: session.user.id,
      stepUp: { adminPassword: parsed.data.adminPassword, reason: parsed.data.reason, confirmed: parsed.data.confirmed },
      kind: roleGrant ? "ROLE_ELEVATION" : "REACTIVATION",
      targetUserId: id,
      ip: clientIp(req.headers),
      checkCustody: true,
    });
    if (!authorised.ok) return grantFailureResponse(authorised);
    grant = authorised.grant;
  }

  const before = { role: user.role, title: user.title, departmentId: user.departmentId, isActive: user.isActive };
  let notified: string[] = [];
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id },
        data: {
          role: parsed.data.role,
          title: parsed.data.title,
          departmentId: parsed.data.departmentId,
          isActive: parsed.data.isActive,
          // deactivating revokes every session for good: re-activating the account must not bring old tokens back
          ...(parsed.data.isActive === false && user.isActive ? sessionRevocation() : {}),
        },
      });
      const after = { role: row.role, title: row.title, departmentId: row.departmentId, isActive: row.isActive };
      await tx.auditLog.create({
        data: {
          entityType: "User",
          entityId: id,
          action: "UPDATE_USER",
          actorId: session.user.id,
          beforeJson: JSON.stringify(before),
          afterJson: JSON.stringify({ ...after, ...(acknowledged ? { acknowledgedUnfinishedProcurement: acknowledged } : {}) }),
        },
      });
      if (grant) {
        const summary = roleGrant ? `${user.name}-ийн эрх (role) ${before.role} → ${after.role}` : `${user.name}-ийн бүртгэл дахин идэвхжлээ (${after.role})`;
        notified = await recordGrant(tx, grant, { subjectType: "User", subjectId: id, summary, before, after });
      }
      return row;
    });
  } catch (err) {
    if (!grant) throw err;
    // the audit row or a notification could not be written: nothing was changed
    console.error("[admin] authority grant failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Эрх олгох үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй, дахин оролдоно уу" }, { status: 500 });
  }
  invalidate(userSessionCacheKey(id));
  announce(notified);

  // Admin edits change what other open sessions show (user lists, department
  // heads, approvers) -- tell them to refetch instead of waiting for a reload.
  emitBroadcast({ type: "data-changed" });
  return NextResponse.json({ id: updated.id, role: updated.role, title: updated.title, departmentId: updated.departmentId, isActive: updated.isActive });
}

const deleteSchema = z.object({
  // the administrator's OWN password (re-authentication)
  adminPassword: z.string().min(1),
  // one answer per responsibility: a user id (take over) or null (leave empty on purpose)
  transfers: z.record(z.string(), z.string().min(1).nullable()).default({}),
  // who takes the approval steps that wait on the person and that no specific answer covers
  pendingReceiverId: z.string().min(1).nullable().optional(),
});

// Removes a user after the responsibilities were handed over (lib/user-removal.ts): without history the account is deleted for
// good, with history it is marked deleted (hidden, cannot sign in, e-mail released, records keep the name). The ADMIN confirms
// with their own password; everything is audited and nothing is written when a step fails.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const { id } = await params;
  if (id === session.user.id) return NextResponse.json({ error: "Өөрийгөө устгах боломжгүй", code: "SELF_DELETE" }, { status: 400 });

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Админы нууц үгээ оруулна уу", code: "PASSWORD_REQUIRED" }, { status: 400 });

  const result = await removeUser({ adminId: session.user.id, adminPassword: parsed.data.adminPassword, targetId: id, ip: clientIp(req.headers), transfers: parsed.data.transfers, pendingReceiverId: parsed.data.pendingReceiverId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status, headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined });
  }
  invalidate(userSessionCacheKey(id));
  // the screen only says "deleted": whether the record was erased or kept under a deleted mark is an internal matter
  return NextResponse.json({ ok: true });
}
