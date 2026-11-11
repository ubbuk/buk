import { deleteQuote, updateQuote } from "@/lib/foreign-trade";
import { ftBody, ftContext, ftRespond } from "@/lib/foreign-trade-api";
import { ftQuoteSchema } from "@/lib/foreign-trade-validation";

type Params = { params: Promise<{ id: string; quoteId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const body = await ftBody(req, ftQuoteSchema);
  if ("response" in body) return body.response;
  const { id, quoteId } = await params;
  return ftRespond(await updateQuote(ctx.actor, id, quoteId, body.data));
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const { id, quoteId } = await params;
  return ftRespond(await deleteQuote(ctx.actor, id, quoteId));
}
