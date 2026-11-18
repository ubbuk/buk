"use client";

import { ArrowDownRight, ArrowUpRight, BarChart3, Minus, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useId } from "react";
import type { DataTableColumn } from "@/components/ui/DataTable";
import { cn } from "@/lib/utils";

// «Navy Gold» загварын жижиг бүрэлдэхүүнүүд (зөвхөн харагдац; өгөгдөл, эрхэд хамаарахгүй).

/** Хуримтлагдсан дүнгийн алтан sparkline. Бодит цуваа өгөгдсөн үед л зурна. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const id = useId();
  if (values.length < 2 || values.every((v) => v === values[0])) return null;
  const W = 220;
  const H = 70;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 6 - ((v - min) / span) * (H - 14)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("pointer-events-none", className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-a`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f5b523" stopOpacity="0.5" />
          <stop offset="1" stopColor="#f5b523" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={`url(#${id}-a)`} />
      <polyline points={line} fill="none" stroke="#ffd56b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="3.2" fill="#ffd56b" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Өөрчлөлтийн хувь: зөвхөн бодит харьцуулах өгөгдөл (өмнөх сар г.м.) байвал дамжуулна. `costLike`: өсөлт нь муу (зардал) */
export function Delta({ pct, costLike = false }: { pct: number; costLike?: boolean }) {
  const up = pct > 0;
  const good = pct === 0 ? null : costLike ? !up : up;
  const Icon = pct === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ng-num", good === null ? "bg-white/5 text-text-muted" : good ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>
      <Icon className="size-3" />
      {up ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

const TONE_ICON: Record<string, string> = {
  neutral: "bg-white/5 text-text-muted",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
};

/**
 * KPI карт. `featured`: алтан хүрээтэй гол карт (дотор нь `spark` хуримтлагдсан дүнгийн sparkline); бусад нь хөх, баруун доод буланд
 * бүдэг outline дүрс. `delta`-г зөвхөн бодит харьцуулах өгөгдөлтэй үед өгнө.
 */
export function FinanceKpi({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
  featured = false,
  spark,
  delta,
  deltaCostLike,
  onClick,
}: {
  /** дарвал задлах (жагсаалт руу шилжинэ) */
  onClick?: () => void;
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  hint?: string;
  featured?: boolean;
  spark?: number[];
  delta?: number | null;
  deltaCostLike?: boolean;
}) {
  return (
    <div
      {...(onClick
        ? {
            role: "button",
            tabIndex: 0,
            title: "Дарж задлах",
            onClick,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            },
          }
        : {})}
      className={cn("ng-kpi relative min-w-0 overflow-hidden rounded-[17px] border p-4 transition-colors", onClick && "focus-ring cursor-pointer", featured ? "ng-glow-gold border-[rgba(255,213,107,0.55)] bg-[linear-gradient(150deg,#2a2208_0%,#0d1a36_55%,#061229_100%)]" : "border-[rgba(80,140,240,0.4)] bg-[linear-gradient(160deg,#0b1d3f_0%,#061229_100%)] hover:border-[rgba(255,213,107,0.4)]")}>
      {featured && spark && <Sparkline values={spark} className="absolute inset-x-0 bottom-0 h-[48%] w-full opacity-80" />}
      {!featured && <Icon aria-hidden strokeWidth={1} className="pointer-events-none absolute -bottom-3 -right-2 size-20 text-[rgba(100,160,255,0.16)]" />}
      <div className="relative flex items-start gap-3 max-sm:flex-col max-sm:gap-2">
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl border max-sm:size-9", featured ? "border-[rgba(255,213,107,0.5)] bg-[rgba(245,181,35,0.14)] text-[#ffd56b]" : cn("border-[rgba(80,140,240,0.3)]", TONE_ICON[tone]))}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-xs font-medium leading-tight text-text-muted">{label}</p>
          <p className={cn("ng-num mt-1 break-all font-semibold leading-tight", String(value).length > 13 ? "text-sm sm:text-[19px]" : "text-lg sm:text-[25px]", featured ? "ng-gold-text" : "text-text")}>{value}</p>
        </div>
      </div>
      <div className="relative mt-2 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
        {delta != null && <Delta pct={delta} costLike={deltaCostLike} />}
        {hint && <p className="text-[11px] leading-snug text-text-muted">{hint}</p>}
      </div>
    </div>
  );
}

/** Хүснэгтийн эхний байрны алтан дугаартай тэмдэг (1 нь алтан, 2-3 нь цэнхэр) */
export function RankBadge({ n }: { n: number }) {
  return (
    <span
      className={cn(
        "ng-num inline-flex size-6 items-center justify-center rounded-full border text-[11px] font-bold",
        n === 1 ? "border-[#ffd56b] bg-[linear-gradient(180deg,#ffd56b,#f5b523)] text-[#1b1403]" : n <= 3 ? "border-[rgba(255,213,107,0.55)] bg-[rgba(245,181,35,0.12)] text-[#ffd56b]" : "border-[rgba(80,140,240,0.4)] bg-[rgba(80,140,240,0.1)] text-text-muted"
      )}
    >
      {n}
    </span>
  );
}

/** Анхны эрэмбээр (өгөгдөл ирсэн дарааллаар) дугаарлах багана; хайлт, эрэмбэлэлтэд хамаарахгүй */
export function rankColumn<T>(data: readonly T[]): DataTableColumn<T> {
  const index = new Map<T, number>(data.map((r, i) => [r, i + 1]));
  return { key: "__rank", header: "#", accessor: (r) => index.get(r) ?? null, render: (r) => <RankBadge n={index.get(r) ?? 0} />, className: "w-10" };
}

/** Шүүлтүүрийн dropdown (загварт тохирсон) */
export function FilterSelect({ value, onChange, label, options, icon: Icon }: { value: string; onChange: (v: string) => void; label: string; options: { value: string; label: string }[]; icon?: LucideIcon }) {
  return (
    <label className="ng-panel relative flex h-10 min-w-0 items-center gap-2 rounded-xl px-3 text-sm text-text max-sm:min-w-[45%] max-sm:flex-1">
      {Icon && <Icon className="size-4 shrink-0 text-text-muted" />}
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="focus-ring h-full min-w-0 max-w-[14rem] flex-1 appearance-none truncate bg-transparent pr-5 text-sm text-text outline-none [&>option]:bg-[#0b1d3f]">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 size-3.5 text-text-muted" viewBox="0 0 12 12" aria-hidden>
        <path d="M2 4.5 6 8l4-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

export type ViewMode = "chart" | "table";

/** «График / Хүснэгт» сэлгэгч: идэвхтэй нь алтан */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div role="group" aria-label="Харагдац" className="ng-panel inline-flex rounded-xl p-1">
      {(
        [
          ["chart", "График", BarChart3],
          ["table", "Хүснэгт", Table2],
        ] as const
      ).map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn("focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors", value === v ? "bg-[rgba(245,181,35,0.16)] text-[#ffd56b] shadow-[0_0_0_1px_rgba(255,213,107,0.5)_inset]" : "text-text-muted hover:text-text")}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Таб (tablist): идэвхтэй нь алтан. ViewToggle-тэй ижил загвар, дурын тоотой таб. */
export function SegmentedTabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: readonly { value: T; label: string; /** нарийн дэлгэц дээрх богино нэр */ shortLabel?: string; icon?: LucideIcon }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="ng-panel flex w-full gap-1 overflow-x-auto rounded-xl p-1 sm:w-fit">
      {tabs.map(({ value: v, label: text, shortLabel, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={cn("focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors max-sm:flex-1 max-sm:justify-center max-sm:px-2 whitespace-nowrap", value === v ? "bg-[rgba(245,181,35,0.16)] text-[#ffd56b] shadow-[0_0_0_1px_rgba(255,213,107,0.5)_inset]" : "text-text-muted hover:text-text")}
        >
          {Icon && <Icon className="size-4 max-sm:hidden" aria-hidden />}
          {shortLabel ? (
            <>
              <span className="sm:hidden">{shortLabel}</span>
              <span className="max-sm:hidden">{text}</span>
            </>
          ) : (
            text
          )}
        </button>
      ))}
    </div>
  );
}
