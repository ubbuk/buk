// Хуваарьт 1С sync хэзээ ажилладаг, тэр хуваарийн дагуу өгөгдөл хуучирсан эсэх: ЦОРЫН ГАНЦ газар.
// .github/workflows/sync-1c.yml-ийн cron нь UTC-ээр бичигдсэн тул энд импортлох боломжгүй; sync-schedule.test.ts нь хоёрыг тулгаж, зөрвөл унана.
// Edge/клиент аюулгүй: сервер импортгүй, цагийг UTC-ээр (Монгол DST-гүй, UTC+8) тооцно.

export const SYNC_SCHEDULE = {
  timeZone: "Asia/Ulaanbaatar",
  utcOffsetHours: 8,
  /** Хуваарьт өдрүүд: 0 = Ням, 1 = Даваа … 6 = Бямба */
  days: [1, 2, 3, 4, 5, 6],
  /** Хуваарьт цонх: [09:00, 20:00) Улаанбаатарын цагаар */
  startHour: 9,
  endHour: 20,
} as const;

/** Хуваарьт цагт үүнээс хуучин өгөгдөлд анхааруулга гаргана */
export const STALE_AFTER_MS = 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const OFFSET_MS = SYNC_SCHEDULE.utcOffsetHours * HOUR_MS;

/** Улаанбаатарын өдрийн эхлэл (00:00) UTC миллисекундээр */
const localDayStart = (ms: number): number => Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
const localWeekday = (dayStartMs: number): number => new Date(dayStartMs + OFFSET_MS).getUTCDay();

/** Тухайн мөч хуваарьт цонхонд (Даваа–Бямба 09:00–20:00 УБ) байна уу */
export function isScheduledTime(now: Date): boolean {
  const dayStart = localDayStart(now.getTime());
  if (!(SYNC_SCHEDULE.days as readonly number[]).includes(localWeekday(dayStart))) return false;
  const t = now.getTime();
  return t >= dayStart + SYNC_SCHEDULE.startHour * HOUR_MS && t < dayStart + SYNC_SCHEDULE.endHour * HOUR_MS;
}

/**
 * Хуваарьт цонх хамгийн сүүлд идэвхтэй байсан мөч (≤ now): цонхонд байвал одоо, үгүй бол өмнөх цонхны хаалт (20:00).
 * Хуваарийн бус цагт өгөгдлийг «одоо»-той биш, энэ мөчтэй харьцуулна: орой, ням гарагт sync ажиллахгүй нь алдаа биш.
 */
export function lastScheduledMoment(now: Date): Date {
  const t = now.getTime();
  let dayStart = localDayStart(t);
  for (let i = 0; i < 8; i++, dayStart -= DAY_MS) {
    if (!(SYNC_SCHEDULE.days as readonly number[]).includes(localWeekday(dayStart))) continue;
    const open = dayStart + SYNC_SCHEDULE.startHour * HOUR_MS;
    const close = dayStart + SYNC_SCHEDULE.endHour * HOUR_MS;
    if (t >= close) return new Date(close);
    if (t >= open) return now;
  }
  return now; // days хоосон гэх мэт: хуваарьгүй бол «одоо»
}

export interface StockFreshness {
  stale: boolean;
  /** хэзээ ч амжилттай sync болоогүй */
  never: boolean;
  /** одоогоос хойших нас (мс); never үед null */
  ageMs: number | null;
  message: string | null;
}

/**
 * Хуучирсан өгөгдлийн анхааруулга.
 *  - Хуваарьт цагт: сүүлийн амжилттай sync 1 цагаас хуучин бол.
 *  - Хуваарийн бус цагт (орой, ням): сүүлийн хуваарьт мөчөөс (өмнөх цонхны 20:00) 1 цагаас илүү өмнө шинэчлэгдсэн бол
 *    (өөрөөр хэлбэл өмнөх ажлын өдрийн сүүлийн цагт sync амжилтгүй байсан). 19:45-ийн сүүлийн ажиллалт хэвийн.
 */
export function evaluateStockFreshness(lastSyncedAt: Date | null, now: Date): StockFreshness {
  if (!lastSyncedAt) {
    return { stale: true, never: true, ageMs: null, message: "Мэдээлэл хараахан шинэчлэгдээгүй байна. Тоо хуучирсан байж магадгүй." };
  }
  const ageMs = Math.max(0, now.getTime() - lastSyncedAt.getTime());
  const reference = lastScheduledMoment(now).getTime();
  const stale = lastSyncedAt.getTime() < reference - STALE_AFTER_MS;
  return { stale, never: false, ageMs, message: stale ? `Мэдээлэл ${formatAgo(ageMs)} шинэчлэгдсэн. Тоо хуучирсан байж магадгүй.` : null };
}

/** «3 цагийн өмнө»; 48 цагаас дээш бол «3 өдрийн өмнө» */
export function formatAgo(ageMs: number): string {
  const hours = Math.max(1, Math.floor(ageMs / HOUR_MS));
  return hours < 48 ? `${hours} цагийн өмнө` : `${Math.floor(hours / 24)} өдрийн өмнө`;
}

/** "2026-11-14 19:45" Улаанбаатарын цагаар (Intl-гүй, сервер/браузерын бүсээс үл хамаарна) */
export function formatUbDateTime(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}
