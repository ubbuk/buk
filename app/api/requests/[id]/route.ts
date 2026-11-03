import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestInclude, serializeRequest } from "@/lib/serialize";
import { withTiming } from "@/lib/api-timing";

export const GET = withTiming(
  "GET /api/requests/[id]",
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

    const { id } = await params;
    const request = await prisma.materialRequest.findUnique({ where: { id }, include: requestInclude });
    if (!request) return NextResponse.json({ error: "Захиалга олдсонгүй" }, { status: 404 });

    return NextResponse.json(serializeRequest(request));
  }
);
