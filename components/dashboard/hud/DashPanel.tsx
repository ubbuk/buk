import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import "./dashboard-hud.css";

export type DashTone = "cyan" | "amber" | "red";

// Chamfered HUD frame used by the four dashboard panels (styles in dashboard-hud.css).
export function DashPanel({
  tone = "cyan",
  icon: Icon,
  title,
  stripes,
  right,
  className,
  bodyClassName,
  children,
}: {
  tone?: DashTone;
  icon: LucideIcon;
  title: string;
  stripes?: boolean;
  right?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("dh-shell", tone === "amber" && "dh-shell--amber", tone === "red" && "dh-shell--red", className)}>
      <div className="dh-panel">
        <div className="dh-inner">
          <header className="dh-head">
            <Icon className="dh-head-icon size-7 shrink-0" strokeWidth={1.75} aria-hidden />
            <h3 className="dh-title">{title}</h3>
            {stripes && <span className="dh-stripes" aria-hidden />}
            {right}
          </header>
          <div className={cn("dh-body", bodyClassName)}>{children}</div>
        </div>
      </div>
    </section>
  );
}
