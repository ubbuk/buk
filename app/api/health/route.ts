import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Unauthenticated by design (a load balancer / orchestrator readiness probe
// has no session) — returns only up/down + latency, nothing about data or
// users, so it's safe to leave open.
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up", dbLatencyMs: Date.now() - startedAt });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
