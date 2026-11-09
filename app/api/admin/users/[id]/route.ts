import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions, userSessionCacheKey } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { announce, authorizeGrant, recordGrant, type GrantContext } from "@/lib/authority-grant";
import { isPrivilegedRole, roleChangeIsGrant } from "@/lib/authority-roles";
import { approvalCapabilityOrUnknown } from "@/lib/credential-guard";
import { clientIp } from "@/lib/client-ip";
import { emitBroadcast } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { invalidate } from "@/lib/cache";
import { orphanableWork } from "@/lib/procurement-handover";
import { USER_ROLES } from "@/lib/types";

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
  if (!user) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

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
    if (!authorised.ok) {
      return NextResponse.json(
        { error: authorised.error, code: authorised.code },
        { status: authorised.status, headers: authorised.retryAfterSeconds ? { "Retry-After": String(authorised.retryAfterSeconds) } : undefined }
      );
    }
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

// Hard delete is only possible for accounts with no history (no requests,
// approvals, stock or audit entries, not a department head). The foreign keys
// enforce that: the transaction rolls back and we answer 409, pointing the admin
// at deactivation instead so existing records keep a valid author.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const { id } = await params;
  if (id === session.user.id) return NextResponse.json({ error: "Өөрийгөө устгах боломжгүй" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

  const activeAssignment = await prisma.approvalRoleAssignment.findFirst({ where: { userId: id, isActive: true } });
  if (activeAssignment) {
    return NextResponse.json(
      { error: "Энэ хэрэглэгч батлагчаар томилогдсон байна. Эхлээд батлагчийг солино уу" },
      { status: 409 }
    );
  }

  try {
    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { userId: id } }),
      prisma.approvalPinCredential.deleteMany({ where: { userId: id } }),
      prisma.approvalRoleAssignment.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { id } }),
    ]);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return NextResponse.json(
        { error: "Энэ хэрэглэгчтэй холбоотой түүх (хүсэлт, баталгаа, цехийн дарга г.м) байгаа тул устгах боломжгүй. Оронд нь идэвхгүй болгоно уу" },
        { status: 409 }
      );
    }
    throw e;
  }

  await prisma.auditLog.create({
    data: { entityType: "User", entityId: id, action: "UPDATE_USER", actorId: session.user.id },
  });
  invalidate(userSessionCacheKey(id));

  emitBroadcast({ type: "data-changed" });
  return NextResponse.json({ ok: true });
}
