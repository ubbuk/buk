import { NextResponse } from "next/server";
import { z } from "zod";
import { postMessage } from "@/lib/foreign-trade";
import { ftContext, ftRespond, readFiles, type IdParams } from "@/lib/foreign-trade-api";
import { uploadedRefsSchema } from "@/lib/attachment-schemas";

const jsonSchema = z.object({ body: z.string().max(20000).default(""), quoteId: z.string().optional(), files: uploadedRefsSchema.optional() });

// Discussion message. The browser sends JSON (body, optional quoteId, files it already uploaded to the bucket);
// multipart (body, quoteId, files) remains for small files sent through the server.
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const { id } = await params;

  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const parsed = jsonSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
    const { body, quoteId, files } = parsed.data;
    return ftRespond(await postMessage(ctx.actor, id, { body, quoteId: quoteId || undefined }, [], files ?? []), 201);
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const body = form.get("body");
  const quoteId = form.get("quoteId");
  const files = await readFiles(form.getAll("files"));
  return ftRespond(
    await postMessage(ctx.actor, id, { body: typeof body === "string" ? body : "", quoteId: typeof quoteId === "string" && quoteId ? quoteId : undefined }, files),
    201
  );
}
