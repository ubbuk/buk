import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type Db = Prisma.TransactionClient | typeof prisma;

// Which warehouse stock is taken from, and how a request line is split across warehouses.
//
// A material may have an InventoryBalance row in several warehouses. Stock is taken in a fixed order:
//   1. Warehouse.sortPriority ascending (admin-editable; the central warehouse is seeded first),
//   2. then the larger free quantity,
//   3. then warehouseId, so two runs over the same data always pick the same order.
// Only active, reservable warehouses count, both for what the request shows and for what is reserved, so the two can not differ.

export interface BalanceRow {
  id: string;
  materialId: string;
  warehouseId: string;
  quantityOnHand: number;
  quantityReserved: number;
  sortPriority: number;
}

export interface Allocation {
  balanceId: string;
  warehouseId: string;
  quantity: number;
}

export const freeQuantity = (b: Pick<BalanceRow, "quantityOnHand" | "quantityReserved">) => Math.max(0, b.quantityOnHand - b.quantityReserved);

export function orderBalances<T extends BalanceRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.sortPriority - b.sortPriority || freeQuantity(b) - freeQuantity(a) || a.warehouseId.localeCompare(b.warehouseId)
  );
}

/** What a request line shows as "in stock": the free quantity over every active warehouse. */
export function totalFree(rows: BalanceRow[]): number {
  return rows.reduce((s, b) => s + freeQuantity(b), 0);
}

/**
 * Splits `wanted` over the ordered balances. `consumed` (balanceId -> quantity already taken by earlier lines of the
 * same request) is read and updated, so two lines of one material never take the same stock twice.
 * Returns one allocation per warehouse used; the sum is below `wanted` only when the stock runs out.
 */
export function allocateAcrossBalances(ordered: BalanceRow[], wanted: number, consumed: Map<string, number>): Allocation[] {
  const out: Allocation[] = [];
  let left = wanted;
  for (const b of ordered) {
    if (left <= 0) break;
    const free = freeQuantity(b) - (consumed.get(b.id) ?? 0);
    if (free <= 0) continue;
    const take = Math.min(free, left);
    out.push({ balanceId: b.id, warehouseId: b.warehouseId, quantity: take });
    consumed.set(b.id, (consumed.get(b.id) ?? 0) + take);
    left -= take;
  }
  return out;
}

/** Ordered balances per material, active and reservable warehouses only. */
export async function loadBalances(db: Db, materialIds: string[]): Promise<Map<string, BalanceRow[]>> {
  const byMaterial = new Map<string, BalanceRow[]>();
  if (materialIds.length === 0) return byMaterial;
  const rows = await db.inventoryBalance.findMany({
    where: { materialId: { in: materialIds }, warehouse: { isActive: true, reservable: true } },
    include: { warehouse: { select: { sortPriority: true } } },
  });
  for (const r of rows) {
    const list = byMaterial.get(r.materialId) ?? [];
    list.push({
      id: r.id,
      materialId: r.materialId,
      warehouseId: r.warehouseId,
      quantityOnHand: Number(r.quantityOnHand),
      quantityReserved: Number(r.quantityReserved),
      sortPriority: r.warehouse.sortPriority,
    });
    byMaterial.set(r.materialId, list);
  }
  for (const [id, list] of byMaterial) byMaterial.set(id, orderBalances(list));
  return byMaterial;
}
