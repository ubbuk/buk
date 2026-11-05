import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { reassignItem } from "@/lib/procurement";

const bodySchema = z.object({ kind: z.enum(["DOMESTIC", "INTERNATIONAL"]), reason: z.string().trim().min(1).max(500) });

// Controlled change of an item's classification / responsible manager after
// confirmation: International manager only, reason required, audited. Refused
// while the current responsible manager still holds purchase records for it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Шалтгаанаа бичнэ үү" }, { status: 400 });

  const { id, itemId } = await params;
  const result = await reassignItem(id, session.user.id, itemId, parsed.data.kind, parsed.data.reason);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.detail);
}
