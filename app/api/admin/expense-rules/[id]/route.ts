import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { clientIp } from "@/lib/client-ip";
import { prisma } from "@/lib/prisma";
import { expenseRuleSchema } from "@/lib/onec/expense-rule-schema";

// Засах (PATCH: аль ч талбар), устгах (DELETE). Аудитад өмнөх, дараах утгатай бүртгэгдэнэ.
const patchSchema = expenseRuleSchema.partial();

const snapshot = (r: { field: string; pattern: string; category: string; priority: number; isActive: boolean; note: string | null }) => ({
  field: r.field,
  pattern: r.pattern,
  category: r.category,
  priority: r.priority,
  isActive: r.isActive,
  note: r.note,
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const before = await prisma.onecExpenseCategoryRule.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Дүрэм олдсонгүй" }, { status: 404 });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.onecExpenseCategoryRule.update({ where: { id }, data: parsed.data });
    await tx.auditLog.create({
      data: { entityType: "ExpenseCategoryRule", entityId: id, action: "UPDATE", actorId: session.user.id, ipAddress: clientIp(req.headers), beforeJson: JSON.stringify(snapshot(before)), afterJson: JSON.stringify(snapshot(row)) },
    });
    return row;
  });
  return NextResponse.json({ id: updated.id });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  const { id } = await params;
  const before = await prisma.onecExpenseCategoryRule.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Дүрэм олдсонгүй" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.onecExpenseCategoryRule.delete({ where: { id } });
    await tx.auditLog.create({
      data: { entityType: "ExpenseCategoryRule", entityId: id, action: "UPDATE", actorId: session.user.id, ipAddress: clientIp(req.headers), beforeJson: JSON.stringify(snapshot(before)), afterJson: JSON.stringify({ deleted: true }) },
    });
  });
  return NextResponse.json({ ok: true });
}
