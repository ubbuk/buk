import { NextResponse } from "next/server";
import { createOrder, listOrders } from "@/lib/foreign-trade";
import { ftBody, ftContext, ftRespond } from "@/lib/foreign-trade-api";
import { ftCreateSchema } from "@/lib/foreign-trade-validation";

export async function GET(req: Request) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const url = new URL(req.url);
  const rows = await listOrders(ctx.actor, {
    q: url.searchParams.get("q")?.trim() || undefined,
    status: url.searchParams.get("status") || undefined,
    waiting: url.searchParams.get("waiting") === "1",
  });
  return NextResponse.json({ rows, role: ctx.actor.role });
}

export async function POST(req: Request) {
  const ctx = await ftContext();
  if ("response" in ctx) return ctx.response;
  const body = await ftBody(req, ftCreateSchema);
  if ("response" in body) return body.response;
  const { submit, ...input } = body.data;
  return ftRespond(await createOrder(ctx.actor, input, !!submit), 201);
}
