"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { formatMoneyShort } from "@/lib/money-short";
import { Amount } from "./Amount";

export interface CashEntryFilter {
  q: string;
  flow: "" | "inflow" | "outflow";
  category: string;
  categoryLabel: string;
  party: string;
  /** банкны шимтгэл: холбогдсон / холбогдоогүй / гадаад гүйлгээний */
  fee: "" | "linked" | "unlinked" | "foreign";
  feeLabel: string;
  /** нэг үндсэн гүйлгээ ба түүний шимтгэлүүд */
  main: string;
  mainLabel: string;
}
export const NO_FILTER: CashEntryFilter = { q: "", flow: "", category: "", categoryLabel: "", party: "", fee: "", feeLabel: "", main: "", mainLabel: "" };

interface EntryItem {
  id: string;
  date: string;
  type: "inflow" | "outflow" | "internal";
  account: string;
  counterpart: string;
  memo: string;
  article: string;
  amount: number;
  categoryLabel: string;
  payroll: boolean;
  /** үндсэн гүйлгээний шимтгэлүүд ба нийт зарлага (төлбөр + шимтгэл) */
  fees?: { count: number; total: number; grandTotal: number; items: { id: string; amount: number; time: string; memo: string }[] };
  /** шимтгэл: аль гүйлгээнд хамаарах (null = холбогдоогүй) */
  linkedTo?: { id: string; counterpart: string; amount: number; date: string } | null;
  foreignFee?: boolean;
  accounting: { document: string; documentNumber: string | null; account: string; accountName: string } | null;
}
interface EntriesPage {
  items: EntryItem[];
  page: number;
  pages: number;
  total: number;
  netTotal: number;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Сарын БҮХ гүйлгээ: хайлт (харилцагч, утга, дүн «84 сая» / 84073015, огноо 11-17), ангилал, харилцагчийн шүүлт, хуудаслалт.
 * Мөрийг дарвал хамгийн доод drill-down: «Нягтланд: баримтын төрөл, дугаар, данс» (удирдлагад шаардлагагүй, нягтланд хэрэгтэй).
 */
export function CashEntries({ month, filter, onFilter, version }: { month: string; filter: CashEntryFilter; onFilter: (f: CashEntryFilter) => void; version: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EntriesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [feesOpen, setFeesOpen] = useState<string | null>(null);
  const q = useDebounced(filter.q, 300);

  // шүүлт, сар өөрчлөгдөхөд эхний хуудас руу
  useEffect(() => setPage(1), [month, q, filter.flow, filter.category, filter.party, filter.fee, filter.main]);

  useEffect(() => {
    const c = new AbortController();
    const sp = new URLSearchParams({ month, page: String(page), size: "30" });
    if (q.trim()) sp.set("q", q.trim());
    if (filter.flow) sp.set("flow", filter.flow);
    if (filter.category) sp.set("category", filter.category);
    if (filter.party) sp.set("party", filter.party);
    if (filter.fee) sp.set("fee", filter.fee);
    if (filter.main) sp.set("main", filter.main);
    setLoading(true);
    fetch(`/api/dashboard/cash/entries?${sp}`, { signal: c.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (c.signal.aborted) return; // таслагдсан хүсэлтийн хоосон хариуг хадгалахгүй
        if (!res.ok || !body || !Array.isArray(body.items)) throw new Error(body?.error ?? `Алдаа ${res.status}`);
        setData(body as EntriesPage);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Жагсаалт татаж чадсангүй");
        setLoading(false);
      });
    return () => c.abort();
  }, [month, page, q, filter.flow, filter.category, filter.party, filter.fee, filter.main, version]);

  const chips = [filter.flow && (filter.flow === "inflow" ? "Орж ирсэн" : "Гарсан"), filter.categoryLabel, filter.feeLabel, filter.mainLabel, filter.party].filter(Boolean) as string[];

  return (
    <Card id="cash-entries">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">Бүх гүйлгээ</h3>
          {data && (
            <span className="text-xs text-text-muted">
              {data.total} гүйлгээ · цэвэр <Amount value={data.netTotal} signed className="text-xs" />
            </span>
          )}
        </div>
        <label className="relative block">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={filter.q}
            onChange={(e) => onFilter({ ...filter, q: e.target.value })}
            placeholder="Хайх: харилцагч, утга, дүн (84 сая, 84073015), огноо (11-17)"
            aria-label="Гүйлгээ хайх"
            className="focus-ring h-11 w-full rounded-xl border border-border bg-bg-elevated pl-10 pr-3 text-sm text-text placeholder:text-text-muted"
          />
        </label>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-text-muted">Шүүлт:</span>
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-[rgba(80,140,240,0.4)] px-2.5 py-0.5 text-text">
                {c}
              </span>
            ))}
            <button type="button" onClick={() => onFilter({ ...NO_FILTER, q: filter.q })} className="focus-ring inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-text-muted hover:text-text">
              <X className="size-3" /> Шүүлт арилгах
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {loading && !data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-text-muted">Хайлтад тохирох гүйлгээ олдсонгүй</p>
      ) : (
        <ul className={cn("divide-y divide-border", loading && "opacity-60")}>
          {data?.items.map((e) => {
            const isOpen = open === e.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : e.id)}
                  className="focus-ring flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]"
                >
                  <span className="ng-num w-[4.6rem] shrink-0 text-xs text-text-muted">{e.date.slice(5)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{e.counterpart}</span>
                    <span className="block truncate text-xs text-text-muted">
                      <span className="mr-1.5 rounded bg-white/5 px-1.5 py-px text-[10px] text-text-muted">{e.categoryLabel}</span>
                      {e.memo}
                    </span>
                    {e.fees && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-expanded={feesOpen === e.id}
                        title="Шимтгэл тус бүрийг харах"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setFeesOpen(feesOpen === e.id ? null : e.id);
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            ev.stopPropagation();
                            setFeesOpen(feesOpen === e.id ? null : e.id);
                          }
                        }}
                        className="mt-1 inline-flex min-h-6 cursor-pointer items-center rounded-full border border-[rgba(255,213,107,0.4)] px-2 text-[11px] text-[#ffd56b] hover:bg-white/5"
                      >
                        + шимтгэл {formatMoneyShort(e.fees.total)} ({e.fees.count})
                      </span>
                    )}
                    {e.linkedTo !== undefined && (
                      <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                        {e.linkedTo ? `↳ ${e.linkedTo.counterpart} төлбөрийн шимтгэл` : "Аль гүйлгээнд хамаарах нь тодорхойгүй (холбоогүй)"}
                      </span>
                    )}
                  </span>
                  <Amount value={e.type === "outflow" ? -e.amount : e.amount} signed className={cn("shrink-0 text-sm font-medium", e.type === "outflow" ? "text-danger" : "text-success")} />
                  <ChevronDown className={cn("size-4 shrink-0 text-text-muted transition-transform", isOpen && "rotate-180")} />
                </button>
                {e.fees && (
                  <div className="space-y-1 px-4 pb-2.5 pl-[6.1rem] text-xs text-text-muted">
                    <p>
                      Нийт зарлага: <Amount value={e.fees.grandTotal} className="font-medium text-danger" /> <span>(төлбөр + шимтгэл)</span>
                    </p>
                    {feesOpen === e.id && (
                      <ul className="space-y-0.5 border-l border-border pl-3">
                        {e.fees.items.map((f) => (
                          <li key={f.id} className="flex items-center gap-2">
                            <span className="ng-num w-10 shrink-0">{f.time}</span>
                            <span className="min-w-0 flex-1 truncate">{f.memo || "Шимтгэл"}</span>
                            <Amount value={f.amount} className="shrink-0 text-xs" />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {isOpen && (
                  <div className="space-y-1 bg-white/[0.02] px-4 pb-3 pl-[6.1rem] text-xs text-text-muted">
                    <p>
                      Данс: <span className="text-text">{e.account}</span>
                      {e.article && (
                        <>
                          {" "}
                          · Зүйл: <span className="text-text">{e.article}</span>
                        </>
                      )}
                    </p>
                    {e.memo && <p className="break-words">Утга: <span className="text-text">{e.memo}</span></p>}
                    {e.accounting ? (
                      <p>
                        Нягтланд: <span className="text-text">{e.accounting.document}</span>
                        {e.accounting.documentNumber && <span className="text-text"> · {e.accounting.documentNumber}</span>}
                        {e.accounting.account && (
                          <span>
                            {" "}
                            · данс <span className="text-text">{e.accounting.account}</span>
                            {e.accounting.accountName && ` «${e.accounting.accountName}»`}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p>Цалинтай холбоотой гүйлгээг нэгтгэж харуулна.</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-text-muted">
          <button
            type="button"
            disabled={data.page <= 1}
            onClick={() => setPage(data.page - 1)}
            className="focus-ring inline-flex h-10 min-w-10 items-center gap-1 rounded-lg border border-border px-3 text-text disabled:opacity-40"
          >
            <ChevronLeft className="size-4" /> Өмнөх
          </button>
          <span>
            {data.page} / {data.pages}
          </span>
          <button
            type="button"
            disabled={data.page >= data.pages}
            onClick={() => setPage(data.page + 1)}
            className="focus-ring inline-flex h-10 min-w-10 items-center gap-1 rounded-lg border border-border px-3 text-text disabled:opacity-40"
          >
            Дараах <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </Card>
  );
}
