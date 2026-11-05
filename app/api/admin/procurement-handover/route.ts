import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { executeHandover, isProcurementPosition, previewHandover } from "@/lib/procurement-handover";

export const dynamic = "force-dynamic";

// ADMIN only. GET = read-only preview of the unfinished work a handover would move;
// POST = the explicit, reasoned confirmation that replaces the holder (if different)
// and transfers that work atomically. Nothing here runs implicitly.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const position = sp.get("position") ?? "";
  if (!isProcurementPosition(position)) return NextResponse.json({ error: "Хүчингүй албан тушаал" }, { status: 400 });
  return NextResponse.json(await previewHandover(position, sp.get("newManagerId") || null));
}

const bodySchema = z.object({
  position: z.string().refine(isProcurementPosition),
  newManagerId: z.string().min(1),
  reason: z.string().trim().min(3, "Шалтгаанаа бичнэ үү").max(500),
  clientRequestId: z.string().trim().min(8).max(100),
  expectedItems: z.number().int().min(0),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });

  const result = await executeHandover({
    position: parsed.data.position as Parameters<typeof previewHandover>[0],
    newManagerId: parsed.data.newManagerId,
    actorId: session.user.id,
    reason: parsed.data.reason,
    clientRequestId: parsed.data.clientRequestId,
    expectedItems: parsed.data.expectedItems,
  });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true, duplicate: result.duplicate, summary: result.summary }, { status: result.duplicate ? 200 : 201 });
}
