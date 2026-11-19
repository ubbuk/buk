// Хайлтын мөрийг задлах (клиент, сервер хоёуланд аюулгүй, цэвэр): дүн («84 сая», «1.18 тэрбум», 84073015, 84,073,015.25), огноо
// (2026-11-17, 11-17) ба үг. Мөнгөн хөрөнгө, Борлуулалт табын хайлт хоёуланд.
export interface ParsedQuery {
  /** дүнгийн мужууд [min, max): «84 сая» -> [84e6, 85e6), «84.1 сая» -> [84.1e6, 84.2e6) */
  ranges: { min: number; max: number }[];
  /** яг таарах дүн: 84073015 эсвэл 84,073,015.25 */
  exact: number[];
  dates: { full?: string; monthDay?: string }[];
  words: string[];
}

const UNIT: Record<string, number> = { сая: 1e6, тэрбум: 1e9, мянга: 1e3, мянган: 1e3 };

export function parseQuery(raw: string): ParsedQuery {
  let q = raw.normalize("NFKC").toLowerCase().replace(/₮|төгрөг|төг/g, " ");
  const out: ParsedQuery = { ranges: [], exact: [], dates: [], words: [] };

  q = q.replace(/(\d+(?:[.,]\d+)?)\s*(сая|тэрбум|мянган|мянга)/g, (_m, num: string, unit: string) => {
    const n = Number(num.replace(",", "."));
    const decimals = (num.split(/[.,]/)[1] ?? "").length;
    const step = UNIT[unit] * 10 ** -decimals;
    out.ranges.push({ min: n * UNIT[unit], max: n * UNIT[unit] + step });
    return " ";
  });
  q = q.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (_m, y: string, mo: string, d: string) => {
    out.dates.push({ full: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}` });
    return " ";
  });
  q = q.replace(/\b(\d{1,2})[-./](\d{1,2})\b/g, (m, mo: string, d: string) => {
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return m;
    out.dates.push({ monthDay: `${mo.padStart(2, "0")}-${d.padStart(2, "0")}` });
    return " ";
  });
  // 84,073,015 / 84 073 015 / 84073015 / 84073015.25
  q = q.replace(/\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?/g, (m) => {
    out.exact.push(Number(m.replace(/[,\s]/g, "")));
    return " ";
  });
  out.words = q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  return out;
}

/** Дүн (₮) хайлтын дүнгийн нөхцөлд таарах эсэх (хоосон нөхцөл бол таарна). Мужууд, яг дүн хоёр нь «аль нэг» байдлаар. */
export function amountMatches(q: ParsedQuery, amount: number): boolean {
  const a = Math.abs(amount);
  if (q.ranges.length && !q.ranges.some((r) => a >= r.min - 0.005 && a < r.max)) return false;
  if (q.exact.length && !q.exact.some((n) => (Number.isInteger(n) ? Math.floor(a) === n || Math.round(a) === n : Math.abs(a - n) < 0.006))) return false;
  return true;
}
