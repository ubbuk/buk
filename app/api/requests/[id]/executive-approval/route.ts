import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getApprovalSummary } from "@/lib/executive-approval";
import { isRequestHiddenFrom, visibilitySelect } from "@/lib/request-visibility";

// Approval summary + complete decision history of one request. Read-only, and
// exactly as visible as the request itself (same rule as GET /api/requests/[id]).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const { id } = await params;
  const visible = await prisma.materialRequest.findUnique({ where: { id }, select: visibilitySelect });
  if (!visible || isRequestHiddenFrom(visible, session.user.id, session.user.role)) {
    return NextResponse.json({ error: "Захиалга олдсонгүй" }, { status: 404 });
  }
  const summary = await getApprovalSummary(id, session.user.id, session.user.role);
  if (!summary) return NextResponse.json({ error: "Захиалга олдсонгүй" }, { status: 404 });
  return NextResponse.json(summary);
}
