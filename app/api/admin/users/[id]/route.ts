import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions, userSessionCacheKey } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { emitBroadcast } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { invalidate } from "@/lib/cache";
import { USER_ROLES } from "@/lib/types";

const patchSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  title: z.string().trim().min(1).nullable().optional(),
  departmentId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
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

  const updated = await prisma.user.update({
    where: { id },
    data: {
      role: parsed.data.role,
      title: parsed.data.title,
      departmentId: parsed.data.departmentId,
      isActive: parsed.data.isActive,
    },
  });
  await prisma.auditLog.create({
    data: { entityType: "User", entityId: id, action: "UPDATE_USER", actorId: session.user.id },
  });
  invalidate(userSessionCacheKey(id));

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
