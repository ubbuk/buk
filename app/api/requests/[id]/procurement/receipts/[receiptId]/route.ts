import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { serveAttachment } from "@/lib/attachment-download";
import { prisma } from "@/lib/prisma";
import { isRequestHiddenFrom, visibilitySelect } from "@/lib/request-visibility";
import { getReceiptRef, removeReceipt } from "@/lib/purchase-receipts";

// A receipt file is as visible as its request (same rule as GET /api/requests/[id]). ?thumb=1 = the small preview.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const { id, receiptId } = await params;
  const request = await prisma.materialRequest.findUnique({ where: { id }, select: visibilitySelect });
  if (!request || isRequestHiddenFrom(request, session.user.id, session.user.role)) return NextResponse.json({ error: "Баримт олдсонгүй" }, { status: 404 });
  const result = await getReceiptRef(id, receiptId, new URL(req.url).searchParams.get("thumb") === "1");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return serveAttachment(result.ref);
}

// Remove (to replace): the uploader only, only while the request is in procurement.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const { id, receiptId } = await params;
  const result = await removeReceipt(id, receiptId, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
