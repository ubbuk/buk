import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const APPROVAL_ROLES = [
  "ENGINEERING_CHIEF",
  "OPERATIONS_DIRECTOR",
  "FINANCE_DIRECTOR",
  "EXECUTIVE_DIRECTOR",
  "STOREKEEPER_LEAD",
  "CHIEF_ACCOUNTANT_LEAD",
] as const;

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

  return NextResponse.json({ ok: true });
}
