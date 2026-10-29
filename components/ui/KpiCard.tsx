import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-bg-elevated text-text-muted",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
};

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4 shadow-card transition-colors hover:border-accent/30">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted">{label}</p>
        <div className={cn("flex size-8 items-center justify-center rounded-lg", toneClasses[tone])}>
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-text">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}
