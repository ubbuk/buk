// Баримтын харагдацын формат. Клиент аюулгүй.

/** 22,200,000₮ ; бутархай байвал 2,018,181.83₮ (1С-ийн баримтын дэлгэцтэй ижил: дүнг төгрөг, мөнгөнөөр нь гаргана) */
export function money2(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(v) + "₮";
}

/** Тоо хэмжээ: 150, 28.8 */
export function qty(v: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(v);
}

/** "2026-11-11T11:03:15" -> "2026.11.11 11:03:15" ; цаггүй бол зөвхөн огноо */
export function stamp(iso: string): string {
  const [d, t] = iso.split("T");
  const date = (d ?? "").replaceAll("-", ".");
  return t && t !== "00:00:00" ? `${date} ${t.slice(0, 8)}` : date;
}

/** "2026-11-11T11:03:15" -> "2026.11.11" */
export const dayOf = (iso: string): string => (iso.split("T")[0] ?? "").replaceAll("-", ".");
