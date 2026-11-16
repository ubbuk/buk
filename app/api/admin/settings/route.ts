import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { emitBroadcast } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { KEEPER_MODES, setKeeperMode } from "@/lib/warehouse-settings";

const bodySchema = z.object({ keeperMode: z.enum(KEEPER_MODES) });

// Switches who gets step 2 of NEW requests. Requests already in flight keep the assignee they were created with.
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const result = await prisma.$transaction((tx) => setKeeperMode(tx, parsed.data.keeperMode, session.user.id));
  if (result.changed) emitBroadcast({ type: "data-changed" });
  return NextResponse.json({ keeperMode: parsed.data.keeperMode, changed: result.changed });
}
