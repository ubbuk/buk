import { Prisma } from "@prisma/client";

// Pure quantity rules for executive partial approval (no database access, so
// lib/procurement.ts and lib/executive-approval.ts can both use them).
//
//   requested   MaterialRequestItem.requestedQuantity (never touched)
//   issued      latest warehouse check's allocatedQuantity (taken from stock)
//   required    latest warehouse check's missingQuantity: what has to be bought
//   authorized  cumulative quantity the executive director has approved for purchase
//   deferred    required - authorized (derived, never stored)
//   purchased   sum of the item's non-voided purchases (lib/procurement.ts)
// Purchasing is capped at `authorized`; `authorized` is capped at `required`.

export type AuthorizationStatus = "NOT_AUTHORIZED" | "PARTIALLY_AUTHORIZED" | "FULLY_AUTHORIZED";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

interface WarehouseCheckRow {
  missingQuantity: Prisma.Decimal;
  allocatedQuantity: Prisma.Decimal;
  warehouseCheck: { checkedAt: Date };
}

function latest<T extends WarehouseCheckRow>(rows: T[]): T | undefined {
  return [...rows].sort((a, b) => b.warehouseCheck.checkedAt.getTime() - a.warehouseCheck.checkedAt.getTime())[0];
}

/** Shortfall of an item: the latest warehouse check's missing quantity (the whole item if never checked). */
export function requiredOf(requested: Prisma.Decimal, rows: WarehouseCheckRow[]): Prisma.Decimal {
  const row = latest(rows);
  return row ? row.missingQuantity : requested;
}

export function issuedOf(rows: WarehouseCheckRow[]): Prisma.Decimal {
  const row = latest(rows);
  return row ? row.allocatedQuantity : D(0);
}

/**
 * A request the executive approved before this feature existed has no decision
 * rows. It is read as fully authorised, which is exactly the purchasing right it
 * always had (the cap is still the warehouse shortfall).
 */
export function isLegacyFullAuthorization(decisionCount: number, executiveStepStatus: string | undefined): boolean {
  return decisionCount === 0 && executiveStepStatus === "APPROVED";
}

export function authorizedOf(required: Prisma.Decimal, allocated: Prisma.Decimal, legacyFull: boolean): Prisma.Decimal {
  if (legacyFull) return required;
  return Prisma.Decimal.min(allocated, required);
}

export function deferredOf(required: Prisma.Decimal, authorized: Prisma.Decimal): Prisma.Decimal {
  return Prisma.Decimal.max(required.minus(authorized), D(0));
}

/** Approval percentage of an item or a whole request, 0..100 with at most 2 decimals. */
export function percentOf(authorized: Prisma.Decimal, required: Prisma.Decimal): number {
  if (required.lte(0)) return 100;
  return Number(authorized.div(required).mul(100).toDecimalPlaces(2));
}

export function authorizationStatusOf(
  items: { required: Prisma.Decimal; authorized: Prisma.Decimal }[],
  executiveApproved: boolean
): AuthorizationStatus {
  if (!executiveApproved) return "NOT_AUTHORIZED";
  const needed = items.filter((i) => i.required.gt(0));
  if (needed.length === 0) return "FULLY_AUTHORIZED";
  if (needed.every((i) => i.authorized.gte(i.required))) return "FULLY_AUTHORIZED";
  return needed.some((i) => i.authorized.gt(0)) ? "PARTIALLY_AUTHORIZED" : "NOT_AUTHORIZED";
}

/** Same rule as lib/procurement.ts for a purchase/allocation quantity: positive, at most 3 decimals. */
export function isValidQuantity(q: unknown): q is number {
  return typeof q === "number" && Number.isFinite(q) && q > 0 && q < 1e9 && D(q).decimalPlaces() <= 3;
}
