import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/cache";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  // No route mutates warehouses today, so a longer TTL is safe.
  const payload = await cached("warehouses:list", 60000, async () => {
    const warehouses = await prisma.warehouse.findMany({ orderBy: { name: "asc" } });
    return warehouses.map((w) => ({ id: w.id, name: w.name, location: w.location }));
  });

  return NextResponse.json(payload);
}
