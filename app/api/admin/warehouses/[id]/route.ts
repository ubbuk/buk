import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { announce, authorizeGrant, grantFailureResponse, type GrantContext } from "@/lib/authority-grant";
import { clientIp } from "@/lib/client-ip";
import { emitBroadcast, emitUserEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { assignWarehouseKeeper, keeperError } from "@/lib/warehouse-keeper-admin";

const bodySchema = z
  .object({
    // top-level warehouses only; null clears the keeper
    keeperId: z.string().nullable().optional(),
    // lower is reserved from first (lib/warehouse-allocation.ts)
    sortPriority: z.number().int().min(0).max(10000).optional(),
  })
  .refine((b) => b.keeperId !== undefined || b.sortPriority !== undefined);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });
  const { id } = await params;
  const warehouse = await prisma.warehouse.findUnique({ where: { id }, select: { id: true, keeperId: true, sortPriority: true } });
  if (!warehouse) return NextResponse.json({ error: "Агуулах олдсонгүй" }, { status: 404 });

  if (parsed.data.sortPriority !== undefined && parsed.data.sortPriority !== warehouse.sortPriority) {
    await prisma.$transaction([
      prisma.warehouse.update({ where: { id }, data: { sortPriority: parsed.data.sortPriority } }),
      prisma.auditLog.create({
        data: {
          entityType: "Warehouse",
          entityId: id,
          action: "UPDATE",
          actorId: session.user.id,
          beforeJson: JSON.stringify({ sortPriority: warehouse.sortPriority }),
          afterJson: JSON.stringify({ sortPriority: parsed.data.sortPriority }),
        },
      }),
    ]);
  }

  let repointed = 0;
  if (parsed.data.keeperId !== undefined) {
    // Only naming a different keeper grants authority; clearing it or repeating the current one does not.
    let grant: GrantContext | undefined;
    if (parsed.data.keeperId && parsed.data.keeperId !== warehouse.keeperId) {
      const candidate = await prisma.user.findUnique({ where: { id: parsed.data.keeperId }, select: { role: true, isActive: true } });
      const ineligible = keeperError(candidate);
      if (ineligible) return NextResponse.json({ error: ineligible }, { status: 400 });
      const authorised = await authorizeGrant({
        adminId: session.user.id,
        stepUp: {},
        kind: "WAREHOUSE_KEEPER",
        targetUserId: parsed.data.keeperId,
        ip: clientIp(req.headers),
        checkCustody: true,
      });
      if (!authorised.ok) return grantFailureResponse(authorised);
      grant = authorised.grant;
    }

    let result;
    try {
      result = await assignWarehouseKeeper(id, parsed.data.keeperId, session.user.id, grant);
    } catch (err) {
      if (!grant) throw err;
      // the record or a notification could not be written: the keeper was not changed
      console.error("[admin] warehouse keeper grant failed:", err instanceof Error ? err.name : "unknown");
      return NextResponse.json({ error: "Эрх олгох үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй, дахин оролдоно уу" }, { status: 500 });
    }
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    repointed = result.repointed;
    announce(result.notified);
    if (result.repointed > 0) {
      emitBroadcast({ type: "request-changed" });
      if (result.keeperId) emitUserEvent(result.keeperId, { type: "notification" });
    }
  }

  emitBroadcast({ type: "data-changed" });
  return NextResponse.json({ id, repointedRequests: repointed });
}
