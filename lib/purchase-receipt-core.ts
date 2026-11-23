// Pure (no server imports): receipt kinds, which purchased rows still lack a receipt, and the receipts-vs-purchases
// comparison. Shared by the procurement rules (lib/procurement.ts), the receipts service and the screens.
export const RECEIPT_KINDS = ["WAYBILL", "INVOICE", "VAT_RECEIPT", "CASH_RECEIPT", "OTHER"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

export const RECEIPT_KIND_LABEL: Record<ReceiptKind, string> = {
  WAYBILL: "Падаан",
  INVOICE: "Нэхэмжлэх",
  VAT_RECEIPT: "НӨАТ-ын баримт (e-barimt)",
  CASH_RECEIPT: "Бэлэн мөнгөний баримт",
  OTHER: "Бусад",
};

export const MAX_RECEIPTS_PER_REQUEST = 30;
export const MIN_WAIVE_REASON = 3;

/** Receipts are only changed while the request is in procurement; after that the Chief Accountant is looking at them. */
export const RECEIPTS_LOCKED_MESSAGE = "Баримтыг зөвхөн худалдан авалтын шатанд өөрчилнө";

export interface CoverageInput {
  /** Purchased rows (items that had to be bought). */
  itemIds: string[];
  /** requestItemId of every receipt of the request; null = a receipt for the whole purchase (covers every item). */
  receiptItemIds: (string | null)[];
  /** requestItemId of every item with a "no receipt" reason. */
  waivedItemIds: string[];
}

/** Items that have neither a receipt (their own or a whole-purchase one) nor a stated reason for having none. */
export function itemsMissingReceipt(input: CoverageInput): string[] {
  if (input.receiptItemIds.includes(null)) return [];
  const have = new Set([...input.receiptItemIds.filter((x): x is string => x !== null), ...input.waivedItemIds]);
  return input.itemIds.filter((id) => !have.has(id));
}

export interface AmountComparison {
  purchased: number;
  receipts: number;
  /** receipts - purchased */
  difference: number;
  /** Receipts without an amount: the comparison is incomplete while there are any. */
  receiptsWithoutAmount: number;
  /** Amounts all given and within a tugrik of each other. */
  matches: boolean;
}

export function compareAmounts(purchased: number, receipts: { amount: number | null }[]): AmountComparison {
  const receiptTotal = receipts.reduce((s, r) => s + (r.amount ?? 0), 0);
  const withoutAmount = receipts.filter((r) => r.amount === null).length;
  const difference = Math.round((receiptTotal - purchased) * 100) / 100;
  return { purchased, receipts: receiptTotal, difference, receiptsWithoutAmount: withoutAmount, matches: receipts.length > 0 && withoutAmount === 0 && Math.abs(difference) < 1 };
}
