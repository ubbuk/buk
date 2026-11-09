import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createDeferredRequest, getApprovalSummary } from "@/lib/executive-approval";
import { isRequestHiddenFrom, visibilitySelect } from "@/lib/request-visibility";
import { deferredRequestSchema } from "@/lib/validation";

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
  return NextResponse.json({ pending: summary.pendingRequest, requests: summary.deferredRequests });
}

// A procurement officer (MANAGER) asks the executive director for more authorised
// quantity. It grants nothing; only an executive decision does.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = deferredRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const result = await createDeferredRequest(id, session.user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ...result.summary, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
}
