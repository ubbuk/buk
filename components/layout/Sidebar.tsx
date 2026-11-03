"use client";

import { cn } from "@/lib/utils";
import {
  Archive,
  BarChart3,
  ChevronsLeft,
  ClipboardCheck,
  FilePlus2,
  ListChecks,
  Receipt,
  Settings,
  ShieldCheck,
  Factory,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { useRequestStore } from "@/lib/store";

const NAV_ITEMS = [
  { href: "/requests/new", label: "Шинэ захиалга", icon: FilePlus2 },
  { href: "/requests", label: "Миний захиалгууд", icon: ListChecks },
  { href: "/approvals", label: "Батлах хүсэлтүүд", icon: ClipboardCheck, badgeKey: "approvals" },
  { href: "/warehouses", label: "Агуулахын жагсаалт", icon: Warehouse },
  { href: "/archive", label: "Захиалгын архив", icon: Archive },
  { href: "/reports", label: "Тайлан", icon: BarChart3 },
  { href: "/settings", label: "Тохиргоо", icon: Settings },
] as const;

const ACCOUNTING_NAV_ITEM = { href: "/accounting", label: "Санхүүгийн бүртгэл", icon: Receipt, badgeKey: "accounting" } as const;
const ADMIN_NAV_ITEM = { href: "/admin", label: "Хэрэглэгч, эрх", icon: ShieldCheck } as const;

// EMPLOYEE only creates/tracks their own requests -- no approvals, archive, or
// reports to see, so their sidebar is trimmed to just these.
const EMPLOYEE_NAV_HREFS = new Set(["/requests/new", "/requests", "/warehouses", "/settings"]);

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);
  const requests = useRequestStore((s) => s.requests);

  const badgeCounts: Record<string, number> = {
    approvals: requests.filter(
      (r) => r.approvalSteps.some((s) => s.status === "PENDING" && s.type !== "WAREHOUSE_CHECK")
    ).length,
    accounting: requests.filter((r) => r.status === "PENDING_ACCOUNTING").length,
  };

  const role = session?.user?.role;
  let navItems: readonly { href: string; label: string; icon: typeof FilePlus2; badgeKey?: string }[] =
    role === "EMPLOYEE" ? NAV_ITEMS.filter((item) => EMPLOYEE_NAV_HREFS.has(item.href)) : NAV_ITEMS;
  if (role === "CHIEF_ACCOUNTANT" || role === "ADMIN") navItems = [...navItems, ACCOUNTING_NAV_ITEM];
  if (role === "ADMIN") navItems = [...navItems, ADMIN_NAV_ITEM];

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
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href);
          const Icon = item.icon;
          const badge = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
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
