import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { clientIp } from "@/lib/client-ip";
import { createUserAsAdmin } from "@/lib/credential-reset";
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
      canViewPayroll: u.canViewPayroll,
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
  // The administrator re-enters their OWN password: creating a user hands them a temporary password.
  // Required when the role is privileged (any role but EMPLOYEE): lib/authority-grant.ts
  reason: z.string().optional(),
  confirmed: z.boolean().optional(),
});

// Creates a user and returns a temporary password to the administrator. Stage 1 hardening (lib/credential-reset.ts):
// active ADMIN checked in the database, the admin's own password, rate limited, audited in the same transaction.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });

  const { reason, confirmed, ...data } = parsed.data;
  const result = await createUserAsAdmin({ adminId: session.user.id, ip: clientIp(req.headers), data, grant: { reason, confirmed } });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status, headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined }
    );
  }
  return NextResponse.json({ id: result.id, email: result.email, tempPassword: result.tempPassword }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
