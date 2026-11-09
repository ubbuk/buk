import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { executiveApprove } from "@/lib/workflow";
import { executiveApproveSchema } from "@/lib/validation";

// Initial executive decision. A body without `items` approves everything that
// needs buying (as before); with `items` it approves only those quantities and
// the rest stays deferred. The PIN is always required.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "DIRECTOR") {
    return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = executiveApproveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const result = await executiveApprove(id, session.user.id, parsed.data.pin, parsed.data.expectedVersion, {
    allocations: parsed.data.items,
    comment: parsed.data.comment,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.request);
}
