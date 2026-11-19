import { NextResponse } from "next/server";
import { finalizeAttachments } from "@/lib/foreign-trade";
import { ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { uploadedRefsSchema } from "@/lib/attachment-schemas";

// Step 3: verify what the browser uploaded to the bucket and register it on the order or quote.
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const raw = await req.json().catch(() => null);
  const files = uploadedRefsSchema.safeParse(raw?.files);
  if (!files.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { id } = await params;
  return ftRespond(await finalizeAttachments(ctx.actor, id, files.data, typeof raw?.quoteId === "string" && raw.quoteId ? raw.quoteId : undefined), 201);
}
