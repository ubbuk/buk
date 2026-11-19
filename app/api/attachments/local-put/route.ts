import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { readToken } from "@/lib/attachment-upload";
import { maxSizeFor } from "@/lib/attachment-rules";
import { storage } from "@/lib/storage";

// The local-disk stand-in for a bucket's presigned PUT URL (dev, tests, a self-hosted server): the same browser flow,
// the file just lands on disk. Not usable when a bucket is configured, because presignPut then never hands this URL out.
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const token = readToken(new URL(req.url).searchParams.get("token") ?? "");
  if (!token || token.u !== session.user.id) return NextResponse.json({ error: "Хүчингүй хүсэлт" }, { status: 403 });
  if ((req.headers.get("content-type") ?? "") !== token.m) return NextResponse.json({ error: "Хүчингүй файлын төрөл" }, { status: 400 });
  if ((await storage.presignPut(token.k, { contentType: token.m, expiresIn: 60 })) !== null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = Buffer.from(await req.arrayBuffer());
  if (data.byteLength > maxSizeFor(token.m) || data.byteLength === 0) return NextResponse.json({ error: "Файлын хэмжээ буруу байна" }, { status: 400 });
  await storage.put(token.k, data);
  return new NextResponse(null, { status: 200 });
}
