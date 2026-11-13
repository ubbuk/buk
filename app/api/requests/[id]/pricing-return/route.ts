import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { managerPricingReturn } from "@/lib/workflow";
import { returnDecisionSchema } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = returnDecisionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Буцаах шалтгаанаа бичнэ үү" }, { status: 400 });

  const { id } = await params;
  const result = await managerPricingReturn(id, session.user.id, parsed.data.reason, parsed.data.expectedVersion);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.request);
}
