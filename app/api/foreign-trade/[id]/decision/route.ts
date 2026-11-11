import { decide } from "@/lib/foreign-trade";
import { ftBody, ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { ftDecisionSchema } from "@/lib/foreign-trade-validation";

// One decision of the current stage (technical OR / finance director / executive director). APPROVE needs the PIN, RETURN a reason; who may decide is checked in lib/foreign-trade.ts.
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const body = await ftBody(req, ftDecisionSchema);
  if ("response" in body) return body.response;
  const { id } = await params;
  return ftRespond(await decide(ctx.actor, id, body.data));
}
