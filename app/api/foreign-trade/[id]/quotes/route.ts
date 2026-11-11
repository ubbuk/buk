import { addQuote } from "@/lib/foreign-trade";
import { ftBody, ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { ftQuoteSchema } from "@/lib/foreign-trade-validation";

export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const body = await ftBody(req, ftQuoteSchema);
  if ("response" in body) return body.response;
  const { id } = await params;
  return ftRespond(await addQuote(ctx.actor, id, body.data), 201);
}
