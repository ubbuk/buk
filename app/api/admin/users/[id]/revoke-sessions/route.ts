import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { clientIp } from "@/lib/client-ip";
import { emitUserEvent } from "@/lib/events";
import { verifyAccountPassword } from "@/lib/pin-management";
import { prisma } from "@/lib/prisma";
import { forgetSession, sessionRevocation } from "@/lib/session-revocation";

const bodySchema = z.object({
  reason: z.string().trim().min(3, "Шалтгаанаа бичнэ үү").max(500),
  adminPassword: z.string().min(1, "Өөрийн нууц үгээ оруулна уу"),
});

// Signs an account out of every device (incident response: a lost phone, a suspected stolen session) without touching its
// password, role or data. ADMIN only, with the administrator's own password and a reason; recorded and notified in the
// same transaction. An administrator revokes their OWN sessions by changing their password (Settings).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  if (id === session.user.id) {
    return NextResponse.json({ error: "Өөрийн session-ийг Тохиргоо хэсгээс нууц үгээ солиж хүчингүй болгоно" }, { status: 403 });
  }
  const admin = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, isActive: true } });
  if (!admin || !admin.isActive || admin.role !== "ADMIN") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const denied = await verifyAccountPassword(session.user.id, parsed.data.adminPassword, clientIp(req.headers));
  if (denied) {
    return NextResponse.json({ error: denied.error }, { status: denied.status, headers: denied.retryAfterSeconds ? { "Retry-After": String(denied.retryAfterSeconds) } : undefined });
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!target) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: sessionRevocation() }),
      prisma.auditLog.create({
        data: {
          entityType: "User",
          entityId: id,
          action: "UPDATE_USER",
          actorId: session.user.id,
          ipAddress: clientIp(req.headers),
          afterJson: JSON.stringify({ kind: "SESSIONS_REVOKED", reason: parsed.data.reason }),
        },
      }),
      prisma.notification.create({
        data: { userId: id, type: "GENERIC", title: "Таны бүх нэвтрэлт хаагдлаа", body: `Админ аюулгүй байдлын шалтгаанаар таныг бүх төхөөрөмжөөс гаргалаа. Шалтгаан: ${parsed.data.reason}. Дахин нэвтэрнэ үү.` },
      }),
    ]);
  } catch (err) {
    console.error("[admin] session revocation failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Session хүчингүй болгох үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй" }, { status: 500 });
  }
  forgetSession(id);
  emitUserEvent(id, { type: "notification" });
  return NextResponse.json({ ok: true });
}
