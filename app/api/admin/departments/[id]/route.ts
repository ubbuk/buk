import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { emitBroadcast } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { invalidate } from "@/lib/cache";

const bodySchema = z.object({ headId: z.string().nullable() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) return NextResponse.json({ error: "Цех, тасаг олдсонгүй" }, { status: 404 });

  const updated = await prisma.department.update({ where: { id }, data: { headId: parsed.data.headId } });
  await prisma.auditLog.create({
    data: { entityType: "Department", entityId: id, action: "UPDATE", actorId: session.user.id },
  });
  invalidate("departments:list");

  // Admin edits change what other open sessions show (user lists, department
  // heads, approvers) -- tell them to refetch instead of waiting for a reload.
  emitBroadcast({ type: "data-changed" });
  return NextResponse.json({ id: updated.id, headId: updated.headId });
}
