import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { emitBroadcast, emitUserEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
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

const bodySchema = z.object({ role: z.enum(APPROVAL_ROLES), userId: z.string().min(1) });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

  const role = parsed.data.role;
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
      await tx.approvalRoleAssignment.updateMany({ where: { role, isActive: true }, data: { isActive: false, endedAt: new Date() } });
      await tx.approvalRoleAssignment.create({ data: { role, userId: user.id, isActive: true } });
      await tx.auditLog.create({ data: { entityType: "ApprovalRoleAssignment", entityId: user.id, action: "UPDATE", actorId: session.user.id } });
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
    });
    if (!outcome.ok) {
      const body: Record<string, unknown> = { ...outcome };
      delete body.ok;
      return NextResponse.json(body, { status: outcome.status });
    }
    emitBroadcast({ type: "data-changed" });
    emitUserEvent(user.id, { type: "notification" });
    return NextResponse.json({ ok: true });
  }

  await prisma.$transaction(async (tx) => {
    await tx.approvalRoleAssignment.updateMany({
      where: { role: parsed.data.role, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });
    await tx.approvalRoleAssignment.create({
      data: { role: parsed.data.role, userId: parsed.data.userId, isActive: true },
    });
    await tx.auditLog.create({
      data: { entityType: "ApprovalRoleAssignment", entityId: parsed.data.userId, action: "UPDATE", actorId: session.user.id },
    });
  });

  // Admin edits change what other open sessions show (user lists, department
  // heads, approvers) -- tell them to refetch instead of waiting for a reload.
  emitBroadcast({ type: "data-changed" });
  return NextResponse.json({ ok: true });
}
