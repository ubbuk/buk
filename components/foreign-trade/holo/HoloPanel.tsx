import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import s from "./holo.module.css";

/**
 * The angular glass panel of the foreign trade detail page (page-scoped styling, see holo.module.css). It only frames its
 * children: titles, actions and content stay with the callers.
 */
export function HoloPanel({
  id,
  title,
  icon,
  actions,
  tone = "cyan",
  iconTone = "amber",
  scan = false,
  className,
  bodyClassName,
  children,
}: {
  id?: string;
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  tone?: "cyan" | "amber";
  iconTone?: "amber" | "cyan";
  scan?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn(s.panelWrap, id && "scroll-mt-24", className)}>
      <div className={cn(s.panel, tone === "amber" && s.panelAmber)}>
        <div className={cn(s.panelInner, scan && s.scan)}>
          {(title || actions) && (
            <header className={s.panelHead}>
              <h3 className={s.panelTitle}>
                {icon && <span className={cn(s.iconTile, iconTone === "cyan" && s.iconTileCyan)}>{icon}</span>}
                <span className="min-w-0">{title}</span>
              </h3>
              {actions && <div className={s.panelActions}>{actions}</div>}
            </header>
          )}
          <div className={cn(s.panelBody, bodyClassName)}>{children}</div>
        </div>
      </div>
    </section>
  );
}

/** Empty state with the reference's illustration on the left (a real image asset) and a message on the right. */
export function HoloEmpty({ art, icon, title, children }: { art: "chart" | "chat"; icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <div className={cn(s.emptyArt, art === "chart" ? s.emptyChart : s.emptyChat)} aria-hidden="true" />
      <span className={s.emptyIcon}>{icon}</span>
      <div className="min-w-0">
        <p className={s.emptyTitle}>{title}</p>
        {children && <p className={s.emptyText}>{children}</p>}
      </div>
    </div>
  );
}
