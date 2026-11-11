import { NextResponse } from "next/server";
import { getAttachmentFile } from "@/lib/foreign-trade";
import { ftContext } from "@/lib/foreign-trade-api";

const INLINE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function contentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_");
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// A file is as visible as the part of the order it belongs to (order / price research / discussion).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const { id, attachmentId } = await params;
  const result = await getAttachmentFile(ctx.actor, id, attachmentId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { fileName, mimeType, data } = result.data;
  return new NextResponse(new Blob([new Uint8Array(data)]), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": contentDisposition(INLINE_MIME_TYPES.has(mimeType) ? "inline" : "attachment", fileName),
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
