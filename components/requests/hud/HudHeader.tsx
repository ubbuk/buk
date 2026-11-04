import Image from "next/image";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { HudPanel } from "./HudPanel";

// Decorative facility art sits behind the title (aria-hidden, not interactive).
export function HudHeader({
  title,
  subtitle,
  dateLabel,
  statusLabel,
  urgent,
}: {
  title: string;
  subtitle: string;
  dateLabel: string;
  statusLabel: string;
  urgent?: boolean;
}) {
  return (
    <HudPanel chamfer={18} innerClassName="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-full sm:w-[78%] lg:w-[72%] [mask-image:linear-gradient(90deg,transparent_0%,rgba(0,0,0,0.55)_22%,#000_48%)] [-webkit-mask-image:linear-gradient(90deg,transparent_0%,rgba(0,0,0,0.55)_22%,#000_48%)]"
      >
        <Image
          src="/images/industrial-facility-hero.webp"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 60vw, 100vw"
          className="object-cover object-[62%_42%] brightness-110 contrast-110 saturate-110"
        />
        {/* cinematic grade: cool top light, dark floor, amber horizon accent */}
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(54,201,244,0.10)] via-transparent to-[rgba(6,16,24,0.55)]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[rgba(255,170,0,0.7)] to-transparent" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(54,201,244,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(54,201,244,0.06)_1px,transparent_1px)] [background-size:24px_24px]"
      />

      <div className="relative flex min-h-[150px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:min-h-[168px] sm:px-6">
        <div className="flex items-center gap-4">
          <span aria-hidden className="h-14 w-4 -skew-x-[22deg] rounded-[2px] bg-gradient-to-b from-[#ffc13d] to-[#e08a00] shadow-[0_0_14px_rgba(255,170,0,0.5)]" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">Хангамжийн систем</p>
            <h1 className="text-2xl font-bold leading-tight text-text [text-shadow:0_2px_14px_rgba(0,0,0,0.7)] sm:text-[2rem]">{title}</h1>
            <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <HudPanel chamfer={8} innerClassName="flex items-center justify-between gap-6 px-4 py-2">
            <span className="text-sm text-text-muted">Огноо</span>
            <span className="flex items-center gap-2 text-sm font-semibold tabular-nums text-text">
              <CalendarDays className="size-4 text-tech" />
              <span suppressHydrationWarning>{dateLabel}</span>
            </span>
          </HudPanel>
          <HudPanel chamfer={8} innerClassName="flex items-center justify-between gap-6 px-4 py-2">
            <span className="text-sm text-text-muted">Төлөв</span>
            <span
              className={cn(
                "rounded-full px-4 py-0.5 text-sm font-semibold",
                urgent ? "bg-danger/20 text-danger" : "bg-accent/25 text-accent"
              )}
            >
              {urgent ? "Яаралтай" : statusLabel}
            </span>
          </HudPanel>
        </div>
      </div>
    </HudPanel>
  );
}
