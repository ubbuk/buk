import { submitToTechnical } from "@/lib/foreign-trade";
import { ftBody, ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { ftVersionSchema } from "@/lib/foreign-trade-validation";

// MANAGER: price research done and supplier recorded -> technical review.
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const body = await ftBody(req, ftVersionSchema);
  if ("response" in body) return body.response;
  const { id } = await params;
  return ftRespond(await submitToTechnical(ctx.actor, id, body.data.expectedVersion));
}
