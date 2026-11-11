import { NextResponse } from "next/server";
import { addAttachments } from "@/lib/foreign-trade";
import { ftContext, ftRespond, readFiles, type IdParams } from "@/lib/foreign-trade-api";

// Files on the order (BOSS, while it is theirs to edit) or on a supplier quote (MANAGER, with quoteId).
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const quoteId = form.get("quoteId");
  const files = await readFiles(form.getAll("files"));
  const { id } = await params;
  return ftRespond(await addAttachments(ctx.actor, id, files, typeof quoteId === "string" && quoteId ? quoteId : undefined), 201);
}
