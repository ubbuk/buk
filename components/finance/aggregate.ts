// Өдрийн цувааг «Өдөр / 7 хоног / Сар»-аар нэгтгэх (цэвэр функц): зөвхөн өгөгдсөн өдрийн тоонуудын нийлбэр, шинэ тоо зохиохгүй.
export type Granularity = "day" | "week" | "month";
export type DailyPoint = { date: string } & Record<string, number | string>;

/** 7 хоногийн хувин: сарын 1-7, 8-14, 15-21, 22-28, 29-... (календарийн 7 хоног биш, сарын эхнээс) */
export const weekStart = (date: string): number => Math.floor((Number(date.slice(8, 10)) - 1) / 7) * 7 + 1;

export function aggregateDaily(days: DailyPoint[], g: Granularity, keys: string[]): DailyPoint[] {
  if (g === "day") return days;
  const out = new Map<string, DailyPoint>();
  for (const d of days) {
    const bucket = g === "month" ? d.date.slice(0, 7) : `${d.date.slice(0, 7)}-${String(weekStart(d.date)).padStart(2, "0")}`;
    const cur = out.get(bucket) ?? ({ date: bucket } as DailyPoint);
    for (const k of keys) cur[k] = (Number(cur[k]) || 0) + (Number(d[k]) || 0);
    out.set(bucket, cur);
  }
  return [...out.values()];
}

/** Одоогийн сар бол өнөөдрөөс хойшхыг хасна (ирээдүйн өдөр байхгүй) */
export const untilDate = (days: DailyPoint[], today?: string): DailyPoint[] => (today ? days.filter((d) => d.date <= today) : days);
