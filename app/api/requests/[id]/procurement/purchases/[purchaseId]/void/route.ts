import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { voidPurchase } from "@/lib/procurement";

const bodySchema = z.object({ reason: z.string().trim().min(1).max(500) });

// Voids a purchase (the row is kept with who/when/why). MANAGER only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; purchaseId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Шалтгаанаа бичнэ үү" }, { status: 400 });

  const { id, purchaseId } = await params;
  const result = await voidPurchase(id, session.user.id, purchaseId, parsed.data.reason);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.detail);
}
