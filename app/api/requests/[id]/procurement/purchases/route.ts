import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { recordPurchase } from "@/lib/procurement";

const bodySchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  note: z.string().max(500).optional(),
  clientRequestId: z.string().min(8).max(100).optional(),
});

// Records one purchase of an outstanding item. MANAGER only, no PIN (Stage 7 is
// not an approval). Quantity is capped by the server at the remaining shortfall.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const result = await recordPurchase(id, session.user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ...result.detail, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
}
