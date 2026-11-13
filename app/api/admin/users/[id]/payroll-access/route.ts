// PATCH /api/admin/users/[id]/payroll-access  { canViewPayroll, reason, adminPassword, confirmed }
// 1С хөтчийн цалингийн объектыг харах эрхийг хүн тус бүрээр олгох/хасах. Зөвхөн ADMIN (сервер дээр DB-ээр шалгана).
// Олгох ба хасах ХОЁУЛАНД админ өөрийн нууц үгээ дахин оруулж (step-up), шалтгааныг заавал бичнэ. Нууц үг нь нууц үг
// солих, session хүчингүй болгох үйлдэлтэй адил хязгаартай (lib/login-throttle.ts): 5 буруу оролдлого → түр түгжинэ.
// Өөрчлөлт бүр AuditLog-д (хэн, хэнд, өгсөн/хассан, шалтгаан, хэзээ, IP) нэг transaction-д бүртгэгдэнэ: бүртгэж
// чадахгүй бол эрх өөрчлөгдөхгүй. Нууц үг, hash бүртгэгдэхгүй. Эрх DB-д хадгалагдах бөгөөд хөтөч хүсэлт бүрд DB-ээс
// уншдаг тул хассан даруйд хүчингүй болно.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { authOptions } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { verifyAccountPassword } from "@/lib/pin-management";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  canViewPayroll: z.boolean(),
  reason: z.string().trim().min(3, "Шалтгаанаа бичнэ үү").max(500, "Шалтгаан хэт урт байна"),
  adminPassword: z.string().min(1, "Өөрийн нууц үгээ оруулна уу"),
  confirmed: z.literal(true, { errorMap: () => ({ message: "Үйлдлийг баталгаажуулна уу" }) }),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  const admin = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, isActive: true } });
  if (!admin || !admin.isActive || admin.role !== "ADMIN") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });

  // Админ өөрийн нууц үгээр дахин баталгаажуулна (буруу бол 401, хэт олон оролдлогод 429 + Retry-After)
  const ip = clientIp(req.headers);
  const denied = await verifyAccountPassword(session.user.id, parsed.data.adminPassword, ip);
  if (denied) {
    return NextResponse.json({ error: denied.error }, { status: denied.status, headers: denied.retryAfterSeconds ? { "Retry-After": String(denied.retryAfterSeconds) } : undefined });
  }

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, canViewPayroll: true } });
  if (!target) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

  const next = parsed.data.canViewPayroll;
  if (target.canViewPayroll === next) return NextResponse.json({ id, canViewPayroll: next }); // өөрчлөлт байхгүй: бүртгэхгүй

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { canViewPayroll: next } });
      await tx.auditLog.create({
        data: {
          entityType: "User",
          entityId: id,
          action: "ONEC_PAYROLL_ACCESS",
          actorId: session.user.id,
          beforeJson: JSON.stringify({ canViewPayroll: target.canViewPayroll }),
          // шалтгаан, баталгаажуулалт, юу өөрчлөгдсөн; хэзээ ч нууц үг, hash биш
          afterJson: JSON.stringify({ canViewPayroll: next, change: next ? "granted" : "revoked", reason: parsed.data.reason, confirmed: true, stepUp: "admin_password" }),
          ipAddress: ip,
        },
      });
    });
  } catch {
    return NextResponse.json({ error: "Эрх өөрчлөх үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй, дахин оролдоно уу" }, { status: 500 });
  }
  return NextResponse.json({ id, canViewPayroll: next });
}
