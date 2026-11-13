import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resubmitDepartmentReturn, resubmitPositionStepReturn } from "@/lib/workflow";
import { resubmitDepartmentSchema, resubmitPositionStepSchema } from "@/lib/validation";

const POSITION_RETURN_STATUSES = ["RETURNED_BY_BRANCH_APPROVER", "RETURNED_BY_MANAGER_PRICING", "RETURNED_BY_FINANCE", "RETURNED_BY_EXECUTIVE"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const { id } = await params;
  const request = await prisma.materialRequest.findUnique({ where: { id }, select: { status: true } });
  if (!request) return NextResponse.json({ error: "Захиалга олдсонгүй" }, { status: 404 });

  const body = await req.json().catch(() => null);

  if (request.status === "RETURNED_BY_DEPARTMENT") {
    const parsed = resubmitDepartmentSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

    const result = await resubmitDepartmentReturn(
      id,
      session.user.id,
      parsed.data.expectedVersion,
      parsed.data.items.map((item) => ({ ...item, materialId: item.materialId ?? null, unitPrice: item.unitPrice ?? null })),
      parsed.data.note
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.request);
  }

  if (POSITION_RETURN_STATUSES.includes(request.status)) {
    const parsed = resubmitPositionStepSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

    const result = await resubmitPositionStepReturn(id, session.user.id, parsed.data.expectedVersion, parsed.data.adjustments);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.request);
  }

  return NextResponse.json({ error: "Энэ захиалга дахин илгээх боломжгүй төлөвт байна" }, { status: 409 });
}
