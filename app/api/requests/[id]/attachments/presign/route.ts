import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { presignAttachments } from "@/lib/attachments";
import { declaredFilesSchema } from "@/lib/attachment-schemas";

// Step 1 of a direct-to-bucket upload: the files are described, not sent.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const parsed = declaredFilesSchema.safeParse((await req.json().catch(() => null))?.files);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { id } = await params;
  const result = await presignAttachments(id, session.user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
