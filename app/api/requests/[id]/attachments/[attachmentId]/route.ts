import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getAttachmentFile } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";
import { isRequestHiddenFrom, visibilitySelect } from "@/lib/request-visibility";

// Images and PDFs render inline (for preview); everything else downloads —
// matches how browsers already treat these MIME types, no override needed
// for the rest.
const INLINE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function contentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_");
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  // An attachment is as visible as the request it belongs to (same rule as
  // GET /api/requests/[id]): employees only get their own requests' files.
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const { id, attachmentId } = await params;
  const request = await prisma.materialRequest.findUnique({ where: { id }, select: visibilitySelect });
  if (!request || isRequestHiddenFrom(request, session.user.id, session.user.role)) {
    return NextResponse.json({ error: "Хавсралт олдсонгүй" }, { status: 404 });
  }

  const result = await getAttachmentFile(id, attachmentId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const disposition = INLINE_MIME_TYPES.has(result.data.mimeType) ? "inline" : "attachment";
  return new NextResponse(new Blob([new Uint8Array(result.data.data)]), {
    headers: {
      "Content-Type": result.data.mimeType,
      "Content-Disposition": contentDisposition(disposition, result.data.fileName),
      "Content-Length": String(result.data.data.byteLength),
      // Never cached by a shared/public cache -- this is a private,
      // authenticated resource.
      "Cache-Control": "private, no-store",
    },
  });
}
