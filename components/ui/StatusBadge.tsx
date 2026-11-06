import { cn } from "@/lib/utils";
import { REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, type RequestStatus } from "@/lib/types";

const toneClasses = {
  neutral: "bg-bg-elevated text-text-muted border-border",
  accent: "bg-accent/10 text-accent border-accent/30",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
} as const;

export function StatusBadge({ status, className }: { status: RequestStatus; className?: string }) {
  const tone = REQUEST_STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full max-sm:whitespace-normal border px-2.5 py-1 text-xs font-medium",
        toneClasses[tone],
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", {
        "bg-text-muted": tone === "neutral",
        "bg-accent": tone === "accent",
        "bg-success": tone === "success",
        "bg-warning": tone === "warning",
        "bg-danger": tone === "danger",
      })} />
      {REQUEST_STATUS_LABEL[status]}
    </span>
  );
}

export function DemoDataBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning",
        className
      )}
      title="Энэ дэлгэц одоогоор жишээ өгөгдөл ашиглаж байна — сервертэй холбогдоогүй"
    >
      Жишээ өгөгдөл
    </span>
  );
}
