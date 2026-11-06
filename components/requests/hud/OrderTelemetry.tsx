import { Boxes, Building2, Coins, Factory, Layers, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { HudPanel } from "./HudPanel";

function Metric({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone?: "amber" }) {
  return (
    <HudPanel chamfer={10} className="min-w-0" innerClassName="flex items-center gap-3 px-3 py-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-tech/30 bg-tech/5 text-tech">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="hud-label block truncate max-sm:whitespace-normal max-sm:break-words">{label}</span>
        <span className={cn("block truncate max-sm:whitespace-normal max-sm:break-words text-xl font-semibold tabular-nums", tone === "amber" ? "text-accent" : "text-text")}>
          {value}
        </span>
      </span>
    </HudPanel>
  );
}

const R = 26;
const CIRCUMFERENCE = 2 * Math.PI * R;

// Every value is derived from the form's own state (MaterialRequestForm).
export function OrderTelemetry({
  directionLabel,
  isOffice,
  materialCount,
  totalQuantity,
  totalPriceLabel,
  priceKnown,
  progress,
}: {
  directionLabel: string;
  isOffice: boolean;
  materialCount: number;
  totalQuantity: string;
  totalPriceLabel: string;
  priceKnown: boolean;
  progress: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
      <HudPanel chamfer={14} innerClassName="flex items-center gap-4 px-4 py-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-accent/50 bg-accent/10 text-accent">
          {isOffice ? <Building2 className="size-7" /> : <Factory className="size-7" />}
        </span>
        <div className="min-w-0 flex-1">
          <span className="hud-label block">Захиалгын чиглэл</span>
          <div className="mt-1 flex h-10 items-center rounded-lg border border-tech/30 bg-bg/60 px-3 text-sm">
            <span className="font-semibold text-text">{directionLabel}</span>
            <span className="ml-1.5 truncate max-sm:whitespace-normal max-sm:break-words text-xs text-text-muted">(цехийн ангиллаар автоматаар тодорхойлогдоно)</span>
          </div>
        </div>
      </HudPanel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={Boxes} label="Материалын тоо" value={String(materialCount)} />
        <Metric icon={Layers} label="Нийт тоо хэмжээ" value={totalQuantity} />
        <Metric icon={Coins} label="Нийт үнийн дүн" value={totalPriceLabel} tone={priceKnown ? undefined : "amber"} />
        <HudPanel chamfer={10} innerClassName="flex items-center gap-3 px-3 py-2.5">
          <svg viewBox="0 0 64 64" className="size-14 shrink-0" role="img" aria-label={`Бөглөлтийн явц ${progress}%`}>
            <g transform="rotate(-90 32 32)">
              <circle cx="32" cy="32" r={R} fill="none" strokeWidth="5" className="stroke-tech/20" />
              <circle
                cx="32"
                cy="32"
                r={R}
                fill="none"
                strokeWidth="5"
                strokeLinecap="round"
                className="hud-ring-progress stroke-tech"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - progress / 100)}
              />
            </g>
            <text x="32" y="32" textAnchor="middle" dominantBaseline="central" className="fill-text text-[15px] font-semibold">
              {progress}%
            </text>
          </svg>
          <span className="hud-label">Бөглөлтийн явц</span>
        </HudPanel>
      </div>
    </div>
  );
}
