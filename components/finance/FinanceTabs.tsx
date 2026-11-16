"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSession } from "next-auth/react";
import { BarChart3, Compass, Coins, Package, Receipt, ShoppingCart, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TAB_LABELS, canViewTab, FINANCE_TABS } from "@/lib/onec/roles";
import { ODATA_ROLES } from "@/lib/onec-odata/roles";
import { cn } from "@/lib/utils";

// Нэг «1С» цэсийн табууд: Агуулах, Борлуулалт, Зарцуулалт, Авлага, Зардал, Мөнгөн хөрөнгө (+ ADMIN-д «Хөтөч»).
// Сонгосон сар (?ym=) таб солиход хадгалагдана. Нярав зөвхөн Агуулах, Зарцуулалт. Эрхийг энд зөвхөн нуух зорилгоор ашиглана: хуудас, API бүр сервер дээр өөрөө шалгана.
const ORDER = ["stock", "sales", "usage", "receivables", "expenses", "cash"] as const satisfies readonly (typeof FINANCE_TABS)[number][];

const ICONS: Record<(typeof ORDER)[number], LucideIcon> = {
  stock: Package,
  sales: ShoppingCart,
  usage: Coins,
  receivables: Receipt,
  expenses: BarChart3,
  cash: Wallet,
};

function Tabs() {
  const pathname = usePathname();
  const ym = useSearchParams().get("ym");
  const q = ym ? `?ym=${encodeURIComponent(ym)}` : "";
  const { data: session } = useSession();
  const role = session?.user?.role;
  const tabs = [
    ...ORDER.filter((t) => canViewTab(role, t)).map((t) => ({ href: `/finance/${t}${q}`, label: TAB_LABELS[t], icon: ICONS[t] })),
    ...(role && ODATA_ROLES.includes(role) ? [{ href: `/onec${q}`, label: "Хөтөч", icon: Compass }] : []),
  ];
  if (tabs.length === 0) return null;
  return (
    <nav className="ng-panel flex gap-1 overflow-x-auto rounded-2xl p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="1С">
      {tabs.map((t) => {
        const active = pathname === t.href.split("?")[0];
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2 text-sm transition-colors max-md:min-h-11",
              active
                ? "border-[rgba(255,213,107,0.6)] bg-[linear-gradient(180deg,rgba(245,181,35,0.2),rgba(245,181,35,0.06))] font-medium text-[#ffd56b] shadow-[0_0_20px_-4px_rgba(245,181,35,0.6)]"
                : "border-transparent text-text-muted hover:bg-white/5 hover:text-text"
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function FinanceTabs() {
  return (
    <Suspense fallback={null}>
      <Tabs />
    </Suspense>
  );
}
