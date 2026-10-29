import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestInclude, serializeRequest } from "@/lib/serialize";
import { apiCreateRequestSchema } from "@/lib/validation";

const REQUEST_YEAR = 2026;
const START_SEQUENCE = 1372;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const requests = await prisma.materialRequest.findMany({
    include: requestInclude,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests.map(serializeRequest));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = apiCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Хүчингүй өгөгдөл", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const department = await prisma.department.findUnique({ where: { id: input.departmentId } });
  if (!department) {
    return NextResponse.json({ error: "Цех, тасаг олдсонгүй" }, { status: 400 });
  }
  if (!department.headId) {
    return NextResponse.json(
      { error: "Энэ цэхийн дарга тохируулагдаагүй байна. Тохиргоо хуудаснаас тохируулна уу." },
      { status: 400 }
    );
  }

  const warehouseClerk = await prisma.user.findFirst({ where: { role: "WAREHOUSE_CLERK", isActive: true } });
  if (!warehouseClerk) {
    return NextResponse.json({ error: "Идэвхтэй нярав тохируулагдаагүй байна" }, { status: 400 });
  }

  const routeApproverRole = input.route === "FACTORY" ? "FACTORY_APPROVER" : "OFFICE_APPROVER";
  const routeApproverAssignment = await prisma.approvalRoleAssignment.findFirst({
    where: { role: routeApproverRole, isActive: true },
  });
  const directorAssignment = await prisma.approvalRoleAssignment.findFirst({
    where: { role: "DIRECTOR", isActive: true },
  });
  if (!routeApproverAssignment || !directorAssignment) {
    return NextResponse.json(
      { error: "Баталгаажуулах эрхийн хуваарилалт бүрэн бус байна. Тохиргоо хуудаснаас шалгана уу." },
      { status: 400 }
    );
  }

 
  const resolvedItems: {
    materialId: string | null;
    manualMaterialName: string | null;
    unit: string;
    requestedQuantity: Prisma.Decimal;
    warehouseBalanceAtRequest: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal;
    totalPrice: Prisma.Decimal;
    note: string | undefined;
  }[] = [];
  for (const item of input.items) {
    let warehouseBalanceAtRequest: number | null = null;
    let materialId: string | null = null;

    if (item.materialId) {
      const material = await prisma.material.findUnique({
        where: { id: item.materialId },
        include: { inventoryBalances: true },
      });
      if (!material) {
        return NextResponse.json({ error: `Материал олдсонгүй: ${item.materialName}` }, { status: 400 });
      }
      materialId = material.id;
      warehouseBalanceAtRequest = material.inventoryBalances.reduce((s, b) => s + Number(b.quantityOnHand), 0);
    }

    resolvedItems.push({
      materialId,
      manualMaterialName: materialId ? null : item.materialName,
      unit: item.unit,
      requestedQuantity: new Prisma.Decimal(item.requestedQuantity),
      warehouseBalanceAtRequest:
        warehouseBalanceAtRequest === null ? null : new Prisma.Decimal(warehouseBalanceAtRequest),
      unitPrice: new Prisma.Decimal(item.unitPrice),
      totalPrice: new Prisma.Decimal(item.requestedQuantity * item.unitPrice),
      note: item.note,
    });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await prisma.materialRequest.count({ where: { year: REQUEST_YEAR } });
    const sequence = START_SEQUENCE + count;
    const requestNumber = `${REQUEST_YEAR}-${sequence}`;

    try {
      const created = await prisma.$transaction(async (tx) => {
        const request = await tx.materialRequest.create({
          data: {
            requestNumber,
            year: REQUEST_YEAR,
            sequence,
            departmentId: input.departmentId,
            requestedById: session.user.id,
            route: input.route,
            status: "PENDING_DEPARTMENT_APPROVAL",
            note: input.note,
            submittedAt: new Date(),
            items: { create: resolvedItems.map((it, i) => ({ ...it, lineNo: i + 1 })) },
            approvalSteps: {
              create: [
                { type: "DEPARTMENT_HEAD", sequence: 1, status: "PENDING", assignedUserId: department.headId },
                { type: "WAREHOUSE_CHECK", sequence: 2, status: "PENDING", assignedUserId: warehouseClerk.id },
                {
                  type: "ROUTE_APPROVAL",
                  sequence: 3,
                  status: "PENDING",
                  assignedUserId: routeApproverAssignment.userId,
                },
                { type: "DIRECTOR_APPROVAL", sequence: 4, status: "PENDING", assignedUserId: directorAssignment.userId },
              ],
            },
          },
          include: requestInclude,
        });

        await tx.auditLog.create({
          data: {
            entityType: "MaterialRequest",
            entityId: request.id,
            action: "SUBMIT",
            actorId: session.user.id,
          },
        });

        await tx.notification.create({
          data: {
            userId: department.headId!,
            type: "APPROVAL_REQUIRED",
            title: "Шинэ захиалга баталгаажуулах шаардлагатай",
            body: `№${requestNumber} захиалгыг хянана уу`,
            relatedRequestId: request.id,
          },
        });

        return request;
      });

      return NextResponse.json(serializeRequest(created), { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue; // requestNumber collision — retry with a fresh count
      }
      throw err;
    }
  }

  return NextResponse.json({ error: "Захиалгын дугаар үүсгэхэд алдаа гарлаа" }, { status: 500 });
}
