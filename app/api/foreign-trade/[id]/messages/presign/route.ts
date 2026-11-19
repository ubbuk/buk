import { NextResponse } from "next/server";
import { presignMessageFiles } from "@/lib/foreign-trade";
import { ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { declaredFilesSchema } from "@/lib/attachment-schemas";

// Step 1 of a direct-to-bucket upload for a discussion message's files.
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const files = declaredFilesSchema.safeParse((await req.json().catch(() => null))?.files);
  if (!files.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { id } = await params;
  return ftRespond(await presignMessageFiles(ctx.actor, id, files.data));
}
