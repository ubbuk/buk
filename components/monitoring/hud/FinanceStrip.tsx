"use client";

import { AlertTriangle, Boxes, Receipt, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { formatCompactMnt, formatFullMnt } from "@/lib/format-mnt";
import type { FinanceOverview, OverviewKey } from "@/lib/onec/overview";
import { cn } from "@/lib/utils";
import { formatUB, formatUBTime } from "../format";
import { useLiveData } from "../useLiveData";

// «1С · Санхүүгийн тойм»: мониторингийн 30 сек-ийн цагтай хамт шинэчлэгдэнэ, гэхдээ өгөгдөл нь Postgres-ийн sync-ийнх (1С руу хандахгүй).
// Зөвхөн OVERVIEW_ROLES-д mount хийгдэнэ (MonitoringDashboard), API мөн сервер дээр шалгана.
const CARDS: Record<OverviewKey, { label: string; icon: LucideIcon; href: string; tone: "amber" | "green" | undefined; hint: (asOf: string) => string }> = {
  stock: { label: "Агуулахын үлдэгдэл", icon: Boxes, href: "/finance/stock", tone: undefined, hint: (d) => `${d}-ны байдлаар` },
  receivables: { label: "Авлага (1201)", icon: Receipt, href: "/finance/receivables", tone: "amber", hint: (d) => `${d}-ны байдлаар` },
  sales: { label: "Энэ сарын борлуулалт", icon: TrendingUp, href: "/finance/sales", tone: "green", hint: (m) => `${m.replace("-", " оны ")}-р сар` },
};

export function FinanceStrip({ tick, refresh }: { tick: number; refresh: () => void }) {
  const s = useLiveData<FinanceOverview>("/api/dashboard/overview", tick);
  const d = s.data;
  const updated = d?.updatedAt ? new Date(d.updatedAt) : null;
  const sameDay = updated ? formatUB(updated).slice(0, 10) === formatUB(new Date()).slice(0, 10) : false;

  return (
    <section aria-label="1С · Санхүүгийн тойм" className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-text-muted">1С · Санхүүгийн тойм</h3>
      {s.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">
          {s.error}
          {d ? " — өмнөх мэдээллийг харуулж байна " : " "}
          <button type="button" className="underline" onClick={refresh}>
            Дахин оролдох
          </button>
        </p>
      )}
      <div className={cn("grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-3", s.fetching && "opacity-80")}>
        {(Object.keys(CARDS) as OverviewKey[]).map((key) => {
          const c = CARDS[key];
          const card = d?.cards.find((x) => x.key === key);
          const value = card?.value ?? null;
          return (
            <Link key={key} href={c.href} data-testid={`finance-card-${key}`} className="mh-kpi focus-ring no-underline" title={value === null ? `${c.label}: өгөгдөл хараахан байхгүй` : `${c.label}: ${formatFullMnt(value)}`}>
              <span className="mh-kpi-icon" data-tone={c.tone}>
                <c.icon className="size-5" strokeWidth={1.7} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[11px] text-text-muted">{c.label}</p>
                <p className="truncate text-2xl font-semibold leading-tight tabular-nums text-text" data-testid={`finance-value-${key}`}>
                  {s.loading ? "…" : value === null ? "—" : formatCompactMnt(value)}
                </p>
                {card?.asOf && <p className="truncate text-[10px] text-text-muted">{c.hint(card.asOf)}</p>}
              </div>
            </Link>
          );
        })}
      </div>
      {d && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted" data-testid="finance-updated">
          <span>1С · шинэчилсэн {updated ? (sameDay ? formatUBTime(updated).slice(0, 5) : formatUB(updated)) : "—"}</span>
          {d.stale && (
            <span role="status" className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning" data-testid="finance-stale">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {d.staleMessage ?? "1С-ийн өгөгдөл хуучирсан байна."}
            </span>
          )}
        </p>
      )}
    </section>
  );
}
