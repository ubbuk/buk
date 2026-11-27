import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRequestHiddenFrom } from "@/lib/request-visibility";
import { requestInclude, serializeRequest } from "@/lib/serialize";
import { withTiming } from "@/lib/api-timing";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { clientIp } from "@/lib/client-ip";
import { verifyPin } from "@/lib/pin";
import { FINANCE_BLOCK_MESSAGE, deleteRequest, describeDeletion } from "@/lib/request-delete";

export const GET = withTiming(
  "GET /api/requests/[id]",
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

    const { id } = await params;
    const request = await prisma.materialRequest.findUnique({ where: { id }, include: requestInclude });
    if (!request || isRequestHiddenFrom(request, session.user.id, session.user.role)) {
      return NextResponse.json({ error: "Захиалга олдсонгүй" }, { status: 404 });
    }

    return NextResponse.json(serializeRequest(request));
  }
);

const deleteSchema = z.object({ confirmName: z.string().min(1).max(100), pin: z.string().min(1).max(32) });

/** Захиалгыг бүрэн устгах: ЗӨВХӨН ADMIN, захиалгын дугаарыг гараар бичиж баталгаажуулах + PIN. Санхүүд бүртгэгдсэн бол 409. */
export const DELETE = withTiming(
  "DELETE /api/requests/[id]",
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
    if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

    const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Захиалгын нэр болон PIN-ээ оруулна уу" }, { status: 400 });

    const { id } = await params;
    const summary = await describeDeletion(id);
    if (!summary) return NextResponse.json({ error: "Захиалга олдсонгүй" }, { status: 404 });
    if (summary.financeRecorded) return NextResponse.json({ error: FINANCE_BLOCK_MESSAGE }, { status: 409 });
    // Нэрийг PIN-ээс ӨМНӨ шалгана: буруу нэр PIN-ий оролдлогын хязгаарыг үрэхгүй
    if (parsed.data.confirmName.trim() !== summary.requestNumber) {
      return NextResponse.json({ error: "Захиалгын нэр таарахгүй байна" }, { status: 400 });
    }
    const pin = await verifyPin(session.user.id, parsed.data.pin);
    if (!pin.ok) return NextResponse.json({ error: pin.error }, { status: pin.status });

    const result = await deleteRequest(id, { id: session.user.id, ipAddress: clientIp(req.headers) });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ deleted: true, requestNumber: result.summary.requestNumber, storageFailed: result.storageFailed.length });
  }
);
