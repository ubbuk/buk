"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Monitoring (live) and Time Machine (historical replay) share one section:
// same guard, same data layer (lib/monitoring, parameterised by `asOf`), one
// tab bar. A new tab here + a page under app/(app)/admin/monitoring/ is all a
// further view needs.
const TABS = [
  { href: "/admin/monitoring", label: "Мониторинг (одоо)" },
  { href: "/admin/monitoring/time-machine", label: "Time Machine" },
] as const;

export function MonitoringTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Мониторингийн хэсгүүд" className="flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring -mb-px border-b-2 px-4 py-2 text-sm transition-colors",
              active ? "border-accent font-medium text-text" : "border-transparent text-text-muted hover:text-text"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
