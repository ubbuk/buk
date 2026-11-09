import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { decideAdditionalApproval } from "@/lib/executive-approval";
import { executiveDecisionSchema } from "@/lib/validation";

// Subsequent executive decision: approve additional quantities (PIN required) or
// return a procurement officer's request with a reason. Only the request's own
// executive director passes the server-side check in the service.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "DIRECTOR") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = executiveDecisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const result = await decideAdditionalApproval(id, session.user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ...result.summary, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
}
