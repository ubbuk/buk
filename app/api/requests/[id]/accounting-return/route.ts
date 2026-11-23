import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { returnToProcurement } from "@/lib/purchase-receipts";

const bodySchema = z.object({ reason: z.string() });

// The Chief Accountant sends the request back to the Manager (procurement) with a reason, e.g. a missing or wrong receipt.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "CHIEF_ACCOUNTANT") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { id } = await params;
  const result = await returnToProcurement(id, session.user.id, parsed.data.reason);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
