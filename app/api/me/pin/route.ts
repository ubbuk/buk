import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPinSet, isValidPinFormat } from "@/lib/pin";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  return NextResponse.json({ hasPin: await hasPinSet(session.user.id) });
}

const bodySchema = z.object({
  pin: z.string(),
  confirmPin: z.string(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { pin, confirmPin } = parsed.data;

  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: "PIN яг дөрөв оронтой тоо байх ёстой" }, { status: 400 });
  }
  if (pin !== confirmPin) {
    return NextResponse.json({ error: "PIN хоёр удаа ижил байх ёстой" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });

  const pinHash = await bcrypt.hash(pin, 10);
  await prisma.approvalPinCredential.upsert({
    where: { userId: user.id },
    update: { pinHash, failedAttempts: 0, lockedUntil: null },
    create: { userId: user.id, pinHash },
  });
  // No PIN value in beforeJson/afterJson — only the fact that it changed.
  await prisma.auditLog.create({
    data: { entityType: "User", entityId: user.id, action: "PIN_SETUP", actorId: user.id },
  });

  return NextResponse.json({ ok: true });
}
