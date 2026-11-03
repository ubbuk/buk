"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import Crosshair from "@/components/ui/Crosshair";
import StrokeText from "@/components/ui/StrokeText";
import {
  BarChart3,
  ClipboardCheck,
  ListChecks,
  ShieldCheck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { resolveNavItems } from "@/lib/nav";
import { GROUND_Y, PAD_X, VB_H, VB_W, layoutPositions, renderStructure } from "@/components/dashboard/IndustrialScene";

// Clean environmental illustration -- no baked-in text, buttons or stats, so
// real holographic nav chips render on top of it (see HotspotChip below). If
// this file is ever removed, the hand-drawn SVG scene in IndustrialScene.tsx
// renders instead (onError below).
const HERO_IMAGE_SRC = "/images/industrial-facility-hero.webp";
// Actual pixel dimensions of the file above. The hero container is locked
// to this exact aspect ratio (height derives from width), so object-contain
// never has to crop anything -- the complete illustration is always shown,
// and plain percentage-of-image-pixel hotspot placement stays exact at any
// viewport width.
const HERO_IMAGE_W = 1672;
const HERO_IMAGE_H = 941;

// Hotspot байрлал (зургийн % координат, 0-100). ЭНД шууд тоогоо өөрчилж
// `npm run dev`-ээ refresh хийгээд үр дүнг харж болно:
//   leftPct: 0 = зургийн хамгийн зүүн ирмэг, 100 = хамгийн баруун ирмэг
//   topPct:  0 = хамгийн дээд ирмэг,         100 = хамгийн доод ирмэг
//   (тоог ИХЭСГЭВЭЛ ДООШ, БАГАСГАВАЛ ДЭЭШ/ЗҮҮН тийш шилжинэ)
const IMAGE_HOTSPOTS: Record<string, { leftPct: number; topPct: number }> = {
  "/admin": { leftPct: 13.8, topPct: 51.0 }, // Админ -- зүүн жижиг барилга
  "/warehouses": { leftPct: 41.9, topPct: 58.4 }, // Агуулах -- нээлттэй rack хаалга
  "/approvals": { leftPct: 56.8, topPct: 27.6 }, // Батлах төв -- дээврийн skylight
  "/requests": { leftPct: 73.6, topPct: 61.6 }, // Хангамж -- ачааны буудал
  "/reports": { leftPct: 82.5, topPct: 17.0 }, // Тайлан -- яндан/силос
};

export interface CommandCenterTile {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  badgeKey?: "pendingApproval" | "pendingAccounting";
}

// Kept in sync with lib/nav.ts's role gating (filtered by href below) so the
// Command Center never offers a zone the CommandBar/bottom-nav would hide.
export const COMMAND_CENTER_TILES: CommandCenterTile[] = [
  { href: "/requests", label: "Хангамжийн төв", short: "Хангамж", icon: ListChecks },
  { href: "/approvals", label: "Батлах төв", short: "Батлах", icon: ClipboardCheck, badgeKey: "pendingApproval" },
  { href: "/warehouses", label: "Агуулахын төв", short: "Агуулах", icon: Warehouse },
  { href: "/reports", label: "Тайлангийн төв", short: "Тайлан", icon: BarChart3 },
  { href: "/admin", label: "Удирдлагын төв", short: "Админ", icon: ShieldCheck },
];

// Fixed, hand-picked silhouette rectangles for the distant background skyline
// -- purely atmospheric, no data, just fills otherwise-empty upper space.
const SKYLINE = [
  { x: 40, w: 46, h: 70 },
  { x: 110, w: 30, h: 110 },
  { x: 165, w: 54, h: 60 },
  { x: 260, w: 36, h: 130 },
  { x: 330, w: 60, h: 80 },
  { x: 430, w: 28, h: 150 },
  { x: 520, w: 70, h: 65 },
  { x: 640, w: 34, h: 120 },
  { x: 710, w: 50, h: 85 },
  { x: 810, w: 30, h: 140 },
  { x: 880, w: 64, h: 70 },
  { x: 980, w: 36, h: 100 },
  { x: 1050, w: 56, h: 75 },
  { x: 1130, w: 32, h: 115 },
];


function HotspotChip({
  href,
  label,
  short,
  icon: Icon,
  badge,
  leftPct,
  topPct,
  delay,
}: {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  badge: number;
  leftPct: number;
  topPct: number;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
    >
      <Link
        href={href}
        aria-label={label}
        title={label}
        className="focus-ring group flex flex-col items-center gap-1.5 rounded-xl focus-visible:ring-tech/70"
      >
        {badge > 0 && (
          <span className="mb-0.5 rounded-md border border-accent/60 bg-bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-accent shadow-[0_0_14px_-2px_rgba(245,158,11,0.6)]">
            {badge}
          </span>
        )}
        <span
          className={`flex size-11 items-center justify-center rounded-xl border-2 bg-bg-surface shadow-[0_0_18px_-3px_rgba(34,211,238,0.7)] transition-transform group-hover:scale-110 group-hover:shadow-[0_0_24px_-2px_rgba(34,211,238,0.9)] ${
            badge > 0 ? "border-accent text-accent" : "border-tech text-tech"
          }`}
        >
          <Icon className="size-5" />
        </span>
        <span className="inline-block w-[74px] rounded border border-border bg-bg px-1 py-1 shadow-sm transition-colors group-hover:border-tech/60">
          <StrokeText
            text={short}
            trigger="hover"
            fillMode="wipe"
            wipeFrom="left"
            strokeColor="#22D3EE"
            fontSize={13}
            fontWeight={600}
            letterSpacing={0}
            drawDuration={0.6}
            fillDelay={0.05}
          />
        </span>
      </Link>
    </motion.div>
  );
}

export function IndustrialCommandCenter({
  role,
  kpis,
}: {
  role: string | undefined;
  kpis: { pendingApproval: number; pendingAccounting: number };
}) {
  const [imageOk, setImageOk] = useState(true);
  const heroRef = useRef<HTMLDivElement>(null);
  // Hero зураг болон 3D загвар бүх эрхэд адилхан харагдана; зөвхөн дээр нь
  // наалддаг hotspot цэгүүд нь session-ий (DB-с ирсэн) role-оор шүүгдэнэ, тул
  // ажилтан (EMPLOYEE) Санхүү/Админ/Тайлан/Батлах руу холбоос харахгүй.
  const allowedHrefs = new Set(resolveNavItems(role).map((i) => i.href));
  const tiles = COMMAND_CENTER_TILES.filter((t) => allowedHrefs.has(t.href));
  const positions = layoutPositions(tiles.length);
  const structures = tiles.map((tile, i) => {
    const attention = tile.badgeKey ? kpis[tile.badgeKey] > 0 : false;
    return { tile, attention, ...renderStructure(tile.href, positions[i], attention) };
  });

  return (
    <div className="min-w-0 space-y-3">
      {/* Desktop/tablet: compact facility hero (width-bound -- fills its grid
          column, height follows the image's own ratio via aspect-ratio --
          complete illustration, no crop, no stretch). Sits beside the KPI
          panel in a fluid two-column grid (see dashboard page), so it must
          shrink with the column rather than claim a fixed pixel width. */}
      <div
        ref={heroRef}
        className="relative hidden w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-bg-surface via-bg-surface to-bg md:block"
        style={{ aspectRatio: imageOk ? `${HERO_IMAGE_W} / ${HERO_IMAGE_H}` : `${VB_W} / ${VB_H}` }}
      >
        <Crosshair
          containerRef={heroRef}
          color="#22D3EE"
          thickness={1}
          opacity={0.8}
          smoothing={0.3}
          targetEffect="lock"
          targetSelector="a[href]"
          showCoordinates
          clickPulse
        />
        {imageOk && (
          <Image
            src={HERO_IMAGE_SRC}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-contain"
            onError={() => setImageOk(false)}
          />
        )}

        {!imageOk && (
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 size-full" aria-hidden="true">
            <defs>
              <radialGradient id="icc-glow" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
              </radialGradient>
              <pattern id="icc-grid" width="40" height="16" patternUnits="userSpaceOnUse" patternTransform={`translate(0 ${GROUND_Y})`}>
                <line x1="0" y1="8" x2="40" y2="8" stroke="#22D3EE" strokeOpacity="0.08" />
                <line x1="0" y1="0" x2="0" y2="16" stroke="#22D3EE" strokeOpacity="0.05" />
              </pattern>
            </defs>

            <rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#icc-glow)" />

            {/* distant skyline, low opacity, purely atmospheric */}
            <g opacity="0.1">
              {SKYLINE.map((b, i) => (
                <rect key={i} x={b.x} y={GROUND_Y - 70 - b.h} width={b.w} height={b.h} fill="#17242F" stroke="#22D3EE" strokeOpacity="0.3" />
              ))}
            </g>

            <rect x="0" y={GROUND_Y - 10} width={VB_W} height="90" fill="url(#icc-grid)" />
            <line x1={PAD_X - 60} y1={GROUND_Y + 4} x2={VB_W - PAD_X + 60} y2={GROUND_Y + 4} stroke="#22D3EE" strokeOpacity="0.2" />

            {structures.map((s) => (
              <g key={s.tile.href}>{s.node}</g>
            ))}
          </svg>
        )}

        <div className="absolute inset-0">
          {imageOk
            ? tiles.map((tile, i) => {
                const hs = IMAGE_HOTSPOTS[tile.href];
                if (!hs) return null;
                const badge = tile.badgeKey ? kpis[tile.badgeKey] : 0;
                return (
                  <HotspotChip
                    key={tile.href}
                    href={tile.href}
                    label={tile.label}
                    short={tile.short}
                    icon={tile.icon}
                    badge={badge}
                    leftPct={hs.leftPct}
                    topPct={hs.topPct}
                    delay={i * 0.05}
                  />
                );
              })
            : structures.map((s, i) => {
                const badge = s.tile.badgeKey ? kpis[s.tile.badgeKey] : 0;
                return (
                  <HotspotChip
                    key={s.tile.href}
                    href={s.tile.href}
                    label={s.tile.label}
                    short={s.tile.short}
                    icon={s.tile.icon}
                    badge={badge}
                    leftPct={(s.anchorX / VB_W) * 100}
                    topPct={(s.anchorY / VB_H) * 100}
                    delay={i * 0.05}
                  />
                );
              })}
        </div>
      </div>

      {/* Mobile: lightweight scrollable strip -- no SVG scene */}
      <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          const badge = tile.badgeKey ? kpis[tile.badgeKey] : 0;
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-bg-surface px-3 py-2.5"
            >
              <span className={`flex size-8 items-center justify-center rounded-lg ${badge > 0 ? "bg-accent/15 text-accent" : "bg-tech/10 text-tech"}`}>
                <Icon className="size-4" />
              </span>
              <span className="inline-block w-16">
                <StrokeText
                  text={tile.short}
                  trigger="mount"
                  fillMode="wipe"
                  wipeFrom="left"
                  strokeColor="#22D3EE"
                  fontSize={12}
                  fontWeight={500}
                  letterSpacing={0}
                  drawDuration={0.5}
                  fillDelay={0.05}
                />
              </span>
              {badge > 0 && (
                <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">{badge}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
