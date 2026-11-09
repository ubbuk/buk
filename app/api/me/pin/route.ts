import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { hasPinSet, isValidPinFormat } from "@/lib/pin";
import { setOwnPin } from "@/lib/pin-management";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  return NextResponse.json({ hasPin: await hasPinSet(session.user.id) });
}

const bodySchema = z.object({
  pin: z.string(),
  confirmPin: z.string(),
  currentPassword: z.string().min(1, "Одоогийн нууц үгээ оруулна уу"),
});

// Creates or changes the signed-in user's own approval PIN. The account password is required every time (a session
// alone is not enough), the user comes from the session only, and a locked account cannot be changed. See
// lib/pin-management.ts.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Хүчингүй өгөгдөл" }, { status: 400 });
  }
  const { pin, confirmPin, currentPassword } = parsed.data;

  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: "PIN яг дөрөв оронтой тоо байх ёстой" }, { status: 400 });
  }
  if (pin !== confirmPin) {
    return NextResponse.json({ error: "PIN хоёр удаа ижил байх ёстой" }, { status: 400 });
  }

  const result = await setOwnPin({ userId: session.user.id, currentPassword, pin, ip: clientIp(req.headers) });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined }
    );
  }
  return NextResponse.json({ ok: true });
}
