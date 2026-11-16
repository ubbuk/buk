import { prisma } from "./prisma";
import { recordGrant, type GrantContext } from "./authority-grant";
import { primaryKeeperId } from "./warehouse-keeper";

export type AssignKeeperResult =
  | { ok: true; id: string; keeperId: string | null; changed: boolean; repointed: number; notified: string[] }
  | { ok: false; status: number; error: string };

/** A keeper must be an existing, active user holding the STOREKEEPER role. */
export function keeperError(candidate: { role: string; isActive: boolean } | null | undefined): string | null {
  if (!candidate) return "Хэрэглэгч олдсонгүй";
  if (!candidate.isActive) return "Идэвхгүй хэрэглэгчийг нярваар томилох боломжгүй";
  if (candidate.role !== "STOREKEEPER") return "Зөвхөн «Нярав» (STOREKEEPER) эрхтэй хэрэглэгчийг нярваар томилно";
  return null;
}

/**
 * Sets (or clears) the keeper of a TOP-LEVEL warehouse. A keeper is only used when the step-2 mode is BY_WAREHOUSE,
 * but it is stored in either mode so it is ready when the mode is switched.
 *
 * Open warehouse checks that were routed to the outgoing keeper are re-pointed to the new keeper (or to the primary
 * keeper when the keeper is cleared) and the receiver is notified, the same way a changed department head is handled.
 * Nothing is re-pointed when the outgoing keeper is also the primary keeper or still keeps another warehouse: such a
 * step cannot be told apart from one that was routed through that other role, so it stays where it is.
 * Decided steps and history are never touched. One transaction, with a before/after audit record.
 */
export async function assignWarehouseKeeper(
  warehouseId: string,
  newKeeperId: string | null,
  actorId: string,
  grant?: GrantContext
): Promise<AssignKeeperResult> {
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) return { ok: false, status: 404, error: "Агуулах олдсонгүй" };
  if (warehouse.parentId) return { ok: false, status: 400, error: "Нярвыг зөвхөн дээд түвшний агуулахад онооно" };
  if (newKeeperId === warehouse.keeperId) {
    return { ok: true, id: warehouse.id, keeperId: warehouse.keeperId, changed: false, repointed: 0, notified: [] };
  }
  if (newKeeperId) {
    const candidate = await prisma.user.findUnique({ where: { id: newKeeperId }, select: { role: true, isActive: true } });
    const error = keeperError(candidate);
    if (error) return { ok: false, status: 400, error };
  }

  return prisma.$transaction(async (tx) => {
    const oldKeeperId = warehouse.keeperId;
    await tx.warehouse.update({ where: { id: warehouseId }, data: { keeperId: newKeeperId } });

    let repointed = 0;
    let receiver: string | null = null;
    if (oldKeeperId) {
      const [primary, stillKeeps] = await Promise.all([
        primaryKeeperId(tx),
        tx.warehouse.count({ where: { keeperId: oldKeeperId, isActive: true, id: { not: warehouseId } } }),
      ]);
      receiver = newKeeperId ?? primary;
      if (receiver && receiver !== oldKeeperId && oldKeeperId !== primary && stillKeeps === 0) {
        const open = await tx.approvalStep.findMany({
          where: {
            type: "WAREHOUSE_CHECK",
            status: "PENDING",
            assignedUserId: oldKeeperId,
            request: { status: { in: ["PENDING_DEPARTMENT_APPROVAL", "PENDING_WAREHOUSE_CHECK"] } },
          },
          select: { id: true, requestId: true, request: { select: { requestNumber: true, status: true } } },
        });
        if (open.length > 0) {
          await tx.approvalStep.updateMany({ where: { id: { in: open.map((s) => s.id) }, status: "PENDING" }, data: { assignedUserId: receiver } });
          const waiting = open.filter((s) => s.request.status === "PENDING_WAREHOUSE_CHECK");
          if (waiting.length > 0) {
            await tx.notification.createMany({
              data: waiting.map((s) => ({
                userId: receiver!,
                type: "WAREHOUSE_CHECK_NEEDED" as const,
                title: "Агуулахын шалгалт хийх шаардлагатай",
                body: `№${s.request.requestNumber} захиалгын нөөцийг шалгана уу`,
                relatedRequestId: s.requestId,
              })),
            });
          }
          repointed = open.length;
        }
      }
    }

    await tx.auditLog.create({
      data: {
        entityType: "Warehouse",
        entityId: warehouseId,
        action: "UPDATE",
        actorId,
        beforeJson: JSON.stringify({ keeperId: oldKeeperId }),
        afterJson: JSON.stringify({ keeperId: newKeeperId, repointedOpenChecks: repointed }),
      },
    });

    let notified: string[] = [];
    if (grant && newKeeperId) {
      notified = await recordGrant(tx, grant, {
        subjectType: "Warehouse",
        subjectId: warehouseId,
        summary: `«${warehouse.name}» агуулахын нярваар томилогдлоо`,
        before: { keeperId: oldKeeperId },
        after: { keeperId: newKeeperId },
        previousHolderIds: oldKeeperId ? [oldKeeperId] : [],
      });
    }
    return { ok: true as const, id: warehouseId, keeperId: newKeeperId, changed: true, repointed, notified };
  });
}
