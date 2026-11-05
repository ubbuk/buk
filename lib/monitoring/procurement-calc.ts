// Pure rules of the procurement monitoring section (no database, no clock): the
// SQL in procurement.ts supplies facts, these functions interpret them. Quantities
// follow the procurement module's own business rules (lib/procurement.ts):
//   required  = latest warehouse check's missing quantity (whole item if never checked)
//   purchased = sum of NON-VOIDED purchases
//   an item is complete when required > 0 and purchased >= required
// and nothing here invents a database state: every stage below is derived.

export type ItemStatus = "NOT_REQUIRED" | "NOT_STARTED" | "PARTIAL" | "COMPLETE";

export function itemStatus(required: number, purchased: number): ItemStatus {
  if (!(required > 0)) return "NOT_REQUIRED"; // covered by the warehouse
  if (purchased >= required) return "COMPLETE";
  return purchased > 0 ? "PARTIAL" : "NOT_STARTED";
}

export const remainingOf = (required: number, purchased: number) => (required > 0 ? Math.max(required - purchased, 0) : 0);

export interface CompletionItem {
  required: number;
  purchased: number;
  /** Estimated unit price from the request (null when the request carried none). */
  estimatedUnitPrice: number | null;
}

export interface Completion {
  /** 0-100, or null when nothing has to be bought. */
  percent: number | null;
  /** How the items were weighted. */
  basis: "value" | "items" | "none";
}

/**
 * Request-level completion across items that may use different units (kg, pcs, m):
 * quantities are NEVER added together. Each item contributes its own fraction
 * purchased/required (capped at 1). Items are weighted by their estimated value
 * (required x estimated unit price, a unit-free money amount) when every item to
 * buy carries a price, otherwise equally -- and the basis is reported so the UI can say so.
 */
export function computeCompletion(items: CompletionItem[]): Completion {
  const needed = items.filter((i) => i.required > 0);
  if (needed.length === 0) return { percent: null, basis: "none" };
  const fraction = (i: CompletionItem) => Math.min(1, Math.max(0, i.purchased / i.required));
  const priced = needed.every((i) => i.estimatedUnitPrice !== null && i.estimatedUnitPrice > 0);
  if (priced) {
    const weights = needed.map((i) => i.required * (i.estimatedUnitPrice as number));
    const total = weights.reduce((a, b) => a + b, 0);
    const done = needed.reduce((s, i, idx) => s + fraction(i) * weights[idx], 0);
    return { percent: round1((done / total) * 100), basis: "value" };
  }
  return { percent: round1((needed.reduce((s, i) => s + fraction(i), 0) / needed.length) * 100), basis: "items" };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export type ProcurementStage =
  | "AWAITING_CLASSIFICATION"
  | "IN_PROCUREMENT"
  | "READY_TO_COMPLETE"
  | "AWAITING_ACCOUNTING"
  | "PROCUREMENT_COMPLETED";

export interface StageInput {
  requestStatus: string;
  procurementApproved: boolean;
  /** domestic/international managers are configured (otherwise nothing is ever "awaiting classification") */
  assignedMode: boolean;
  classified: boolean;
  requiredItems: number;
  completeItems: number;
}

/**
 * The lifecycle position of a request, derived from existing data only:
 *   PENDING_PROCUREMENT: waiting for classification -> in procurement -> everything bought
 *   (READY_TO_COMPLETE: the Manager has not pressed "complete" yet);
 *   then the step is approved: PENDING_ACCOUNTING = awaiting accounting, later = completed.
 * "Partially purchased" and the domestic / international tracks are NOT stages: they
 * run side by side inside IN_PROCUREMENT and are reported as separate derived flags.
 */
export function deriveStage(i: StageInput): ProcurementStage {
  if (i.requestStatus === "PENDING_PROCUREMENT") {
    if (i.assignedMode && !i.classified && i.requiredItems > 0) return "AWAITING_CLASSIFICATION";
    if (i.requiredItems > 0 && i.completeItems >= i.requiredItems) return "READY_TO_COMPLETE";
    return "IN_PROCUREMENT";
  }
  if (i.requestStatus === "PENDING_ACCOUNTING" && i.procurementApproved) return "AWAITING_ACCOUNTING";
  return "PROCUREMENT_COMPLETED";
}

/** Whole seconds between two instants; null when either timestamp is missing, never negative. */
export function secondsBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

export interface UnitQuantity {
  unit: string;
  quantity: number;
}

/** Sums quantities per unit; incompatible units are listed side by side, never merged. */
export function sumByUnit(rows: { unit: string; quantity: number }[]): UnitQuantity[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.unit, (map.get(r.unit) ?? 0) + r.quantity);
  return [...map.entries()].map(([unit, quantity]) => ({ unit, quantity })).sort((a, b) => a.unit.localeCompare(b.unit, "mn"));
}

/** Allowed delay thresholds (hours) -- monitoring filters, not SLA policy. */
export const THRESHOLD_HOURS = [24, 48, 72, 168] as const;
export const DEFAULT_THRESHOLD_HOURS = 72;

export function parseThresholdHours(raw: string | null | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 24 * 90 ? n : DEFAULT_THRESHOLD_HOURS;
}
