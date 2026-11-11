import { NextResponse } from "next/server";
import { getOrder, updateOrder } from "@/lib/foreign-trade";
import { ftBody, ftContext, ftRespond, type IdParams } from "@/lib/foreign-trade-api";
import { ftUpdateSchema } from "@/lib/foreign-trade-validation";

export async function GET(_req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const { id } = await params;
  const order = await getOrder(ctx.actor, id);
  if (!order) return NextResponse.json({ error: "Захиалга олдсонгүй" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(req: Request, { params }: IdParams) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const body = await ftBody(req, ftUpdateSchema);
  if ("response" in body) return body.response;
  const { expectedVersion, ...input } = body.data;
  const { id } = await params;
  return ftRespond(await updateOrder(ctx.actor, id, input, expectedVersion));
}
