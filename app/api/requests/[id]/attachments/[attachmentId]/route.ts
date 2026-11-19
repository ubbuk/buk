import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getAttachmentRef } from "@/lib/attachments";
import { serveAttachment } from "@/lib/attachment-download";
import { prisma } from "@/lib/prisma";
import { isRequestHiddenFrom, visibilitySelect } from "@/lib/request-visibility";

// ?thumb=1 answers with the ~300px preview when the attachment has one.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  // An attachment is as visible as the request it belongs to (same rule as
  // GET /api/requests/[id]): employees only get their own requests' files.
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const { id, attachmentId } = await params;
  const request = await prisma.materialRequest.findUnique({ where: { id }, select: visibilitySelect });
  if (!request || isRequestHiddenFrom(request, session.user.id, session.user.role)) {
    return NextResponse.json({ error: "Хавсралт олдсонгүй" }, { status: 404 });
  }

  const ref = await getAttachmentRef(id, attachmentId, new URL(req.url).searchParams.get("thumb") === "1");
  if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: ref.status });
  return serveAttachment(ref.data);
}
