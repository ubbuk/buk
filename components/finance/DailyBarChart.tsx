"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "./FinanceShell";

export interface BarSeries {
  key: string;
  label: string;
  /** CSS өнгө, жишээ нь "rgb(var(--color-accent))" */
  color: string;
}

type Point = { date: string } & Record<string, number | string>;

const H = 220;
const PAD = { top: 12, right: 8, bottom: 24, left: 56 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

const compact = (v: number) => new Intl.NumberFormat("mn-MN", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/** Өдөр бүрийн багана график (inline SVG, theme-ийн өнгөтэй). Нэг буюу хоёр цуваа. */
export function DailyBarChart({
  data,
  series,
  label = (date) => date.slice(8),
  unit = "өдрөөр",
}: {
  data: Point[];
  series: BarSeries[];
  /** x тэнхлэгийн шошго: өдрөөр "2026-11-05" -> "05"; сараар `(d) => d.slice(5)` */
  label?: (date: string) => string;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // Card-ийн өргөнийг дүүргэнэ; өдөр олонтой, нарийн дэлгэц дээр гүйлгэнэ
  const W = Math.max(boxW, data.length * (series.length * 8 + 6) + PAD.left + PAD.right, 320);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(18, (slot - 4) / series.length);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="space-y-2">
      {series.length > 1 && (
        <div className="flex gap-4 text-xs text-text-muted">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div ref={box} className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block"
          role="img"
          aria-label={series.map((s) => s.label).join(", ") + " " + unit}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="rgb(var(--color-border))" strokeWidth={1} opacity={0.6} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="rgb(var(--color-text-muted))">
                {compact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = PAD.left + i * slot + (slot - barW * series.length) / 2;
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)}>
                {hover === i && (
                  <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="rgb(var(--color-bg-elevated))" opacity={0.6} />
                )}
                {series.map((s, k) => {
                  const v = Number(d[s.key]) || 0;
                  const top = y(Math.max(v, 0));
                  const hgt = Math.max(0, PAD.top + plotH - top);
                  return (
                    <rect key={s.key} x={x0 + k * barW} y={top} width={Math.max(barW - 1, 1)} height={hgt} rx={Math.min(3, barW / 2)} fill={s.color} />
                  );
                })}
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                {(data.length <= 16 || i % Math.ceil(data.length / 16) === 0) && (
                  <text x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="rgb(var(--color-text-muted))">
                    {label(d.date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {h && hover != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-border bg-bg-surface px-3 py-2 text-xs shadow-card"
            style={{ left: Math.min(PAD.left + hover * slot + slot, W - 170) }}
          >
            <p className="font-medium text-text">{h.date}</p>
            {series.map((s) => (
              <p key={s.key} className="mt-0.5 flex items-center gap-1.5 text-text-muted">
                <span className="size-2 rounded-sm" style={{ background: s.color }} />
                {s.label}: <span className="text-text">{money(Number(h[s.key]) || 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
