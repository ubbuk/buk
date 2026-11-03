import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { generateTempPassword } from "@/lib/credentials";
import { emitBroadcast } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { USER_ROLES } from "@/lib/types";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const [users, pinCredentials] = await Promise.all([
    prisma.user.findMany({ include: { department: true }, orderBy: { createdAt: "asc" } }),
    prisma.approvalPinCredential.findMany({ select: { userId: true, lockedUntil: true } }),
  ]);
  const pinByUser = new Map(pinCredentials.map((p) => [p.userId, p]));

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      title: u.title,
      departmentId: u.departmentId,
      departmentName: u.department?.name ?? null,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      hasPinSet: pinByUser.has(u.id),
      pinLocked: !!pinByUser.get(u.id)?.lockedUntil && pinByUser.get(u.id)!.lockedUntil! > new Date(),
    }))
  );
}

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
  title: z.string().trim().min(1).nullable().optional(),
  role: z.enum(USER_ROLES),
  departmentId: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return NextResponse.json({ error: "Энэ и-мэйл хаягтай хэрэглэгч бүртгэлтэй байна" }, { status: 409 });

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      title: parsed.data.title ?? null,
      role: parsed.data.role,
      departmentId: parsed.data.departmentId ?? null,
      passwordHash,
    },
  });
  await prisma.auditLog.create({
    data: { entityType: "User", entityId: user.id, action: "CREATE_USER", actorId: session.user.id },
  });

  // Admin edits change what other open sessions show (user lists, department
  // heads, approvers) -- tell them to refetch instead of waiting for a reload.
  emitBroadcast({ type: "data-changed" });
  return NextResponse.json({ id: user.id, email: user.email, tempPassword }, { status: 201 });
}
