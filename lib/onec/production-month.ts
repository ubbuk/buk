// «Үйлдвэрлэл» табын сар сонгогч (◀ 2026-11 ▶) ба «Цех × Өдөр» хүснэгтийн өдрүүд. Цэвэр (сервер импортгүй): клиент, сервер хоёулаа ашиглана.
import { addDays, addMonths, isMonth, monthRange } from "./dates";

/** Хүчинтэй сар (YYYY-MM, ирээдүй биш) бол өөрийг нь, үгүй (байхгүй, буруу, ирээдүй) бол ЗАВААЛ энэ сар */
export const resolveMonth = (raw: string | null | undefined, current: string): string => (isMonth(raw) && raw <= current ? raw : current);

/** ◀ (dir = -1) / ▶ (dir = 1): өмнөх / дараах сар; ирээдүй рүү шилжихгүй (null) */
export function shiftMonth(month: string, dir: -1 | 1, current: string): string | null {
  const next = addMonths(month, dir);
  return next > current ? null : next;
}

/** Сарын бүх өдөр: ["2026-11-01", ..., "2026-11-30"] */
export function daysOfMonth(month: string): string[] {
  const { from, to } = monthRange(month);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Бямба, Ням гараг (амралтын өдөр) */
export function isWeekend(date: string): boolean {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}
