// «Мөнгөн хөрөнгө» табын ангиллын дүрэм (ADMIN). GET: админы дүрмүүд + код доторх анхдагч дүрмүүд (зөвхөн унших). POST: шинэ дүрэм.
// Админы дүрэм анхдагчаас ӨМНӨ үнэлэгдэнэ (priority өсөхөөр). Өөрчлөлт бүр аудитад бүртгэгдэнэ.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { clientIp } from "@/lib/client-ip";
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABEL, DEFAULT_RULES } from "@/lib/onec/cash-categories";
import { ruleSchema } from "@/lib/onec/cash-rule-schema";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  const rules = await prisma.onecCashCategoryRule.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({
    rules: rules.map((r) => ({ id: r.id, direction: r.direction, field: r.field, pattern: r.pattern, category: r.category, priority: r.priority, isActive: r.isActive, note: r.note })),
    defaults: DEFAULT_RULES.map((r) => ({ direction: r.direction, field: r.field, pattern: r.pattern, category: r.category, categoryLabel: CATEGORY_LABEL[r.category] })),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = ruleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });

  const { note, ...data } = parsed.data;
  const rule = await prisma.$transaction(async (tx) => {
    const created = await tx.onecCashCategoryRule.create({ data: { ...data, note: note ?? null, createdById: session.user.id } });
    await tx.auditLog.create({
      data: { entityType: "CashCategoryRule", entityId: created.id, action: "CREATE", actorId: session.user.id, ipAddress: clientIp(req.headers), afterJson: JSON.stringify(data) },
    });
    return created;
  });
  return NextResponse.json({ id: rule.id }, { status: 201 });
}
