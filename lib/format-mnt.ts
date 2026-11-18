// Төгрөгийг товчилж харуулна: 10,490,123,456 -> «10.49 тэрбум₮». Бүтэн тоо нь hover (title)-д. Клиент аюулгүй.
const full = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 1,234,567,890₮ */
export const formatFullMnt = (v: number): string => `${full.format(Math.round(v))}₮`;

/** 10.49 тэрбум₮ · 826.39 сая₮ · 12,500₮ (сая хүрэхгүй бол бүтнээр) */
export function formatCompactMnt(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)} их наяд₮`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} тэрбум₮`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)} сая₮`;
  return formatFullMnt(v);
}
