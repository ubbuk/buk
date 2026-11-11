import { NextResponse } from "next/server";
import { postMessage } from "@/lib/foreign-trade";
import { ftContext, ftRespond, readFiles, type IdParams } from "@/lib/foreign-trade-api";

// Discussion message (multipart: body, optional quoteId, files).
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const body = form.get("body");
  const quoteId = form.get("quoteId");
  const files = await readFiles(form.getAll("files"));
  const { id } = await params;
  return ftRespond(
    await postMessage(ctx.actor, id, { body: typeof body === "string" ? body : "", quoteId: typeof quoteId === "string" && quoteId ? quoteId : undefined }, files),
    201
  );
}
