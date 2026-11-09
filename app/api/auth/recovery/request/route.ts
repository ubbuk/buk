import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { recoveryEnabled, requestRecovery } from "@/lib/password-recovery";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ email: z.string().email().max(254) });

// PUBLIC (no session: the caller forgot the password). Disabled (404) until SELF_SERVICE_RECOVERY=on. When enabled, the
// answer is the same whether or not the address belongs to an account, so it cannot be used to find out who exists.
export async function POST(req: Request) {
  if (!recoveryEnabled()) return NextResponse.json({ error: "Боломжгүй" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const result = await requestRecovery({ email: parsed.data.email, ip: clientIp(req.headers) });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined });
  }
  return NextResponse.json({ ok: true, message: "Хэрэв энэ и-мэйл бүртгэлтэй бол сэргээх заавар илгээгдэнэ" }, { status: 202 });
}
