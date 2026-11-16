"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { aggregateDaily, untilDate, weekStart, type DailyPoint, type Granularity } from "./aggregate";
import { DailyBarChart, type BarSeries } from "./DailyBarChart";

type Daily = DailyPoint;

const TABS: [Granularity, string][] = [
  ["day", "Өдөр"],
  ["week", "7 хоног"],
  ["month", "Сар"],
];

const MN_MONTH = (ym: string) => `${ym.slice(0, 4)} оны ${Number(ym.slice(5, 7))}-р сар`;

/**
 * Өдрийн цувааг «Өдөр / 7 хоног / Сар»-аар харуулна. Одоогийн сар бол зөвхөн өнөөдөр хүртэл (ирээдүйн өдөр байхгүй).
 * Нэгтгэл нь зөвхөн өгөгдсөн өдрийн тоонуудын нийлбэр: шинэ тоо зохиохгүй. `keys`: нийлбэрлэх талбарууд (цуваа, баримтын тоо).
 */
export function GranularChart({
  data,
  series,
  keys,
  today,
  countKey,
  countLabel,
}: {
  data: Daily[];
  series: BarSeries[];
  keys: string[];
  /** Өнөөдөр (YYYY-MM-DD, Улаанбаатарын цагаар): энэ өдрөөс хойшхыг нуух. Өнгөрсөн сард өгөхгүй. */
  today?: string;
  countKey?: string;
  countLabel?: string;
}) {
  const [g, setG] = useState<Granularity>("day");
  const days = useMemo(() => untilDate(data, today), [data, today]);
  const points = useMemo(() => aggregateDaily(days, g, keys), [days, g, keys]);

  const label = (date: string) => (g === "month" ? `${Number(date.slice(5, 7))}-р сар` : date.slice(8));
  const title = (date: string) => {
    if (g === "month") return MN_MONTH(date);
    if (g === "week") {
      const start = weekStart(date);
      const last = days.filter((d) => d.date.startsWith(date.slice(0, 7))).length;
      return `${date.slice(0, 7)}-${String(start).padStart(2, "0")} … ${String(Math.min(start + 6, last)).padStart(2, "0")}`;
    }
    return date;
  };

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Хугацааны нэгтгэл" className="ng-panel ml-auto flex w-fit rounded-xl p-1">
        {TABS.map(([k, name]) => (
          <button
            key={k}
            type="button"
            aria-pressed={g === k}
            onClick={() => setG(k)}
            className={cn("focus-ring h-7 rounded-lg px-3 text-xs transition-colors", g === k ? "bg-[rgba(245,181,35,0.16)] text-[#ffd56b] shadow-[0_0_0_1px_rgba(255,213,107,0.5)_inset]" : "text-text-muted hover:text-text")}
          >
            {name}
          </button>
        ))}
      </div>
      <DailyBarChart data={points} series={series} label={label} tooltipTitle={title} countKey={countKey} countLabel={countLabel} unit={g === "day" ? "өдрөөр" : g === "week" ? "7 хоногоор" : "сараар"} />
    </div>
  );
}
