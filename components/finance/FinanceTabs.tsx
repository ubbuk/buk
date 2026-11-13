"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSession } from "next-auth/react";
import { TAB_LABELS, canViewTab, FINANCE_TABS } from "@/lib/onec/roles";
import { ODATA_ROLES } from "@/lib/onec-odata/roles";
import { cn } from "@/lib/utils";

// Нэг «1С» цэсийн табууд: Агуулах, Борлуулалт, Зарцуулалт, Зардал, Мөнгөн хөрөнгө (+ ADMIN-д «Хөтөч»).
// Сонгосон сар (?ym=) таб солиход хадгалагдана. Нярав зөвхөн Агуулах, Зарцуулалт. Эрхийг энд зөвхөн нуух зорилгоор ашиглана: хуудас, API бүр сервер дээр өөрөө шалгана.
const ORDER = ["stock", "sales", "usage", "receivables", "expenses", "cash"] as const satisfies readonly (typeof FINANCE_TABS)[number][];

function Tabs() {
  const pathname = usePathname();
  const ym = useSearchParams().get("ym");
  const q = ym ? `?ym=${encodeURIComponent(ym)}` : "";
  const { data: session } = useSession();
  const role = session?.user?.role;
  const tabs = [
    ...ORDER.filter((t) => canViewTab(role, t)).map((t) => ({ href: `/finance/${t}${q}`, label: TAB_LABELS[t] })),
    ...(role && ODATA_ROLES.includes(role) ? [{ href: `/onec${q}`, label: "Хөтөч" }] : []),
  ];
  if (tabs.length === 0) return null;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="1С">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={pathname === t.href.split("?")[0] ? "page" : undefined}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors max-md:min-h-11",
            pathname === t.href.split("?")[0] ? "border-accent font-medium text-text" : "border-transparent text-text-muted hover:text-text"
          )}
        >
          {t.label}
        </Link>
      ))}
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
