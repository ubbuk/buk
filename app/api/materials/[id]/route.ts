import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const { id } = await params;
  const material = await prisma.material.findUnique({
    where: { id },
    include: { inventoryBalances: { include: { warehouse: true } } },
  });
  if (!material) return NextResponse.json({ error: "Материал олдсонгүй" }, { status: 404 });

  return NextResponse.json({
    id: material.id,
    code: material.code,
    name: material.name,
    unit: material.unit,
    category: material.category,
    defaultPrice: Number(material.defaultPrice),
    isActive: material.isActive,
    warehouseBalance: material.inventoryBalances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0),
    balancesByWarehouse: material.inventoryBalances.map((b) => ({
      warehouseId: b.warehouseId,
      warehouseName: b.warehouse.name,
      quantityOnHand: Number(b.quantityOnHand),
      quantityReserved: Number(b.quantityReserved),
    })),
  });
}
