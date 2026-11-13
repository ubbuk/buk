const TZ = "Asia/Ulaanbaatar";

/** Улаанбаатарын цагаар өнөөдрийн сар: '2026-11' */
export function currentMonth(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 7);
}

/** Улаанбаатарын цагаар өнөөдөр: '2026-11-11' */
export function today(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 10);
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

export function monthsBetween(fromYm: string, toYm: string): string[] {
  const out: string[] = [];
  for (let ym = fromYm; ym <= toYm; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

export const isMonth = (v: string | null | undefined): v is string => /^\d{4}-(0[1-9]|1[0-2])$/.test(v ?? "");
// Бодит огноо эсэхийг буцааж хөрвүүлж шалгана (2026-02-30 → 2026-03-02 болж "зөв" харагдахаас сэргийлнэ)
export const isDate = (v: string | null | undefined): v is string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v ?? "")) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};

/** Дараагийн өдөр: '2026-10-31' -> '2026-11-01' */
export function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Өдрийн эцсийн (23:59:59 орсон) үлдэгдлийн цаг: дараа өдрийн 00:00:00. 1С нь огноо л заасан баримтыг 23:59:59-д бичдэг, харин
 * Balance(Period) нь заасан агшныг ОРУУЛДАГГҮЙ тул Period=өдөр 23:59:59 гэвэл тэр өдрийн ихэнх бичилт орохгүй (бодитоор 1101 данс
 * 48 сая ₮-өөр дутсан). Тиймээс Balance-д үргэлж энэ цагийг өгнө.
 */
export const balanceBoundary = (date: string): string => `${nextDay(date)}T00:00:00`;

/** Сарын эцсийн өдрийн үлдэгдэл: одоогийн сар бол өнөөдөр, өнгөрсөн сар бол сарын сүүлийн өдөр (Агуулах, Авлага) */
export function asOfDate(ym: string, now: string = today()): string {
  return ym >= now.slice(0, 7) ? now : monthRange(ym).to;
}
