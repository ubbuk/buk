import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { loadBalances, freeQuantity, orderBalances, type BalanceRow } from "./warehouse-allocation";
import { getKeeperMode, type KeeperMode } from "./warehouse-settings";

type Db = Prisma.TransactionClient | typeof prisma;

export type KeeperFallback = "NO_STOCK" | "NO_KEEPER" | "KEEPER_UNAVAILABLE";

export interface KeeperResolution {
  userId: string;
  mode: KeeperMode;
  /** The warehouse whose keeper was chosen (BY_WAREHOUSE with a keeper), else null. */
  warehouseId: string | null;
  /** Set when BY_WAREHOUSE could not name a keeper and the primary keeper was used instead. */
  fallback: KeeperFallback | null;
  /** The top-level warehouse that had no usable keeper (for the audit record). */
  fallbackWarehouseId: string | null;
}

/** The primary keeper: the active STOREKEEPER_LEAD holder. null when the position is not filled. */
export async function primaryKeeperId(db: Db): Promise<string | null> {
  const a = await db.approvalRoleAssignment.findFirst({ where: { role: "STOREKEEPER_LEAD", isActive: true }, select: { userId: true } });
  return a?.userId ?? null;
}

/**
 * Who does step 2 (the warehouse check) of a new request. Returns null only when there is no primary keeper at all
 * (the caller reports the incomplete position assignment, as it does for the other positions).
 *
 * PRIMARY mode: always the primary keeper.
 * BY_WAREHOUSE mode: the request's *main* warehouse is the first (in reservation order) active warehouse holding stock
 * of any requested material. Its top-level warehouse's keeper does the check. A request is never split between
 * keepers, and the keeper's decision is final. Without stock, without a keeper, or with an inactive/non-storekeeper
 * keeper (e.g. "Гадна талбай") the request goes to the primary keeper and `fallback` says why.
 */
export async function resolveStep2Keeper(db: Db, materialIds: string[]): Promise<KeeperResolution | null> {
  const [mode, primary] = await Promise.all([getKeeperMode(db), primaryKeeperId(db)]);
  if (!primary) return null;
  const viaPrimary = (fallback: KeeperFallback | null, fallbackWarehouseId: string | null = null): KeeperResolution => ({
    userId: primary,
    mode,
    warehouseId: null,
    fallback,
    fallbackWarehouseId,
  });
  if (mode === "PRIMARY") return viaPrimary(null);

  const main = await mainWarehouseId(db, materialIds);
  if (!main) return viaPrimary("NO_STOCK");

  const topLevel = await topLevelOf(db, main);
  if (!topLevel.keeperId) return viaPrimary("NO_KEEPER", topLevel.id);
  const keeper = await db.user.findUnique({ where: { id: topLevel.keeperId }, select: { isActive: true, role: true } });
  if (!keeper || !keeper.isActive || keeper.role !== "STOREKEEPER") return viaPrimary("KEEPER_UNAVAILABLE", topLevel.id);
  return { userId: topLevel.keeperId, mode, warehouseId: topLevel.id, fallback: null, fallbackWarehouseId: null };
}

async function mainWarehouseId(db: Db, materialIds: string[]): Promise<string | null> {
  const balances = await loadBalances(db, [...new Set(materialIds)]);
  const withStock: BalanceRow[] = [];
  for (const list of balances.values()) for (const b of list) if (freeQuantity(b) > 0) withStock.push(b);
  return orderBalances(withStock)[0]?.warehouseId ?? null;
}

async function topLevelOf(db: Db, warehouseId: string) {
  let current = await db.warehouse.findUniqueOrThrow({ where: { id: warehouseId }, select: { id: true, parentId: true, keeperId: true } });
  // two levels by design; the loop guard also protects against a bad parent cycle
  for (let depth = 0; current.parentId && depth < 8; depth++) {
    current = await db.warehouse.findUniqueOrThrow({ where: { id: current.parentId }, select: { id: true, parentId: true, keeperId: true } });
  }
  return current;
}

/** The audit record for a request that BY_WAREHOUSE routed to the primary keeper. Call inside the request-creating transaction. */
export async function recordKeeperFallback(db: Db, requestId: string, actorId: string, r: KeeperResolution) {
  if (!r.fallback) return;
  await db.auditLog.create({
    data: {
      entityType: "MaterialRequest",
      entityId: requestId,
      action: "UPDATE",
      actorId,
      afterJson: JSON.stringify({
        event: "STOREKEEPER_FALLBACK",
        step: "WAREHOUSE_CHECK",
        mode: r.mode,
        reason: r.fallback,
        warehouseId: r.fallbackWarehouseId,
        assignedUserId: r.userId,
      }),
    },
  });
}
