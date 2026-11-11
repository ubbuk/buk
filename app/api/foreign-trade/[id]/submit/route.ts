import { submitOrder } from "@/lib/foreign-trade";
import { ftBody, ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { ftVersionSchema } from "@/lib/foreign-trade-validation";

// BOSS: DRAFT or RETURNED_TO_BOSS -> PENDING_MANAGER.
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const body = await ftBody(req, ftVersionSchema);
  if ("response" in body) return body.response;
  const { id } = await params;
  return ftRespond(await submitOrder(ctx.actor, id, body.data.expectedVersion));
}
