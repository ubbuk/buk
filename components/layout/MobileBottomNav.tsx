"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Home, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { resolveNavItems, type NavItem } from "@/lib/nav";
import { useRequestStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Preference order for the 3 slots next to Home -- the rest fold into "Бусад".
const PRIMARY_ORDER = ["/requests/new", "/requests", "/approvals", "/warehouses", "/accounting"];

export function MobileBottomNav() {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();
  const requests = useRequestStore((s) => s.requests);

  const badgeCounts: Record<string, number> = {
    approvals: requests.filter((r) => r.approvalSteps.some((s) => s.status === "PENDING" && s.type !== "WAREHOUSE_CHECK")).length,
    accounting: requests.filter((r) => r.status === "PENDING_ACCOUNTING").length,
  };

  const navItems = resolveNavItems(session?.user?.role);
  const primary = PRIMARY_ORDER.map((href) => navItems.find((i) => i.href === href))
    .filter((i): i is NavItem => !!i)
    .slice(0, 3);
  const primaryHrefs = new Set(primary.map((i) => i.href));
  const rest = navItems.filter((i) => !primaryHrefs.has(i.href));

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-bg-sidebar/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Link
        href="/dashboard"
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium",
          isActive("/dashboard") ? "text-tech" : "text-text-muted"
        )}
      >
        <Home className="size-5" />
        Нүүр
      </Link>

      {primary.map((item) => {
        const Icon = item.icon;
        const badge = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium",
              isActive(item.href) ? "text-tech" : "text-text-muted"
            )}
          >
            <Icon className="size-5" />
            {item.label}
            {badge > 0 && (
              <span className="absolute right-1/4 top-1 flex size-3.5 items-center justify-center rounded-full bg-danger text-[8px] font-semibold text-white">
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </Link>
        );
      })}

      {rest.length > 0 && (
        <div ref={moreRef} className="relative flex flex-1">
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium",
              moreOpen ? "text-tech" : "text-text-muted"
            )}
          >
            <MoreHorizontal className="size-5" />
            Бусад
          </button>

          <AnimatePresence>
            {moreOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.14 }}
                className="absolute bottom-full right-0 mb-2 w-56 overflow-hidden rounded-xl border border-border bg-bg-surface p-1.5 shadow-elevated"
              >
                {rest.map((item) => {
                  const Icon = item.icon;
                  const badge = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                        isActive(item.href) ? "bg-tech/10 text-tech" : "text-text-muted hover:bg-bg-elevated hover:text-text"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {badge > 0 && (
                        <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          {badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </nav>
  );
}
