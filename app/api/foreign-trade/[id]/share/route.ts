import { shareResearch } from "@/lib/foreign-trade";
import { ftBody, ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { ftShareSchema } from "@/lib/foreign-trade-validation";

// MANAGER presents the price research to the BOSS and / or technical review (no approval implied).
export async function POST(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const body = await ftBody(req, ftShareSchema);
  if ("response" in body) return body.response;
  const { id } = await params;
  return ftRespond(await shareResearch(ctx.actor, id, body.data));
}
