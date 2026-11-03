// All monitoring dates are shown and bucketed in Ulaanbaatar time, regardless
// of the server's or the browser's own zone. Timestamps are stored as UTC.
export const MONITORING_TZ = "Asia/Ulaanbaatar";

const DAY_MS = 24 * 60 * 60 * 1000;

function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

// Offset (ms) of `timeZone` from UTC at the given instant.
function offsetMs(date: Date, timeZone: string) {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which the calendar day containing `date` began in Ulaanbaatar. */
export function startOfDayUB(date: Date): Date {
  const p = partsIn(date, MONITORING_TZ);
  const localMidnightAsUtc = Date.UTC(p.y, p.m - 1, p.d);
  // Local midnight = that wall-clock time minus the zone's offset at that time.
  return new Date(localMidnightAsUtc - offsetMs(new Date(localMidnightAsUtc), MONITORING_TZ));
}

export type RangeKey = "7d" | "30d" | "90d" | "all";
export const RANGE_KEYS: readonly RangeKey[] = ["7d", "30d", "90d", "all"];

export interface Range {
  key: RangeKey;
  /** Inclusive lower bound (UB midnight), or null for "all". */
  from: Date | null;
  /** Exclusive upper bound: the end of the UB day containing `asOf`. */
  to: Date;
}

export function parseRangeKey(value: string | null | undefined): RangeKey {
  return RANGE_KEYS.includes(value as RangeKey) ? (value as RangeKey) : "30d";
}

export function resolveRange(key: RangeKey, asOf: Date): Range {
  const todayStart = startOfDayUB(asOf);
  const to = new Date(todayStart.getTime() + DAY_MS);
  if (key === "all") return { key, from: null, to };
  const days = key === "7d" ? 7 : key === "30d" ? 30 : 90;
  return { key, from: new Date(todayStart.getTime() - (days - 1) * DAY_MS), to };
}

export function createdAtFilter(range: Range) {
  return range.from ? { gte: range.from, lt: range.to } : { lt: range.to };
}
