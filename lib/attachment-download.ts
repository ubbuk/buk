import { NextResponse } from "next/server";
import { storage } from "./storage";

// Images and PDFs render inline (for preview); everything else downloads.
const INLINE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export function contentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const PRIVATE_HEADERS = {
  // A private, authenticated resource: never kept by a shared cache. nosniff: the browser must not second-guess the type.
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Serves one stored object after the caller has already checked the right to see it. With a bucket the answer is a
 * redirect to a 5-minute presigned URL (the bytes never pass through the app: Vercel answers are capped at 4.5 MB);
 * on a local disk the app streams the file itself.
 */
export async function serveAttachment(ref: { fileName: string; mimeType: string; key: string }): Promise<Response> {
  const disposition = contentDisposition(INLINE_MIME_TYPES.has(ref.mimeType) ? "inline" : "attachment", ref.fileName);
  const url = await storage.presignGet(ref.key, { contentType: ref.mimeType, disposition, expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  if (url) return NextResponse.redirect(url, { status: 302, headers: PRIVATE_HEADERS });

  const data = await storage.get(ref.key);
  if (!data) return NextResponse.json({ error: "Файл олдсонгүй" }, { status: 404 });
  return new NextResponse(new Blob([new Uint8Array(data)]), {
    headers: { ...PRIVATE_HEADERS, "Content-Type": ref.mimeType, "Content-Disposition": disposition, "Content-Length": String(data.byteLength) },
  });
}
