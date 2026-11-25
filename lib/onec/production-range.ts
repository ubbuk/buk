// «Үйлдвэрлэл» табын хугацаа сонгогч: [Өнөөдөр] [Өчигдөр] [Энэ 7 хоног] [Энэ сар] ◀ ▶ ба календарь. Цэвэр (сервер импортгүй): клиент, API хоёулаа ашиглана.
// Огноо бүгд «YYYY-MM-DD» (Улаанбаатарын хуанлийн өдөр); `today` нь дуудагчаас (lib/onec/dates.ts today()) ирнэ.
import { addDays, addMonths, isDate, monthRange } from "./dates";

export interface DateRange {
  from: string;
  to: string;
}
export type RangePreset = "today" | "yesterday" | "week" | "month";

/** Нэг удаад харуулах дээд хугацаа (хоног): 1С-ээс татсан сарууд 3-аас хэтрэхгүй */
export const MAX_RANGE_DAYS = 62;

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 0 = Даваа ... 6 = Ням */
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Долоо хоногийн Даваа */
export const mondayOf = (date: string): string => addDays(date, -weekday(date));

/** Хүчинтэй хугацаа (from ≤ to ≤ today, ≤ 62 хоног) бол өөрийг нь, үгүй бол null */
export function parseRange(from: string | null | undefined, to: string | null | undefined, today: string): DateRange | null {
  if (!isDate(from) || !isDate(to) || from > to || to > today) return null;
  if (dayDiff(from, to) + 1 > MAX_RANGE_DAYS) return null;
  return { from, to };
}

export function presetRange(preset: RangePreset, today: string): DateRange {
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (preset === "week") return { from: mondayOf(today), to: today }; // Даваагаас өнөөдөр хүртэл
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Одоогийн хугацаа аль товчтой тохирч байна (тохирохгүй бол null: календарь, гараар сонгосон) */
export function activePreset(r: DateRange, today: string): RangePreset | null {
  for (const p of ["today", "yesterday", "week", "month"] as const) {
    const x = presetRange(p, today);
    if (x.from === r.from && x.to === r.to) return p;
  }
  return null;
}

/** Хугацааны төрөл: өдөр / сар (1-нээс сарын эцэс эсвэл өнөөдөр) / долоо хоног (Даваагаас) / бусад */
function kindOf(r: DateRange, today: string): "day" | "month" | "week" | "other" {
  if (r.from === r.to) return "day";
  const { from: first, to: last } = monthRange(r.from.slice(0, 7));
  if (r.from === first && r.to.slice(0, 7) === r.from.slice(0, 7) && (r.to === last || r.to === today)) return "month";
  if (weekday(r.from) === 0 && dayDiff(r.from, r.to) <= 6) return "week";
  return "other";
}

/** ◀ (dir = -1) / ▶ (dir = 1): өдөр ±1, сар ±1, долоо хоног ±7, бусад нь хугацааны урт хэмжээгээр. Ирээдүй рүү шилжихгүй (null). */
export function shiftRange(r: DateRange, dir: -1 | 1, today: string): DateRange | null {
  const kind = kindOf(r, today);
  let next: DateRange;
  if (kind === "day") next = { from: addDays(r.from, dir), to: addDays(r.to, dir) };
  else if (kind === "month") {
    const ym = addMonths(r.from.slice(0, 7), dir);
    const { from, to } = monthRange(ym);
    next = { from, to: to > today ? today : to };
  } else if (kind === "week") {
    const from = addDays(r.from, 7 * dir);
    const end = addDays(from, 6);
    next = { from, to: end > today ? today : end };
  } else {
    const span = dayDiff(r.from, r.to) + 1;
    next = { from: addDays(r.from, span * dir), to: addDays(r.to, span * dir) };
    if (next.to > today) next.to = today;
  }
  return next.from > today || next.to < next.from ? null : next;
}

/** Карт гарчигт: «2026-11-24» эсвэл «2026-11-18 – 2026-11-24» */
export const rangeLabel = (r: DateRange): string => (r.from === r.to ? r.from : `${r.from} – ${r.to}`);

/** Хугацаанд хамаарах саруудыг (YYYY-MM) эхнээс нь */
export function monthsOfRange(r: DateRange): string[] {
  const out: string[] = [];
  for (let m = r.from.slice(0, 7); m <= r.to.slice(0, 7); m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Хүчинтэй хугацаа, үгүй (байхгүй, буруу, хагас, ирээдүй, 62 хоногоос урт) бол ЗАВААЛ «Энэ сар»: хуудас хэзээ ч санамсаргүй «Өнөөдөр»-өөр нээгдэхгүй */
export const resolveRange = (from: string | null | undefined, to: string | null | undefined, today: string): DateRange => parseRange(from, to, today) ?? presetRange("month", today);
