import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { addAttachments, type IncomingFile } from "@/lib/attachments";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const { id } = await params;

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const files: IncomingFile[] = [];
  for (const entry of formData.getAll("files")) {
    if (!(entry instanceof File)) continue;
    const buffer = Buffer.from(await entry.arrayBuffer());
    files.push({
      fileName: entry.name || "file",
      mimeType: entry.type || "application/octet-stream",
      sizeBytes: buffer.byteLength,
      buffer,
    });
  }

  const result = await addAttachments(id, session.user.id, files);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 201 });
}
