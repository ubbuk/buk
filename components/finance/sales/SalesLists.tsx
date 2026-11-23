"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileText, Search } from "lucide-react";
import type { SalesClient, SalesItem, SalesReconciliation } from "@/lib/onec/sales-view";
import { amountMatches, parseQuery } from "@/lib/query-parse";
import { cn } from "@/lib/utils";
import { Amount } from "@/components/finance/cash/Amount";
import { Qty, QtySum } from "@/components/finance/Qty";
import { SegmentedTabs } from "@/components/finance/NgParts";

const PAGE = 25;

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-text-muted transition-transform", open && "rotate-90")} />;
}

const Margin = ({ value }: { value: number | null }) => <span className={cn("text-[11px]", value !== null && value < 0 ? "text-danger" : "text-text-muted")}>{value === null ? "—" : `${value.toFixed(1)}%`}</span>;

function words(q: string) {
  const p = parseQuery(q);
  return { p, has: !!q.trim() };
}

/**
 * Харилцагчаар / Бүтээгдэхүүнээр: нэр, кодоор, дүнгээр («84 сая», 84073015) хайна. Мөр бүрд орлого, ашиг, ашгийн хувь; дарвал
 * харилцагч → худалдан авсан бараа (тоо хэмжээ нэгжтэй + ₮), бараа → худалдан авагчид. Баримтын дугаар, 1С-ийн данс энд байхгүй.
 */
export function SalesLists({ clients, items, onClientDocs, reconciliation }: { clients: SalesClient[]; items: SalesItem[]; onClientDocs: (c: SalesClient) => void; reconciliation: SalesReconciliation }) {
  const [mode, setMode] = useState<"clients" | "items">("clients");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const { p, has } = words(q);

  const filteredClients = useMemo(
    () =>
      clients.filter((c) => {
        if (!has) return true;
        const hay = `${c.name} ${c.code} ${c.products.map((x) => x.name).join(" ")}`.toLowerCase();
        return amountMatches(p, c.revenue) && p.words.every((w) => hay.includes(w));
      }),
    [clients, p, has]
  );
  const filteredItems = useMemo(
    () =>
      items.filter((i) => {
        if (!has) return true;
        const hay = `${i.name} ${i.code} ${i.clients.map((x) => x.name).join(" ")}`.toLowerCase();
        return amountMatches(p, i.revenue) && p.words.every((w) => hay.includes(w));
      }),
    [items, p, has]
  );
  const list = mode === "clients" ? filteredClients : filteredItems;
  const maxRevenue = Math.max(1, ...list.map((r) => r.revenue));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <SegmentedTabs
          label="Харагдац"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setOpen(null);
            setShown(PAGE);
          }}
          tabs={[
            { value: "clients", label: "Харилцагчаар", shortLabel: "Харилцагч" },
            { value: "items", label: "Бүтээгдэхүүнээр", shortLabel: "Бүтээгдэхүүн" },
          ]}
        />
        <label className="relative block min-w-0 flex-1 basis-60">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShown(PAGE);
            }}
            placeholder={mode === "clients" ? "Харилцагч, бараа, дүн (84 сая) хайх" : "Бүтээгдэхүүн, код, дүн (84 сая) хайх"}
            aria-label="Борлуулалт хайх"
            className="focus-ring h-11 w-full rounded-xl border border-border bg-bg-elevated pl-10 pr-3 text-sm text-text placeholder:text-text-muted"
          />
        </label>
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-text-muted">Хайлтад тохирох зүйл олдсонгүй</p>
      ) : (
        <ul className="divide-y divide-border">
          {(list as (SalesClient | SalesItem)[]).slice(0, shown).map((r) => {
            const key = `${mode}:${r.code}:${r.name}`;
            const isOpen = has && list.length <= 5 ? true : open === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen && open === key ? null : key)}
                  className="focus-ring flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-white/[0.03] sm:flex-nowrap"
                >
                  <Chevron open={isOpen} />
                  <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">
                    <span className="block truncate text-sm text-text max-sm:whitespace-normal">{r.name}</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/5">
                      <span className="block h-full rounded-full bg-[rgb(var(--color-accent))]" style={{ width: `${Math.max(2, (r.revenue / maxRevenue) * 100)}%` }} />
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 max-sm:ml-7 max-sm:w-[calc(100%-2rem)] max-sm:justify-between">
                    {"quantities" in r ? <QtySum quantities={r.quantities} className="max-w-48 truncate text-xs text-text-muted max-md:hidden" /> : <Qty qty={r.qty} unit={r.unit} className="text-xs text-text-muted" />}
                    <span className="text-right">
                      <Amount value={r.revenue} className="block text-sm font-semibold text-text" />
                      <span className="block text-[11px] text-text-muted">
                        ашиг <Amount value={r.profit} className="text-[11px]" /> · <Margin value={r.margin} />
                      </span>
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-0.5 pb-3 pl-12 pr-4 text-xs text-text-muted">
                    {"products" in r
                      ? r.products.map((x) => (
                          <div key={`${x.code}-${x.name}-${x.unit}`} className="flex min-h-8 flex-wrap items-center gap-x-3">
                            <span className="min-w-0 flex-1 truncate max-sm:basis-full max-sm:whitespace-normal">{x.name}</span>
                            <Qty qty={x.qty} unit={x.unit} className="shrink-0" />
                            <Amount value={x.revenue} className="w-24 shrink-0 text-right max-sm:ml-auto max-sm:w-auto" />
                          </div>
                        ))
                      : r.clients.map((x) => (
                          <div key={`${x.code}-${x.name}`} className="flex min-h-8 flex-wrap items-center gap-x-3">
                            <span className="min-w-0 flex-1 truncate max-sm:basis-full max-sm:whitespace-normal">{x.name}</span>
                            <Qty qty={x.qty} unit={r.unit} className="shrink-0" />
                            <Amount value={x.revenue} className="w-24 shrink-0 text-right max-sm:ml-auto max-sm:w-auto" />
                          </div>
                        ))}
                    {"products" in r && (
                      <button type="button" onClick={() => onClientDocs(r)} className="focus-ring mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[#ffd56b] hover:underline">
                        <FileText className="size-3.5" /> Борлуулалтын баримтуудыг харах
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {/* Жагсаалтын нийлбэр дээд талын Ашигтай таарна: Σ ашиг − харилцагчид хуваарилагдаагүй зардал = нийт ашиг (хайлтаас үл хамаарна) */}
      <dl className="space-y-1 border-t border-border bg-white/[0.02] px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3 text-text-muted">
          <dt>{mode === "clients" ? "Бүх харилцагчийн ашгийн нийлбэр" : "Бүх бүтээгдэхүүний ашгийн нийлбэр"}</dt>
          <dd>
            <Amount value={reconciliation.listProfit} />
          </dd>
        </div>
        {reconciliation.unassigned !== 0 && (
          <div className="flex items-center justify-between gap-3 text-text-muted">
            <dt>Харилцагчид хуваарилагдаагүй зардал — цехээс шууд зарцуулсан материал</dt>
            <dd className="shrink-0">
              <Amount value={reconciliation.unassigned} className="text-danger" />
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-1 font-semibold text-text">
          <dt>
            Нийт ашиг
            {!reconciliation.matches && <span className="ml-2 text-xs font-normal text-warning">дээд талын Ашигтай таарахгүй байна</span>}
          </dt>
          <dd className="shrink-0">
            <Amount value={reconciliation.total} />
          </dd>
        </div>
      </dl>
      {list.length > shown && (
        <button type="button" onClick={() => setShown((s) => s + PAGE * 2)} className="focus-ring min-h-11 w-full border-t border-border px-4 text-left text-xs text-[#ffd56b] hover:underline">
          Цааш харуулах ({list.length - shown})
        </button>
      )}
    </div>
  );
}
