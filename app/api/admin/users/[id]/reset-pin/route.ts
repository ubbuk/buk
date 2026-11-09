import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { clientIp } from "@/lib/client-ip";
import { resetPinAsAdmin } from "@/lib/pin-management";

const bodySchema = z.object({
  reason: z.string().trim().min(3, "Цуцлах шалтгаанаа бичнэ үү").max(500),
  identityVerified: z.literal(true, { errorMap: () => ({ message: "Ажилтны хувийн байдлыг баталгаажуулсан гэдгээ тэмдэглэнэ үү" }) }),
  adminPassword: z.string().min(1, "Өөрийн нууц үгээ оруулна уу"),
});

// An ADMIN resets another user's PIN: the credential is deleted (the admin never sees, chooses or receives a PIN)
// and the employee creates a new one with their own password. Needs a reason, the admin's attestation that the
// employee's identity was verified, and the admin's own password. See lib/pin-management.ts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const result = await resetPinAsAdmin({
    adminId: session.user.id,
    adminPassword: parsed.data.adminPassword,
    targetUserId: id,
    reason: parsed.data.reason,
    identityVerified: true,
    ip: clientIp(req.headers),
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined }
    );
  }
  // nothing about the PIN: only that the employee must create a new one
  return NextResponse.json({ ok: true, hadPin: result.hadPin });
}
