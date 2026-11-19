"use client";

import { useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { StockItemGroup, StockItemLine, StockWarehouseView } from "@/lib/onec/stock-view";
import { cn } from "@/lib/utils";
import { Amount } from "@/components/finance/cash/Amount";
import { Qty, QtySum } from "@/components/finance/Qty";

const PAGE = 25; // нэг түвшинд эхэлж харуулах мөр; үлдсэнийг «цааш» товчоор

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-text-muted transition-transform", open && "rotate-90")} />;
}

/** Бараа: нэр · тоо хэмжээ нэгжтэй · ₮. Дарвал агуулахаар задарна («Цемент М400 · 30 тонн · 21.4 сая₮»). */
function ItemRow({ item, defaultOpen }: { item: StockItemLine; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 text-left hover:bg-white/[0.04] sm:flex-nowrap"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-1.5rem)]">
          <span className="block truncate text-sm text-text max-sm:whitespace-normal">{item.name}</span>
          {item.code && <span className="block truncate text-[11px] text-text-muted">{item.code}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 max-sm:ml-6 max-sm:w-[calc(100%-1.5rem)] max-sm:justify-between">
          {item.negative && <AlertTriangle aria-label="Хасах үлдэгдэлтэй" className="size-4 shrink-0 text-warning" />}
          <Qty qty={item.qty} unit={item.unit} className={cn("text-xs", item.qty < 0 ? "text-danger" : "text-text-muted")} />
          <Amount value={item.amount} className="w-24 text-right text-sm font-medium text-text max-sm:w-auto" />
        </span>
      </button>
      {open && (
        <ul className="mb-1 ml-8 space-y-0.5 border-l border-border pl-3">
          {item.warehouses.map((w) => (
            <li key={`${w.code}-${w.name}`} className="flex min-h-8 flex-wrap items-center gap-x-2 px-2 py-0.5 text-xs text-text-muted sm:flex-nowrap">
              <span className="min-w-0 flex-1 truncate max-sm:basis-full max-sm:whitespace-normal">{w.name}</span>
              <Qty qty={w.qty} unit={w.unit} className={cn("shrink-0", w.qty < 0 && "text-danger")} />
              <Amount value={w.amount} className="w-24 shrink-0 text-right max-sm:ml-auto max-sm:w-auto" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function More({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <button type="button" onClick={onMore} className="focus-ring mt-1 min-h-10 w-full rounded-lg px-3 text-left text-xs text-[#ffd56b] hover:underline">
      Цааш харуулах ({total - shown} бараа)
    </button>
  );
}

/** Барааны бүлэг → бараа → агуулах. Бүлгийн түвшинд тоо хэмжээ нэгж бүрээр тусдаа («48.5 тонн · 3,200 ширхэг»). */
export function StockGroups({ groups, expandAll }: { groups: StockItemGroup[]; expandAll: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});
  return (
    <div className="space-y-1 p-2 sm:p-3">
      {groups.map((g) => {
        const isOpen = expandAll || open === g.name;
        const limit = shown[g.name] ?? PAGE;
        return (
          <section key={g.name} className="rounded-xl border border-transparent hover:border-border">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen && !expandAll ? null : g.name)}
              className="focus-ring flex min-h-14 w-full items-center gap-2 rounded-xl px-2 py-2 text-left"
            >
              <Chevron open={isOpen} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text">{g.name}</span>
                <span className="block text-[11px] text-text-muted">
                  {g.items} бараа
                  {g.negative > 0 && <span className="ml-2 text-warning">⚠ {g.negative} хасах үлдэгдэл</span>}
                </span>
              </span>
              <QtySum quantities={g.quantities} className="max-w-[40%] shrink truncate text-right text-xs text-text-muted max-sm:hidden" />
              <Amount value={g.amount} className="w-28 shrink-0 text-right text-sm font-semibold text-text" />
            </button>
            {isOpen && (
              <div className="px-1 pb-2 sm:px-2">
                <p className="px-2 pb-1 text-[11px] text-text-muted sm:hidden">
                  Нийт: <QtySum quantities={g.quantities} className="!whitespace-normal" />
                </p>
                {g.list.slice(0, limit).map((i) => (
                  <ItemRow key={i.key} item={i} defaultOpen={expandAll && g.list.length <= 12} />
                ))}
                <More shown={limit} total={g.list.length} onMore={() => setShown((s) => ({ ...s, [g.name]: limit + PAGE * 2 }))} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Агуулахаар: агуулах → бараа (тоо, нэгж, ₮) */
export function StockWarehouses({ warehouses, expandAll }: { warehouses: StockWarehouseView[]; expandAll: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});
  return (
    <div className="space-y-1 p-2 sm:p-3">
      {warehouses.map((w) => {
        const isOpen = expandAll || open === w.code;
        const limit = shown[w.code] ?? PAGE;
        return (
          <section key={w.code} className="rounded-xl border border-transparent hover:border-border">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen && !expandAll ? null : w.code)}
              className="focus-ring flex min-h-14 w-full items-center gap-2 rounded-xl px-2 py-2 text-left"
            >
              <Chevron open={isOpen} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text">{w.name}</span>
                <span className="block text-[11px] text-text-muted">
                  {w.items} бараа
                  {w.negative > 0 && <span className="ml-2 text-warning">⚠ {w.negative} хасах үлдэгдэл</span>}
                </span>
              </span>
              <QtySum quantities={w.quantities} className="max-w-[40%] shrink truncate text-right text-xs text-text-muted max-sm:hidden" />
              <Amount value={w.amount} className="w-28 shrink-0 text-right text-sm font-semibold text-text" />
            </button>
            {isOpen && (
              <ul className="px-1 pb-2 sm:px-2">
                {w.list.slice(0, limit).map((i) => (
                  <li key={`${i.key}-${i.group}`} className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 hover:bg-white/[0.04] sm:flex-nowrap">
                    <span className="min-w-0 flex-1 max-sm:basis-full">
                      <span className="block truncate text-sm text-text max-sm:whitespace-normal">{i.name}</span>
                      <span className="block truncate text-[11px] text-text-muted">{i.group}</span>
                    </span>
                    <Qty qty={i.qty} unit={i.unit} className={cn("shrink-0 text-xs", i.qty < 0 ? "text-danger" : "text-text-muted")} />
                    <Amount value={i.amount} className="w-24 shrink-0 text-right text-sm font-medium text-text max-sm:ml-auto max-sm:w-auto" />
                  </li>
                ))}
                <li>
                  <More shown={limit} total={w.list.length} onMore={() => setShown((s) => ({ ...s, [w.code]: limit + PAGE * 2 }))} />
                </li>
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Хамгийн үнэтэй 10 бараа */
export function TopItems({ items }: { items: StockItemLine[] }) {
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <ol className="space-y-1 p-3">
      {items.map((i, n) => (
        <li key={i.key} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1 sm:flex-nowrap">
          <span className="ng-num w-5 shrink-0 text-xs text-text-muted">{n + 1}</span>
          <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">
            <span className="block truncate text-sm text-text max-sm:whitespace-normal">{i.name}</span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/5">
              <span className="block h-full rounded-full bg-[rgb(var(--color-accent))]" style={{ width: `${Math.max(2, (i.amount / max) * 100)}%` }} />
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3 max-sm:ml-8 max-sm:w-[calc(100%-2rem)] max-sm:justify-between">
            <Qty qty={i.qty} unit={i.unit} className="text-xs text-text-muted" />
            <Amount value={i.amount} className="w-24 text-right text-sm font-semibold text-text max-sm:w-auto" />
          </span>
        </li>
      ))}
    </ol>
  );
}
