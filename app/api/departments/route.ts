import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/cache";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  // Department list + heads change rarely (admin-only, infrequent) but are
  // fetched on nearly every request/approval page render — shared, non-
  // sensitive, safe to cache briefly.
  const payload = await cached("departments:list", 30000, async () => {
    const departments = await prisma.department.findMany({
      include: { head: true },
      orderBy: { name: "asc" },
    });
    return departments.map((d) => ({ id: d.id, name: d.name, type: d.type, headId: d.headId, headName: d.head?.name ?? null }));
  });

  return NextResponse.json(payload);
}
