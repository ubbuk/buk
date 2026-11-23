import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { completeProcurement } from "@/lib/procurement";

// Completes Stage 7 and hands the request to the Chief Accountant. MANAGER only,
// no PIN. Completeness is re-verified on the server inside the transaction.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const { id } = await params;
  // optional {noReceiptReason}: continue without a receipt for the rows that lack one, saying why
  const body = await req.json().catch(() => null);
  const noReceiptReason = typeof body?.noReceiptReason === "string" ? body.noReceiptReason : undefined;
  const result = await completeProcurement(id, session.user.id, { noReceiptReason });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code, missing: result.missing }, { status: result.status });
  return NextResponse.json(result.detail);
}
