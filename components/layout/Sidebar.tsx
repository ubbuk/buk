"use client";

import { cn } from "@/lib/utils";
import {
  Archive,
  BarChart3,
  Boxes,
  ChevronsLeft,
  ClipboardCheck,
  FilePlus2,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShoppingCart,
  Factory,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useRequestStore } from "@/lib/store";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Хяналтын самбар", icon: LayoutDashboard },
  { href: "/requests/new", label: "Шинэ захиалга", icon: FilePlus2 },
  { href: "/requests", label: "Миний захиалгууд", icon: ListChecks },
  { href: "/approvals", label: "Батлах хүсэлтүүд", icon: ClipboardCheck, badgeKey: "approvals" },
  { href: "/warehouse", label: "Агуулахын шалгалт", icon: Boxes, badgeKey: "warehouse" },
  { href: "/procurement", label: "Худалдан авалт", icon: ShoppingCart },
  { href: "/archive", label: "Захиалгын архив", icon: Archive },
  { href: "/reports", label: "Тайлан", icon: BarChart3 },
  { href: "/settings", label: "Тохиргоо", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const requests = useRequestStore((s) => s.requests);

  const badgeCounts: Record<string, number> = {
    approvals: requests.filter(
      (r) => r.approvalSteps.some((s) => s.status === "PENDING" && s.type !== "WAREHOUSE_CHECK")
    ).length,
    warehouse: requests.filter((r) => r.status === "PENDING_WAREHOUSE_CHECK").length,
  };

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-bg-sidebar transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-64"
      )}
    >
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Factory className="size-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 animate-fade-in">
            <p className="truncate text-sm font-semibold text-text">УБ БҮК ХК</p>
            <p className="truncate text-[11px] text-text-muted">Худалдан авалтын систем</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
          const Icon = item.icon;
          const badge = "badgeKey" in item ? badgeCounts[item.badgeKey] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "focus-ring group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:bg-bg-elevated hover:text-text"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
              )}
              <Icon className="size-[18px] shrink-0" />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!collapsed && badge > 0 ? (
                <span className="rounded-full bg-bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-text-muted group-hover:text-text">
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text"
        >
          <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
          {!collapsed && "Хумих"}
        </button>
      </div>
    </aside>
  );
}
