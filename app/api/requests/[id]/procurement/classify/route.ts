import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { classifyProcurement } from "@/lib/procurement";

const bodySchema = z.object({ internationalItemIds: z.array(z.string().min(1)).max(500) });

// Confirms which outstanding items are bought abroad; the rest become domestic.
// Only the configured International procurement manager may do it (checked
// against the admin-configured position inside the transaction, not just the
// MANAGER role). No PIN: this is coordination, not an approval.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const result = await classifyProcurement(id, session.user.id, parsed.data.internationalItemIds);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ...result.detail, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
}
