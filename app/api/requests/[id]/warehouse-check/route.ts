import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { warehouseCheck } from "@/lib/workflow";

const bodySchema = z.object({
  items: z.array(z.object({ requestItemId: z.string().min(1), availableQuantity: z.number().min(0) })),
  pin: z.string().regex(/^\d{4}$/, "PIN дөрөв оронтой тоо байх ёстой"),
  expectedVersion: z.number().int(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "STOREKEEPER") {
    return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const result = await warehouseCheck(
    id,
    session.user.id,
    parsed.data.items,
    parsed.data.pin,
    parsed.data.expectedVersion
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.request);
}
