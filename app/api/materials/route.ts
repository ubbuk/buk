import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cached, invalidate } from "@/lib/cache";
import { registerMaterial } from "@/lib/materials";
import { registerMaterialSchema } from "@/lib/validation";
import { withTiming } from "@/lib/api-timing";

const MATERIALS_CACHE_KEY = "materials:list";
// Catalog + balance data, shared identically across every user (not
// per-session), so a short shared TTL is safe — see lib/cache.ts. Balances
// change on every warehouse-check/inventory-post, so keep this short rather
// than relying solely on the two write paths below to invalidate it.
const MATERIALS_CACHE_TTL_MS = 5000;

export const GET = withTiming("GET /api/materials", async () => {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const payload = await cached(MATERIALS_CACHE_KEY, MATERIALS_CACHE_TTL_MS, async () => {
    const materials = await prisma.material.findMany({
      where: { isActive: true },
      include: { inventoryBalances: true },
      orderBy: { name: "asc" },
    });

    return materials.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      unit: m.unit,
      defaultPrice: Number(m.defaultPrice),
      warehouseBalance: m.inventoryBalances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0),
    }));
  });

  return NextResponse.json(payload);
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = registerMaterialSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const result = await registerMaterial(session.user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  invalidate(MATERIALS_CACHE_KEY);
  return NextResponse.json(result.data, { status: 201 });
}
