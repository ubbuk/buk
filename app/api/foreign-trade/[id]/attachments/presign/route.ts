import { NextResponse } from "next/server";
import { presignAttachments } from "@/lib/foreign-trade";
import { ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { declaredFilesSchema } from "@/lib/attachment-schemas";

// Step 1 of a direct-to-bucket upload for the order or (with quoteId) a supplier quote.
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const raw = await req.json().catch(() => null);
  const files = declaredFilesSchema.safeParse(raw?.files);
  if (!files.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { id } = await params;
  return ftRespond(await presignAttachments(ctx.actor, id, files.data, typeof raw?.quoteId === "string" && raw.quoteId ? raw.quoteId : undefined));
}
