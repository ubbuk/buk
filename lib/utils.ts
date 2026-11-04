import { type ClassValue, clsx } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Тодорхойгүй";
  return (
    new Intl.NumberFormat("mn-MN", {
      maximumFractionDigits: 0,
    }).format(value) + "₮"
  );
}

// Same null handling as formatCurrency, but with a message that explains
// *why* there's no number yet (no price has been entered -- the material is
// still being priced) instead of the bare "Тодорхойгүй". Used where that
// context matters, e.g. the request detail page's price cells; list views
// keep plain formatCurrency since a long phrase doesn't fit a table column.
export function formatPriceOrPending(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Үнийн судалгаа хийгдэж байна";
  return formatCurrency(value);
}

export function formatNumber(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat("mn-MN", {
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed((kb / 1024) < 10 ? 1 : 0)} MB`;
}

export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("mn-MN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatDateTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("mn-MN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** What was ordered, for list rows: first material name, plus "+N" when there are more lines. */
export function requestTitle(r: { items: { materialName: string }[]; requestNumber: string }): string {
  if (r.items.length === 0) return `№${r.requestNumber}`;
  const extra = r.items.length - 1;
  return extra > 0 ? `${r.items[0].materialName} +${extra}` : r.items[0].materialName;
}
