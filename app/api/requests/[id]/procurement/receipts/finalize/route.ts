import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { uploadedRefsSchema } from "@/lib/attachment-schemas";
import { finalizeReceipts } from "@/lib/purchase-receipts";
import { RECEIPT_KINDS } from "@/lib/purchase-receipt-core";

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const bodySchema = z.object({
  itemId: z.string().min(1).nullable(),
  kind: z.enum(RECEIPT_KINDS),
  supplierName: text(200),
  receiptNumber: text(100),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  files: uploadedRefsSchema,
});

// Step 3: the files are in the bucket; check them and register them as receipts of the row / the whole purchase.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { id } = await params;
  const { itemId, files, ...meta } = parsed.data;
  const result = await finalizeReceipts(id, session.user.id, itemId, meta, files);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.receipts, { status: 201 });
}
