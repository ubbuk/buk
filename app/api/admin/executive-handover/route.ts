import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { executeExecutiveHandover, previewExecutiveHandover } from "@/lib/executive-handover";

export const dynamic = "force-dynamic";

// ADMIN only. GET = read-only preview of the pending executive work a handover would move;
// POST = the explicit, reasoned confirmation. The ADMIN only moves responsibility to the
// current EXECUTIVE_DIRECTOR position holder; they gain no approval authority.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const fromUserId = sp.get("fromUserId");
  if (!fromUserId) return NextResponse.json({ error: "Өмнөх захирлыг сонгоно уу" }, { status: 400 });
  return NextResponse.json(await previewExecutiveHandover(fromUserId, sp.get("toUserId") || null));
}

const bodySchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  reason: z.string().trim().min(3, "Шалтгаанаа бичнэ үү").max(500),
  clientRequestId: z.string().trim().min(8).max(100),
  expectedRequests: z.number().int().min(0),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });

  const result = await executeExecutiveHandover({ ...parsed.data, actorId: session.user.id });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true, duplicate: result.duplicate, summary: result.summary }, { status: result.duplicate ? 200 : 201 });
}
