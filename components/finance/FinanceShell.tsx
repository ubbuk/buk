"use client";

import { FinanceTabs } from "./FinanceTabs";
import { YmPicker } from "./useYm";
import { formatHm } from "./useOnecRefresh";

export const inputClass =
  "focus-ring h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";

/** Таб бүрийн нийтлэг хүрээ: гарчиг, «Сүүлд шинэчилсэн: HH:mm», «Шинэчлэх» товч, табууд */
export function FinanceShell({
  title,
  lastSyncedAt,
  refresh,
  controls,
  notice,
  withView,
  children,
}: {
  title: string;
  lastSyncedAt?: string | null;
  /** «Шинэчлэх» товч */
  refresh?: React.ReactNode;
  controls?: React.ReactNode;
  /** шинэчлэлтийн төлөв (баннер) */
  notice?: React.ReactNode;
  /** «Сар / Бүтэн жил» сонголт (Борлуулалт, Зардал) */
  withView?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">{title}</h1>
          <p className="mt-1 text-xs text-text-muted">{lastSyncedAt ? `Сүүлд шинэчилсэн: ${formatHm(lastSyncedAt)}` : "Сүүлд шинэчилсэн: —"}</p>
        </div>
        {refresh}
      </div>
      <FinanceTabs />
      <div className="flex flex-wrap items-center gap-2">
        <YmPicker withView={withView} />
        {controls}
      </div>
      {notice}
      {children}
    </div>
  );
}

/** DataTable-ийн тооны багана: толгой ба нүд хоёулаа баруун тийш */
export const NUM = "text-right [&>button]:ml-auto [&>button]:w-fit [&>span]:justify-end";

export function money(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 0 }).format(v) + "₮";
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}
