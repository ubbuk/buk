import { NextResponse } from "next/server";
import { getAttachmentRef } from "@/lib/foreign-trade";
import { serveAttachment } from "@/lib/attachment-download";
import { ftContext } from "@/lib/foreign-trade-api";

// A file is as visible as the part of the order it belongs to (order / price research / discussion).
// ?thumb=1 answers with the ~300px preview when the attachment has one.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const { id, attachmentId } = await params;
  const result = await getAttachmentRef(ctx.actor, id, attachmentId, new URL(req.url).searchParams.get("thumb") === "1");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return serveAttachment(result.data);
}
