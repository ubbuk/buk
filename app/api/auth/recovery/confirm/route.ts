import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { confirmRecovery, recoveryEnabled } from "@/lib/password-recovery";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

// PUBLIC (the token is the proof). Disabled (404) until SELF_SERVICE_RECOVERY=on. One use, 30 minutes, throttled per
// address and per token; success revokes every session of the account.
export async function POST(req: Request) {
  if (!recoveryEnabled()) return NextResponse.json({ error: "Боломжгүй" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const result = await confirmRecovery({ token: parsed.data.token, newPassword: parsed.data.newPassword, ip: clientIp(req.headers) });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined });
  }
  return NextResponse.json({ ok: true });
}
