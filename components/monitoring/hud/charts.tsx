import { useEffect, useState, type ReactNode } from "react";
import type { DailyCount } from "@/lib/monitoring/types";

export interface DonutSegment {
  label: string;
  value: number;
  /** CSS color, normally an rgb(var(--token)) expression. */
  color: string;
}

const R = 44;
const C = 2 * Math.PI * R;

// Static SVG ring; no animation loop, so it costs nothing between data refreshes.
export function Donut({ segments, center, label }: { segments: DonutSegment[]; center: ReactNode; label: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  let offset = 0;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[150px]" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgb(var(--color-border) / 0.55)" strokeWidth="13" />
        {total > 0 &&
          segments.map((s) => {
            if (s.value <= 0) return null;
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.label}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="13"
                strokeDasharray={`${Math.max(0, len - (segments.filter((x) => x.value > 0).length > 1 ? 2 : 0))} ${C}`}
                strokeDashoffset={-offset}
                style={{ transition: "stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease" }}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; value: string | number; color: string }[] }) {
  return (
    <ul className="space-y-1.5 text-xs">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: i.color }} />
          <span className="min-w-0 flex-1 truncate text-text-muted">{i.label}</span>
          <span className="font-medium tabular-nums text-text">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}

const W = 300;
const H = 150;
const PAD = { l: 22, r: 14, t: 18, b: 22 };
const COL_W = 20;
const DX = 7;
const DY = 5;

function niceMax(n: number) {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / pow) * pow;
}

// 2.5D metallic columns (SVG, no WebGL): front face, lit top and shaded side.
// Heights are the real per-day order counts; a day without orders draws no column.
export function ColumnChart({ days, selected, onSelect }: { days: DailyCount[]; selected: string; onSelect: (day: string) => void }) {
  const max = niceMax(Math.max(1, ...days.map((d) => d.count)));
  const plotH = H - PAD.t - PAD.b;
  const slot = (W - PAD.l - PAD.r) / Math.max(1, days.length);
  const base = H - PAD.b;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label="Сүүлийн 7 хоногийн шинэ захиалга">
      <defs>
        <linearGradient id="mh-col-front" x1="0" x2="1">
          <stop offset="0" stopColor="#6b7481" />
          <stop offset="0.45" stopColor="#4a525d" />
          <stop offset="1" stopColor="#343a43" />
        </linearGradient>
        <linearGradient id="mh-col-front-sel" x1="0" x2="1">
          <stop offset="0" stopColor="#f7b33a" />
          <stop offset="0.5" stopColor="#d98a0b" />
          <stop offset="1" stopColor="#a8670a" />
        </linearGradient>
      </defs>
      {[0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.l} x2={W - PAD.r} y1={base - f * plotH} y2={base - f * plotH} stroke="rgb(var(--color-border) / 0.4)" strokeDasharray="2 5" />
          <text x={PAD.l - 5} y={base - f * plotH + 3} textAnchor="end" fontSize="8" fill="rgb(var(--color-text-muted))">
            {Number.isInteger(max * f) ? max * f : (max * f).toFixed(1)}
          </text>
        </g>
      ))}
      {/* floor slab */}
      <polygon points={`${PAD.l},${base} ${PAD.l + DX},${base - DY} ${W - PAD.r + DX},${base - DY} ${W - PAD.r},${base}`} fill="rgb(var(--color-bg-elevated))" opacity="0.7" />
      <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} stroke="rgb(var(--color-border))" />
      {days.map((d, i) => {
        const x = PAD.l + i * slot + (slot - COL_W) / 2;
        const h = (d.count / max) * plotH;
        const y = base - h;
        const sel = d.day === selected;
        return (
          <g
            key={d.day}
            role="button"
            tabIndex={0}
            aria-pressed={sel}
            aria-label={`${d.day}: ${d.count} захиалга`}
            className="mh-col"
            onClick={() => onSelect(d.day)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(d.day);
              }
            }}
          >
            <rect x={x - 3} y={PAD.t - 6} width={COL_W + DX + 6} height={H - PAD.t + 2} fill="transparent" />
            {d.count > 0 && (
              <g className="mh-col-body" style={{ animationDelay: `${i * 55}ms` }}>
                <rect x={x} y={y} width={COL_W} height={h} fill={sel ? "url(#mh-col-front-sel)" : "url(#mh-col-front)"} />
                <polygon points={`${x + COL_W},${y} ${x + COL_W + DX},${y - DY} ${x + COL_W + DX},${base - DY} ${x + COL_W},${base}`} fill={sel ? "#7c4c08" : "#262b32"} />
                <polygon points={`${x},${y} ${x + DX},${y - DY} ${x + COL_W + DX},${y - DY} ${x + COL_W},${y}`} fill={sel ? "#ffd27a" : "#8a93a0"} />
                <rect x={x} y={y} width={1.2} height={h} fill="#ffffff" opacity="0.18" />
              </g>
            )}
            <text x={x + (COL_W + DX) / 2} y={(d.count > 0 ? y - DY : base - DY) - 4} textAnchor="middle" fontSize="9" fontWeight={sel ? 700 : 500} fill={sel ? "rgb(var(--color-accent))" : "rgb(var(--color-text-muted))"}>
              {d.count}
            </text>
            <text x={x + COL_W / 2 + 2} y={H - 7} textAnchor="middle" fontSize="8" fill={sel ? "rgb(var(--color-text))" : "rgb(var(--color-text-muted))"}>
              {d.day.slice(5).replace("-", "/")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const TICKS = Array.from({ length: 48 }, (_, i) => i);
const RING_R = 40;
const RING_C = 2 * Math.PI * RING_R;

// Layered mechanical ring: metal bezel, tick dial, recessed track, animated
// arcs and a domed centre. Arcs grow from zero on mount and glide on updates.
export function MechRing({ segments, center, label }: { segments: DonutSegment[]; center: ReactNode; label: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const total = segments.reduce((n, s) => n + s.value, 0);
  const live = segments.filter((s) => s.value > 0).length;
  let offset = 0;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[170px]" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" className="size-full">
        <defs>
          <linearGradient id="mh-bezel" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#7d8693" />
            <stop offset="0.5" stopColor="#3a4048" />
            <stop offset="1" stopColor="#1d2126" />
          </linearGradient>
          <radialGradient id="mh-dome" cx="0.4" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#3b424b" />
            <stop offset="1" stopColor="#14171b" />
          </radialGradient>
        </defs>
        <circle cx="60" cy="60" r="57" fill="none" stroke="url(#mh-bezel)" strokeWidth="4" />
        <circle cx="60" cy="60" r="54.2" fill="#101316" />
        {TICKS.map((i) => (
          <line key={i} x1="60" y1="7.5" x2="60" y2={i % 4 === 0 ? 11.5 : 9.5} stroke="rgb(var(--color-text-muted))" strokeOpacity={i % 4 === 0 ? 0.6 : 0.28} strokeWidth="0.8" transform={`rotate(${(i * 360) / TICKS.length} 60 60)`} />
        ))}
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r={RING_R} fill="none" stroke="#0a0c0e" strokeWidth="12" />
          <circle cx="60" cy="60" r={RING_R} fill="none" stroke="rgb(var(--color-border) / 0.55)" strokeWidth="9.5" />
          {total > 0 &&
            segments.map((s) => {
              if (s.value <= 0) return null;
              const len = (s.value / total) * RING_C;
              const el = (
                <circle
                  key={s.label}
                  className="mh-arc"
                  cx="60"
                  cy="60"
                  r={RING_R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="9.5"
                  strokeDasharray={`${ready ? Math.max(0, len - (live > 1 ? 1.6 : 0)) : 0} ${RING_C}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
        </g>
        <circle cx="60" cy="60" r="31" fill="url(#mh-dome)" stroke="#000" strokeOpacity="0.5" />
        <circle cx="60" cy="60" r="31" fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}
