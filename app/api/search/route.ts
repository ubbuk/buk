import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withTiming } from "@/lib/api-timing";

const RESULT_LIMIT = 6;
const MIN_QUERY_LENGTH = 2;

// Global topbar search: matches requests (by number, department, note, and
// the requester's name -- so searching a person surfaces what they
// submitted) and the material catalog (by name/code/category). Plain
// case-insensitive `contains` works for any script (Cyrillic, Latin, ...)
// since Postgres compares by UTF-8 bytes, not a specific language's rules.
export const GET = withTiming("GET /api/search", async (req: Request) => {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ requests: [], materials: [] });
  }

  const [requests, materials] = await Promise.all([
    prisma.materialRequest.findMany({
      where: {
        OR: [
          { requestNumber: { contains: q, mode: "insensitive" } },
          { note: { contains: q, mode: "insensitive" } },
          { department: { name: { contains: q, mode: "insensitive" } } },
          { requestedBy: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: {
        id: true,
        requestNumber: true,
        status: true,
        department: { select: { name: true } },
        requestedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: RESULT_LIMIT,
    }),
    prisma.material.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { code: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, code: true, unit: true, category: true },
      orderBy: { name: "asc" },
      take: RESULT_LIMIT,
    }),
  ]);

  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      status: r.status,
      department: r.department.name,
      requestedBy: r.requestedBy.name,
    })),
    materials: materials.map((m) => ({
      id: m.id,
      name: m.name,
      code: m.code,
      unit: m.unit,
      category: m.category,
    })),
  });
});
