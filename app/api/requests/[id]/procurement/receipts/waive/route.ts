import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { waiveReceipt } from "@/lib/purchase-receipts";

const bodySchema = z.object({ itemId: z.string().min(1), reason: z.string() });

// "No receipt - why" for one purchased row (audited, shown to the Chief Accountant in red). MANAGER only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { id } = await params;
  const result = await waiveReceipt(id, session.user.id, parsed.data.itemId, parsed.data.reason);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
