import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { completeProcurement } from "@/lib/procurement";

// Completes Stage 7 and hands the request to the Chief Accountant. MANAGER only,
// no PIN. Completeness is re-verified on the server inside the transaction.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const { id } = await params;
  const result = await completeProcurement(id, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.detail);
}
