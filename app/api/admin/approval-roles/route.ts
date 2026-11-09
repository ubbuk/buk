import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { emitBroadcast, emitUserEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { announce, authorizeGrant, recordGrant } from "@/lib/authority-grant";
import { positionEligibilityError } from "@/lib/authority-roles";
import { clientIp } from "@/lib/client-ip";
import { isProcurementPosition, POSITION_KIND, validateProcurementManager } from "@/lib/procurement-handover";
import { lockPositionExclusive, pendingClassificationRequestIds, unfinishedAssignedItems } from "@/lib/procurement-workload";

const APPROVAL_ROLES = [
  "ENGINEERING_CHIEF",
  "OPERATIONS_DIRECTOR",
  "FINANCE_DIRECTOR",
  "EXECUTIVE_DIRECTOR",
  "STOREKEEPER_LEAD",
  "CHIEF_ACCOUNTANT_LEAD",
  "DOMESTIC_PROCUREMENT_MANAGER",
  "INTERNATIONAL_PROCUREMENT_MANAGER",
] as const;

// Stage 7 responsibilities (DOMESTIC_/INTERNATIONAL_PROCUREMENT_MANAGER): the holder must be an
// active MANAGER, one person cannot hold both, and unfinished work is never orphaned.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const assignments = await prisma.approvalRoleAssignment.findMany({
    where: { isActive: true },
    include: { user: true },
  });

  return NextResponse.json(
    assignments.map((a) => ({ role: a.role, userId: a.userId, userName: a.user.name }))
  );
}

const bodySchema = z.object({
  role: z.enum(APPROVAL_ROLES),
  userId: z.string().min(1),
  // Step-up: assigning a position grants authority (lib/authority-grant.ts)
  adminPassword: z.string().optional(),
  reason: z.string().optional(),
  confirmed: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

  const role = parsed.data.role;

  // The holder must be someone who can legitimately carry the position (the role and an active account the admin
  // screen already requires); the server no longer relies on the screen to enforce it.
  const ineligible = positionEligibilityError(role, user);
  if (ineligible) return NextResponse.json({ error: ineligible }, { status: 400 });

  // Naming the person who already holds it changes nothing and grants nothing.
  const alreadyHolds = await prisma.approvalRoleAssignment.findFirst({ where: { role, userId: user.id, isActive: true }, select: { id: true } });
  if (alreadyHolds) return NextResponse.json({ ok: true, unchanged: true });

  // Granting authority: reason, confirmation, the admin own password, rate limit, and owner custody of the account.
  const authorised = await authorizeGrant({
    adminId: session.user.id,
    stepUp: { adminPassword: parsed.data.adminPassword, reason: parsed.data.reason, confirmed: parsed.data.confirmed },
    kind: isProcurementPosition(role) ? "PROCUREMENT_POSITION" : "POSITION_ASSIGNMENT",
    targetUserId: user.id,
    ip: clientIp(req.headers),
    checkCustody: true,
  });
  if (!authorised.ok) {
    return NextResponse.json(
      { error: authorised.error, code: authorised.code },
      { status: authorised.status, headers: authorised.retryAfterSeconds ? { "Retry-After": String(authorised.retryAfterSeconds) } : undefined }
    );
  }
  const grant = authorised.grant;
  const positionRecord = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], previousHolderIds: string[]) =>
    recordGrant(tx, grant, {
      subjectType: "ApprovalRoleAssignment",
      subjectId: role,
      summary: `${user.name} «${role}» албан тушаалд томилогдлоо`,
      before: { position: role, holders: previousHolderIds },
      after: { position: role, holders: [user.id] },
      previousHolderIds,
    });
  let notified: string[] = [];
  if (isProcurementPosition(role)) {
    // Replacing a procurement manager must not silently orphan their unfinished items:
    // the check and the change share one transaction under the position lock, and a
    // replacement that would leave work behind is refused until an ADMIN confirms an
    // explicit handover (POST /api/admin/procurement-handover) -- never moved implicitly.
    const outcome = await prisma.$transaction(async (tx) => {
      await lockPositionExclusive(tx, role);
      const invalid = await validateProcurementManager(tx, role, user.id);
      if (invalid) return invalid;
      const stranded = await unfinishedAssignedItems(tx, { kind: POSITION_KIND[role], notManagerId: user.id });
      if (stranded.length > 0) {
        return {
          ok: false as const,
          status: 409,
          code: "HANDOVER_REQUIRED",
          error: `Өмнөх хариуцагчийн ${new Set(stranded.map((i) => i.requestId)).size} захиалгын ${stranded.length} дуусаагүй материал байна. «Дуусаагүй ажлыг шилжүүлэх» үйлдлээр хамт шилжүүлнэ үү`,
          affectedRequests: new Set(stranded.map((i) => i.requestId)).size,
          affectedItems: stranded.length,
        };
      }
      const previous = (await tx.approvalRoleAssignment.findMany({ where: { role, isActive: true }, select: { userId: true } })).map((p) => p.userId);
      await tx.approvalRoleAssignment.updateMany({ where: { role, isActive: true }, data: { isActive: false, endedAt: new Date() } });
      await tx.approvalRoleAssignment.create({ data: { role, userId: user.id, isActive: true } });
      await tx.auditLog.create({
        data: { entityType: "ApprovalRoleAssignment", entityId: user.id, action: "UPDATE", actorId: session.user.id, beforeJson: JSON.stringify({ position: role, holders: previous }), afterJson: JSON.stringify({ position: role, holders: [user.id] }) },
      });
      notified = await positionRecord(tx, previous);
      // the International manager inherits the classification queue by position: tell them it is waiting
      if (role === "INTERNATIONAL_PROCUREMENT_MANAGER") {
        const waiting = await pendingClassificationRequestIds(tx);
        if (waiting.length > 0) {
          await tx.notification.create({
            data: { userId: user.id, type: "PROCUREMENT_REQUIRED", title: "Ангилах захиалга хүлээж байна", body: `${waiting.length} захиалгын дутуу материалыг ангилж баталгаажуулна уу` },
          });
        }
      }
      return { ok: true as const };
    }).catch((err: unknown) => {
      // the record or a notification could not be written: the assignment did not happen
      console.error("[admin] position assignment failed:", err instanceof Error ? err.name : "unknown");
      return { ok: false as const, status: 500, error: "Албан тушаал оноох үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй, дахин оролдоно уу" };
    });
    if (!outcome.ok) {
      const body: Record<string, unknown> = { ...outcome };
      delete body.ok;
      return NextResponse.json(body, { status: outcome.status });
    }
    emitBroadcast({ type: "data-changed" });
    emitUserEvent(user.id, { type: "notification" });
    announce(notified);
    return NextResponse.json({ ok: true });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const previous = (await tx.approvalRoleAssignment.findMany({ where: { role: parsed.data.role, isActive: true }, select: { userId: true } })).map((p) => p.userId);
      await tx.approvalRoleAssignment.updateMany({
        where: { role: parsed.data.role, isActive: true },
        data: { isActive: false, endedAt: new Date() },
      });
      await tx.approvalRoleAssignment.create({
        data: { role: parsed.data.role, userId: parsed.data.userId, isActive: true },
      });
      await tx.auditLog.create({
        data: {
          entityType: "ApprovalRoleAssignment",
          entityId: parsed.data.userId,
          action: "UPDATE",
          actorId: session.user.id,
          beforeJson: JSON.stringify({ position: role, holders: previous }),
          afterJson: JSON.stringify({ position: role, holders: [parsed.data.userId] }),
        },
      });
      notified = await positionRecord(tx, previous);
    });
  } catch (err) {
    // the record or a notification could not be written: the assignment did not happen
    console.error("[admin] position assignment failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Албан тушаал оноох үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй, дахин оролдоно уу" }, { status: 500 });
  }
  announce(notified);

  // Admin edits change what other open sessions show (user lists, department
  // heads, approvers) -- tell them to refetch instead of waiting for a reload.
  emitBroadcast({ type: "data-changed" });
  return NextResponse.json({ ok: true });
}
