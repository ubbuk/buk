import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { invalidate } from "@/lib/cache";

const bodySchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["OFFICE", "FACTORY"]),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const existing = await prisma.department.findFirst({ where: { name: parsed.data.name } });
  if (existing) return NextResponse.json({ error: "Энэ нэртэй цех, тасаг бүртгэлтэй байна" }, { status: 409 });

  const department = await prisma.department.create({ data: parsed.data });
  await prisma.auditLog.create({
    data: { entityType: "Department", entityId: department.id, action: "CREATE", actorId: session.user.id },
  });
  invalidate("departments:list");

  return NextResponse.json({ id: department.id, name: department.name, type: department.type }, { status: 201 });
}
