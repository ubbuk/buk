import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { managerUpdateItemPrice } from "@/lib/workflow";
import { updateItemPriceSchema } from "@/lib/validation";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Зөвхөн Manager эрхтэй хэрэглэгч үнэ өөрчлөх боломжтой" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateItemPriceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id, itemId } = await params;
  const result = await managerUpdateItemPrice(id, itemId, session.user.id, parsed.data.unitPrice, parsed.data.expectedVersion);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.request);
}
