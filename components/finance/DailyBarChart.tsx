"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatAxisValue } from "@/lib/money-short";
import { money } from "./FinanceShell";

export interface BarSeries {
  key: string;
  label: string;
  /** CSS өнгө, жишээ нь "rgb(var(--color-accent))" */
  color: string;
}

type Point = { date: string } & Record<string, number | string>;

const H = 230;
const PAD = { top: 14, right: 8, bottom: 26, left: 72 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

const compact = formatAxisValue; // «40 тэрбум», «250 сая» (өмнө нь «40B»)

/** Алтан (accent) цуваа нь алтан градиент, бусад нь өөрийн өнгөний градиент */
const isGold = (color: string) => color.includes("--color-accent");

/**
 * Багана график (inline SVG, «Navy Gold» загвар): алтан градиент багана, hover tooltip (огноо, дүн, заавал биш баримтын тоо).
 * Нэг буюу хоёр цуваа.
 */
export function DailyBarChart({
  data,
  series,
  label = (date) => date.slice(8),
  unit = "өдрөөр",
  countKey,
  countLabel = "Баримт",
  tooltipTitle = (date) => date,
}: {
  data: Point[];
  series: BarSeries[];
  /** x тэнхлэгийн шошго: өдрөөр "2026-11-05" -> "05"; сараар `(d) => d.slice(5)` */
  label?: (date: string) => string;
  unit?: string;
  /** tooltip-д харуулах тооны талбар (жишээ нь баримтын тоо) */
  countKey?: string;
  countLabel?: string;
  tooltipTitle?: (date: string) => string;
}) {
  const gid = useId();
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
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={series.map((s) => s.label).join(", ") + " " + unit} onMouseLeave={() => setHover(null)}>
          <defs>
            {series.map((s, si) => (
              <linearGradient key={s.key} id={`${gid}-g${si}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={isGold(s.color) ? "#ffd56b" : s.color} />
                <stop offset="1" stopColor={isGold(s.color) ? "#f5b523" : s.color} stopOpacity={isGold(s.color) ? 0.78 : 0.55} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="rgba(100,150,240,0.18)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "3 5"} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="rgb(var(--color-text-muted))">
                {compact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = PAD.left + i * slot + (slot - barW * series.length) / 2;
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)}>
                {hover === i && <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="rgba(80,140,240,0.1)" />}
                {series.map((s, k) => {
                  const v = Number(d[s.key]) || 0;
                  const top = y(Math.max(v, 0));
                  const hgt = Math.max(0, PAD.top + plotH - top);
                  return (
                    <rect
                      key={s.key}
                      x={x0 + k * barW}
                      y={top}
                      width={Math.max(barW - 1, 1)}
                      height={hgt}
                      rx={Math.min(3, barW / 2)}
                      fill={`url(#${gid}-g${k})`}
                      style={hover === i && isGold(s.color) ? { filter: "drop-shadow(0 0 6px rgba(245,181,35,0.7))" } : undefined}
                    />
                  );
                })}
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                {(data.length <= 16 || i % Math.ceil(data.length / 16) === 0) && (
                  <text x={PAD.left + i * slot + slot / 2} y={H - 7} textAnchor="middle" fontSize={11} fill="rgb(var(--color-text-muted))">
                    {label(d.date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {h && hover != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-xl border border-[rgba(255,213,107,0.35)] bg-[#081733]/95 px-3 py-2 text-xs shadow-[0_8px_30px_-8px_rgba(40,110,240,0.7)] backdrop-blur"
            style={{ left: Math.min(PAD.left + hover * slot + slot, W - 190) }}
          >
            <p className="font-medium text-text">{tooltipTitle(h.date)}</p>
            {series.map((s) => (
              <p key={s.key} className="mt-1 flex items-center gap-1.5 text-text-muted">
                <span className="size-2 rounded-sm" style={{ background: isGold(s.color) ? "#f5b523" : s.color }} />
                {s.label}: <span className="ng-num font-semibold text-text">{money(Number(h[s.key]) || 0)}</span>
              </p>
            ))}
            {countKey && h[countKey] != null && (
              <p className="mt-1 text-text-muted">
                {countLabel}: <span className="ng-num font-semibold text-text">{Number(h[countKey]) || 0}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
