import type { LucideIcon } from "lucide-react";

const TONES = {
  amber: "255 174 0",
  cyan: "0 217 255",
  green: "0 223 130",
} as const;

// Empty-state illustration: a glowing holographic platform with a floating icon.
export function EmptyHologram({
  icon: Icon,
  tone,
  title,
  description,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONES;
  title: string;
  description: string;
}) {
  const c = TONES[tone];
  return (
    <div className="dh-empty">
      <div className="relative h-[150px] w-[260px]" aria-hidden>
        <svg viewBox="0 0 260 150" className="absolute inset-0 size-full">
          <defs>
            <linearGradient id={`beam-${tone}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={`rgb(${c})`} stopOpacity="0" />
              <stop offset="1" stopColor={`rgb(${c})`} stopOpacity="0.22" />
            </linearGradient>
            <radialGradient id={`floor-${tone}`}>
              <stop offset="0" stopColor={`rgb(${c})`} stopOpacity="0.55" />
              <stop offset="1" stopColor={`rgb(${c})`} stopOpacity="0" />
            </radialGradient>
          </defs>
          <path d="M92 118 L112 18 H148 L168 118 Z" fill={`url(#beam-${tone})`} />
          <ellipse cx="130" cy="122" rx="118" ry="20" fill="none" stroke={`rgb(${c})`} strokeOpacity="0.28" />
          <ellipse cx="130" cy="122" rx="92" ry="15" fill={`url(#floor-${tone})`} stroke={`rgb(${c})`} strokeOpacity="0.55" />
          <ellipse cx="130" cy="122" rx="62" ry="10" fill={`rgb(${c} / 0.18)`} stroke={`rgb(${c})`} strokeWidth="2" style={{ filter: `drop-shadow(0 0 6px rgb(${c}))` }} />
        </svg>
        <Icon
          className="dh-float absolute left-1/2 top-[6px] size-[92px] -translate-x-1/2"
          strokeWidth={1.1}
          style={{ color: `rgb(${c})`, filter: `drop-shadow(0 0 12px rgb(${c} / 0.75))` }}
        />
      </div>
      <p className="dh-empty-title">{title}</p>
      <p className="dh-empty-sub">{description}</p>
    </div>
  );
}
