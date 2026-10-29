import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const materials = await prisma.material.findMany({
    where: { isActive: true },
    include: { inventoryBalances: true },
    orderBy: { name: "asc" },
  });

  const payload = materials.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    unit: m.unit,
    defaultPrice: Number(m.defaultPrice),
    warehouseBalance: m.inventoryBalances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0),
  }));

  return NextResponse.json(payload);
}
