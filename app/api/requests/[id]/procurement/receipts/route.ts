import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRequestHiddenFrom, visibilitySelect } from "@/lib/request-visibility";
import { getReceiptsOverview } from "@/lib/purchase-receipts";

// The purchase receipts of a request with the receipts-vs-purchases comparison. As visible as the request itself.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const { id } = await params;
  const request = await prisma.materialRequest.findUnique({ where: { id }, select: visibilitySelect });
  if (!request || isRequestHiddenFrom(request, session.user.id, session.user.role)) return NextResponse.json({ error: "Захиалга олдсонгүй" }, { status: 404 });
  const overview = await getReceiptsOverview(id, { id: session.user.id, role: session.user.role });
  if (!overview) return NextResponse.json({ error: "Захиалга олдсонгүй" }, { status: 404 });
  return NextResponse.json(overview, { headers: { "Cache-Control": "private, no-store" } });
}
