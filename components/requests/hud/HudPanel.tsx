import { cn } from "@/lib/utils";

// Chamfered, edge-lit panel (styles in hud.css).
export function HudPanel({
  children,
  className,
  innerClassName,
  tone = "cyan",
  active,
  chamfer,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  tone?: "cyan" | "amber";
  active?: boolean;
  chamfer?: number;
}) {
  return (
    // The shell carries layout classes and the outer glow (drop-shadow would be
    // cut off by the clip-path on the panel itself).
    <div className={cn("hud-shell min-w-0", tone === "amber" && "hud-shell--amber", className)}>
      <div
        className={cn("hud-panel", tone === "amber" && "hud-panel--amber", active && "hud-panel--active")}
        style={chamfer ? ({ "--hud-c": `${chamfer}px` } as React.CSSProperties) : undefined}
      >
        <div className={cn("hud-panel__inner", innerClassName)}>{children}</div>
      </div>
    </div>
  );
}
