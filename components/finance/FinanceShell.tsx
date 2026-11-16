"use client";

import type { LucideIcon } from "lucide-react";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinanceTabs } from "./FinanceTabs";
import { YmPicker } from "./useYm";

export const inputClass =
  "focus-ring h-9 max-w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";

const TZ = "Asia/Ulaanbaatar";

/** "2026.11.13 16:04" (Улаанбаатарын цагаар) */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replaceAll("-", ".");
}

/** Сүүлд амжилттай татсан цаг 30 минутаас дотор бол 1С холбогдсон гэж үзнэ (хуваарь 15 минут тутам); `offline` нь татаж чадаагүй */
export function connectionFrom(lastSyncedAt: string | null | undefined, offline = false, now = Date.now()): "ok" | "offline" | null {
  if (offline) return "offline";
  if (lastSyncedAt && now - new Date(lastSyncedAt).getTime() < 30 * 60_000) return "ok";
  return null;
}

/**
 * Таб бүрийн нийтлэг хүрээ («Navy Gold»): зүүн талд алтан дүрстэй хайрцаг, гарчиг, тайлбар; баруун талд 1С-ийн төлөв, сүүлд шинэчилсэн огноо,
 * «Шинэчлэх» товч. Доор нь табууд, сар сонгогч ба шүүлтүүрийн мөр. Зөвхөн харагдац: өгөгдөл, эрх нь хуудас, API-д.
 */
export function FinanceShell({
  title,
  subtitle,
  icon: Icon = Coins,
  lastSyncedAt,
  connection,
  refresh,
  controls,
  trailing,
  notice,
  withView,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  lastSyncedAt?: string | null;
  /** 1С-ийн төлөв: ok = «1С холбогдсон», offline = «1С холбогдохгүй», хоосон = нуух */
  connection?: "ok" | "offline" | null;
  /** «Шинэчлэх» товч */
  refresh?: React.ReactNode;
  /** сар сонгогчийн дараах шүүлтүүрүүд (dropdown) */
  controls?: React.ReactNode;
  /** шүүлтүүрийн мөрийн баруун тал (График / Хүснэгт сэлгэгч) */
  trailing?: React.ReactNode;
  /** шинэчлэлтийн төлөв (баннер) */
  notice?: React.ReactNode;
  /** «Сар / Бүтэн жил» сонголт (Борлуулалт, Зардал) */
  withView?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[rgba(255,213,107,0.5)] bg-[linear-gradient(160deg,rgba(245,181,35,0.22),rgba(245,181,35,0.04))] text-[#ffd56b] shadow-[0_0_24px_-6px_rgba(245,181,35,0.7)]">
            <Icon className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-text">{title}</h1>
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 max-sm:w-full max-sm:justify-between">
          {connection && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", connection === "ok" ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning")}>
              <span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
              {connection === "ok" ? "1С холбогдсон" : "1С холбогдохгүй"}
            </span>
          )}
          <div className="text-right text-[11px] leading-tight text-text-muted">
            <p>Сүүлд шинэчилсэн</p>
            <p className="ng-num mt-0.5 text-[13px] text-text">{formatStamp(lastSyncedAt)}</p>
          </div>
          {refresh}
        </div>
      </div>
      <FinanceTabs />
      <div className="flex flex-wrap items-center gap-2.5">
        <YmPicker withView={withView} />
        {controls}
        {trailing && <div className="ml-auto max-sm:w-full [&>div]:max-sm:w-full">{trailing}</div>}
      </div>
      {notice}
      {children}
    </div>
  );
}

/** DataTable-ийн тооны багана: толгой ба нүд хоёулаа баруун тийш, тоо нь JetBrains Mono */
export const NUM = "ng-num text-right [&>button]:ml-auto [&>button]:w-fit [&>span]:justify-end";

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
