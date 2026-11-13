import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateRequestForDepartment, departmentHeadError } from "@/lib/department-access";
import { isRequestHiddenFrom, requestScopeWhere } from "@/lib/request-visibility";
import { requestInclude, requestListSelect, serializeRequest } from "@/lib/serialize";
import { apiCreateRequestSchema } from "@/lib/validation";
import { emitBroadcast, emitUserEvent } from "@/lib/events";
import { withTiming } from "@/lib/api-timing";

const REQUEST_YEAR = 2026;
const START_SEQUENCE = 1372;

const STREAM_YIELD_EVERY = 100;

export const GET = withTiming("GET /api/requests", async () => {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  // requestScopeWhere is the coarse DB-side cut of isRequestHiddenFrom (covered by security.test.ts), so
  // EMPLOYEE / BOSS stop loading every request in the company; the exact check below still decides.
  const all = await prisma.materialRequest.findMany({
    where: requestScopeWhere(session.user.id, session.user.role),
    select: requestListSelect,
    orderBy: { createdAt: "desc" },
  });
  const requests = all.filter((r) => !isRequestHiddenFrom(r, session.user.id, session.user.role));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode("["));
      for (let i = 0; i < requests.length; i++) {
        const prefix = i > 0 ? "," : "";
        controller.enqueue(encoder.encode(prefix + JSON.stringify(serializeRequest(requests[i]))));
        if (i % STREAM_YIELD_EVERY === STREAM_YIELD_EVERY - 1) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      controller.enqueue(encoder.encode("]"));
      controller.close();
    },
  });

  return new NextResponse(stream, { headers: { "Content-Type": "application/json" } });
});

export const POST = withTiming("POST /api/requests", async (req: Request) => {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = apiCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Хүчингүй өгөгдөл", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  // The requester files for their own department; ADMIN is the only exception.
  // Checked before the department lookup so a foreign id can't be probed.
  if (!canCreateRequestForDepartment(session.user, input.departmentId)) {
    return NextResponse.json({ error: "Та зөвхөн өөрийн цех, тасгийн нэрийн өмнөөс захиалга үүсгэх боломжтой" }, { status: 403 });
  }

  const department = await prisma.department.findUnique({
    where: { id: input.departmentId },
    include: { head: { select: { role: true, isActive: true } } },
  });
  if (!department) {
    return NextResponse.json({ error: "Цех, тасаг олдсонгүй" }, { status: 400 });
  }
  if (!department.headId) {
    return NextResponse.json(
      { error: "Энэ цэхийн дарга тохируулагдаагүй байна. Тохиргоо хуудаснаас тохируулна уу." },
      { status: 400 }
    );
  }
  // A head who was deactivated or demoted after being appointed can't approve,
  // so don't start a request that would sit unactionable.
  if (departmentHeadError(department.head)) {
    return NextResponse.json(
      { error: "Энэ цэхийн даргын эрх хүчингүй болсон байна. Админаар шинэ дарга томилуулна уу." },
      { status: 400 }
    );
  }

  // Stage 4's branch (ENGINEERING for a FACTORY department, OPERATIONS_DIRECTOR
  // for an OFFICE one) is resolved from the department's own classification —
  // there is no requester-chosen route field anymore.
  const branchPosition = department.type === "FACTORY" ? "ENGINEERING_CHIEF" : "OPERATIONS_DIRECTOR";
  const [branchAssignment, financeAssignment, executiveAssignment, storekeeperAssignment, accountantAssignment] =
    await Promise.all([
      prisma.approvalRoleAssignment.findFirst({ where: { role: branchPosition, isActive: true } }),
      prisma.approvalRoleAssignment.findFirst({ where: { role: "FINANCE_DIRECTOR", isActive: true } }),
      prisma.approvalRoleAssignment.findFirst({ where: { role: "EXECUTIVE_DIRECTOR", isActive: true } }),
      prisma.approvalRoleAssignment.findFirst({ where: { role: "STOREKEEPER_LEAD", isActive: true } }),
      prisma.approvalRoleAssignment.findFirst({ where: { role: "CHIEF_ACCOUNTANT_LEAD", isActive: true } }),
    ]);

  if (!branchAssignment || !financeAssignment || !executiveAssignment || !storekeeperAssignment || !accountantAssignment) {
    return NextResponse.json(
      { error: "Баталгаажуулах албан тушаалын хуваарилалт бүрэн бус байна. Админ хуудаснаас шалгана уу." },
      { status: 400 }
    );
  }

  const requestedMaterialIds = [...new Set(input.items.map((item) => item.materialId).filter((id): id is string => !!id))];
  const materials = requestedMaterialIds.length
    ? await prisma.material.findMany({
        where: { id: { in: requestedMaterialIds } },
        include: { inventoryBalances: true },
      })
    : [];
  const materialsById = new Map(materials.map((m) => [m.id, m]));

  const resolvedItems: {
    materialId: string | null;
    manualMaterialName: string | null;
    unit: string;
    requestedQuantity: Prisma.Decimal;
    warehouseBalanceAtRequest: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal | null;
    totalPrice: Prisma.Decimal | null;
    note: string | undefined;
  }[] = [];
  for (const item of input.items) {
    let warehouseBalanceAtRequest: number | null = null;
    let materialId: string | null = null;
    let materialNameAtRequest = item.materialName;

    if (item.materialId) {
      const material = materialsById.get(item.materialId);
      if (!material) {
        return NextResponse.json({ error: `Материал олдсонгүй: ${item.materialName}` }, { status: 400 });
      }
      materialId = material.id;
      materialNameAtRequest = material.name;
      warehouseBalanceAtRequest = material.inventoryBalances.reduce((s, b) => s + Number(b.quantityOnHand), 0);
    }

    // unitPrice is optional: a request can be submitted with no price and
    // priced in later by MANAGER. null/undefined stays null end to end
    // (never coerced to 0) so "no price yet" and "price is 0" stay
    // distinguishable in the database and in the document hash.
    const hasPrice = item.unitPrice !== null && item.unitPrice !== undefined;
    resolvedItems.push({
      materialId,
      // Snapshot the name as it was at the moment of ordering -- a later
      // rename of the catalog material must never retroactively change
      // what an old request appears to have been for.
      manualMaterialName: materialNameAtRequest,
      unit: item.unit,
      requestedQuantity: new Prisma.Decimal(item.requestedQuantity),
      warehouseBalanceAtRequest:
        warehouseBalanceAtRequest === null ? null : new Prisma.Decimal(warehouseBalanceAtRequest),
      unitPrice: hasPrice ? new Prisma.Decimal(item.unitPrice as number) : null,
      totalPrice: hasPrice ? new Prisma.Decimal(item.requestedQuantity * (item.unitPrice as number)) : null,
      note: item.note,
    });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`material-request-seq:${REQUEST_YEAR}`}))`;
        const count = await tx.materialRequest.count({ where: { year: REQUEST_YEAR } });
        const sequence = START_SEQUENCE + count;
        const requestNumber = `${REQUEST_YEAR}-${sequence}`;

        const request = await tx.materialRequest.create({
          data: {
            requestNumber,
            year: REQUEST_YEAR,
            sequence,
            departmentId: input.departmentId,
            requestedById: session.user.id,
            status: "PENDING_DEPARTMENT_APPROVAL",
            note: input.note,
            submittedAt: new Date(),
            items: { create: resolvedItems.map((it, i) => ({ ...it, lineNo: i + 1 })) },
            approvalSteps: {
              create: [
                { type: "DEPARTMENT_HEAD", sequence: 1, status: "PENDING", assignedUserId: department.headId },
                { type: "WAREHOUSE_CHECK", sequence: 2, status: "PENDING", assignedUserId: storekeeperAssignment.userId },
                { type: "BRANCH_APPROVAL", sequence: 3, status: "PENDING", assignedUserId: branchAssignment.userId },
                // Price review: any active MANAGER enters the unit prices of the shortfall (no single assignee).
                { type: "MANAGER_PRICING", sequence: 4, status: "PENDING", assignedUserId: null },
                { type: "FINANCE_APPROVAL", sequence: 5, status: "PENDING", assignedUserId: financeAssignment.userId },
                { type: "EXECUTIVE_APPROVAL", sequence: 6, status: "PENDING", assignedUserId: executiveAssignment.userId },
                // Stage 7: any active MANAGER buys the shortfall (no single assignee), then Stage 8 registers it.
                { type: "MANAGER_PROCUREMENT", sequence: 7, status: "PENDING", assignedUserId: null },
                { type: "ACCOUNTING_RECORD", sequence: 8, status: "PENDING", assignedUserId: accountantAssignment.userId },
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

      emitBroadcast({ type: "request-changed" });
      emitUserEvent(department.headId!, { type: "notification" });

      return NextResponse.json(serializeRequest(created), { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  return NextResponse.json({ error: "Захиалгын дугаар үүсгэхэд алдаа гарлаа" }, { status: 500 });
});
