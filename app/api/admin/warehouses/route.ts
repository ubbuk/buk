import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { getKeeperMode } from "@/lib/warehouse-settings";

// Admin screen data: the step-2 keeper mode, every warehouse with its keeper and priority, and who can be a keeper.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const [mode, warehouses, storekeepers] = await Promise.all([
    getKeeperMode(),
    prisma.warehouse.findMany({
      include: { keeper: { select: { name: true } } },
      orderBy: [{ sortPriority: "asc" }, { name: "asc" }],
    }),
    prisma.user.findMany({ where: { role: "STOREKEEPER", isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return NextResponse.json({
    mode,
    storekeepers,
    warehouses: warehouses.map((w) => ({
      id: w.id,
      name: w.name,
      parentId: w.parentId,
      keeperId: w.keeperId,
      keeperName: w.keeper?.name ?? null,
      sortPriority: w.sortPriority,
      onecCode: w.onecCode,
      isActive: w.isActive,
    })),
  });
}
