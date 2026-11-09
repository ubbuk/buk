import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/client-ip";
import { admit, passwordChangeBuckets } from "@/lib/login-throttle";

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Шинэ нууц үг дор хаяж 8 тэмдэгт байх ёстой"),
  confirmPassword: z.string(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Хүчингүй өгөгдөл" }, { status: 400 });
  }
  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "Шинэ нууц үг хоёр удаа ижил байх ёстой" }, { status: 400 });
  }

  // Guessing the current password through a (possibly stolen) session is limited like logging in is:
  // checked before the user lookup and the bcrypt work, shared across instances (lib/login-throttle.ts).
  // A failure of the limiter refuses the change rather than leaving it unmetered.
  let admission;
  try {
    admission = await admit(passwordChangeBuckets(session.user.id, clientIp(req.headers)));
  } catch {
    return NextResponse.json({ error: "Түр хугацаанд боломжгүй байна. Дахин оролдоно уу" }, { status: 503 });
  }
  if (!admission.ok) {
    return NextResponse.json(
      { error: "Хэт олон удаа буруу оролдлоо. Хэсэг хүлээгээд дахин оролдоно уу" },
      { status: 429, headers: { "Retry-After": String(admission.retryAfterSeconds) } }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

  const passwordValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordValid) {
    return NextResponse.json({ error: "Одоогийн нууц үг буруу байна" }, { status: 401 });
  }
  await admission.settle();

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  // No password value in beforeJson/afterJson — only the fact that it changed.
  await prisma.auditLog.create({
    data: { entityType: "User", entityId: user.id, action: "CHANGE_PASSWORD", actorId: user.id, ipAddress: clientIp(req.headers) },
  });

  return NextResponse.json({ ok: true });
}
