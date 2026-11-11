import { selectSupplier } from "@/lib/foreign-trade";
import { ftBody, ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { ftSelectionSchema } from "@/lib/foreign-trade-validation";

// MANAGER records the supplier agreed in the discussion and the grounds for it (audited).
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const body = await ftBody(req, ftSelectionSchema);
  if ("response" in body) return body.response;
  const { id } = await params;
  return ftRespond(await selectSupplier(ctx.actor, id, body.data.quoteId, body.data.rationale));
}
