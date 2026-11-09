import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { clientIp } from "@/lib/client-ip";
import { resetPasswordAsAdmin } from "@/lib/credential-reset";

const bodySchema = z.object({
  reason: z.string().trim().min(3, "Сэргээх шалтгаанаа бичнэ үү").max(500, "Шалтгаан хэт урт байна"),
  identityVerified: z.literal(true, { errorMap: () => ({ message: "Ажилтны хувийн байдлыг баталгаажуулсан гэдгээ тэмдэглэнэ үү" }) }),
  adminPassword: z.string().min(1, "Өөрийн нууц үгээ оруулна уу"),
});

// An ADMIN resets an employee's password and receives a temporary one. Stage 1 hardening (lib/credential-reset.ts):
// never for approval-capable accounts or the admin's own, and only with a reason, the identity attestation and the
// admin's own password, rate limited, audited, and the employee is notified. Not a complete fix: the admin still
// learns the temporary password of the account that is allowed here.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const result = await resetPasswordAsAdmin({
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
  // a credential: never cached
  return NextResponse.json({ tempPassword: result.tempPassword }, { headers: { "Cache-Control": "no-store" } });
}
