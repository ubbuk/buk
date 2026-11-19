import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { finalizeAttachments } from "@/lib/attachments";
import { uploadedRefsSchema } from "@/lib/attachment-schemas";

// Step 3: the browser has PUT the files to the bucket; the server checks them there and registers them.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const parsed = uploadedRefsSchema.safeParse((await req.json().catch(() => null))?.files);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { id } = await params;
  const result = await finalizeAttachments(id, session.user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 201 });
}
