"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, FileText, Search } from "lucide-react";
import type { ExpenseCategoryView, ExpenseItemView } from "@/lib/onec/expense-view";
import { amountMatches, parseQuery } from "@/lib/query-parse";
import { cn } from "@/lib/utils";
import { Amount } from "@/components/finance/cash/Amount";

export const CATEGORY_COLOR: Record<string, string> = {
  payroll: "#f472b6",
  utilities: "#fbbf24",
  fuel: "#fb923c",
  repair: "#60a5fa",
  rent: "#a78bfa",
  transport: "#34d399",
  insurance: "#2dd4bf",
  taxes: "#ef4444",
  depreciation: "#94a3b8",
  bank: "#22d3ee",
  other: "#6b7280",
};

/** Зардал өссөн нь улаан, буурсан нь саарал (өөр нэгжгүй: зөвхөн хувь, «өмнөх сараас») */
function Change({ pct, prev }: { pct: number | null; prev: number }) {
  if (pct === null || Math.abs(pct) < 0.5) return null;
  const up = pct > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px]", up ? "text-danger" : "text-text-muted")} title={`Өмнөх сард ${Math.round(prev).toLocaleString("en-US")}₮ байсан`}>
      {up ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
      {up ? "+" : ""}
      {pct.toFixed(0)}% өмнөх сараас
    </span>
  );
}

/**
 * Ангиллаар: цахилгаан, түрээс, тээвэр ... Мөрийг дарвал зардлын нэрс; нэр дээр дарвал нягтлангийн баримтууд (хамгийн доод drill-down).
 * Хайлт: ангилал, зардлын нэр, дүн («84 сая»); хайлтад таарсан ангилал автоматаар задарна.
 */
export function ExpenseCategories({ categories, onDocs }: { categories: ExpenseCategoryView[]; onDocs: (item: ExpenseItemView) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const p = useMemo(() => parseQuery(q), [q]);
  const has = !!q.trim();

  const list = useMemo(() => {
    if (!has) return categories.map((c) => ({ c, items: c.items, auto: false }));
    return categories
      .map((c) => {
        const labelHit = p.words.length > 0 && p.words.every((w) => c.label.toLowerCase().includes(w));
        const items = c.items.filter((i) => amountMatches(p, i.amount) && p.words.every((w) => i.name.toLowerCase().includes(w)));
        if (labelHit && amountMatches(p, c.amount)) return { c, items: c.items, auto: false };
        return { c, items, auto: true };
      })
      .filter((r) => r.items.length > 0 || !r.auto);
  }, [categories, p, has]);

  const max = Math.max(1, ...categories.map((c) => c.amount));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <h3 className="text-sm font-semibold text-text">Юунд зарцуулсан бэ</h3>
        <label className="relative block min-w-0 flex-1 basis-60 sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Зардлын нэр, дүн (84 сая) хайх"
            aria-label="Зардал хайх"
            className="focus-ring h-11 w-full rounded-xl border border-border bg-bg-elevated pl-10 pr-3 text-sm text-text placeholder:text-text-muted"
          />
        </label>
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-text-muted">Хайлтад тохирох зардал олдсонгүй</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map(({ c, items, auto }) => {
            const isOpen = open === c.id || (has && auto);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                  className="focus-ring flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-white/[0.03] sm:flex-nowrap"
                >
                  <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-text-muted transition-transform", isOpen && "rotate-90")} />
                  <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">
                    <span className="flex items-center gap-2 text-sm text-text">
                      <i className="size-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[c.id] }} aria-hidden />
                      <span className="min-w-0 truncate max-sm:whitespace-normal">{c.label}</span>
                      <span className="shrink-0 text-[11px] text-text-muted">{c.share.toFixed(1)}%</span>
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (c.amount / max) * 100)}%`, background: CATEGORY_COLOR[c.id] }} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end max-sm:ml-7 max-sm:w-[calc(100%-2rem)] max-sm:flex-row max-sm:items-center max-sm:justify-between">
                    <Amount value={c.amount} className="text-sm font-semibold text-text" />
                    <Change pct={c.changePct} prev={c.prevAmount} />
                  </span>
                </button>
                {isOpen && (
                  <ul className="space-y-0.5 pb-3 pl-12 pr-4 text-xs">
                    {items.length === 0 && <li className="py-2 text-text-muted">Энэ сард зардал бүртгэгдээгүй (өмнөх сард {Math.round(c.prevAmount).toLocaleString("en-US")}₮)</li>}
                    {items.map((i) => (
                      <li key={`${i.name}|${i.account}`}>
                        <button
                          type="button"
                          onClick={() => onDocs(i)}
                          title={`Нягтланд: ${i.account} данс · баримтуудыг харах`}
                          className="focus-ring group flex min-h-9 w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1 text-left hover:bg-white/[0.04] sm:flex-nowrap"
                        >
                          <span className="min-w-0 flex-1 truncate text-text max-sm:basis-full max-sm:whitespace-normal">{i.name}</span>
                          <Change pct={i.changePct} prev={i.prevAmount} />
                          <Amount value={i.amount} className="shrink-0 text-text-muted" />
                          <FileText className="size-3.5 shrink-0 text-[#ffd56b] opacity-60 group-hover:opacity-100" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
