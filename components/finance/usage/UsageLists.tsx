"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileText, Search } from "lucide-react";
import type { UsageWarehouse } from "@/lib/onec/usage-compare";
import type { UsageDeptView, UsageMaterialView } from "@/lib/onec/usage-view";
import { amountMatches, parseQuery } from "@/lib/query-parse";
import { cn } from "@/lib/utils";
import { Amount } from "@/components/finance/cash/Amount";
import { SegmentedTabs } from "@/components/finance/NgParts";
import { Qty, QtySum } from "@/components/finance/Qty";

const PAGE = 25;
export type UsageMode = "depts" | "materials" | "warehouses";

/** Баримтын жагсаалтыг шүүх бүлэг: цех, хэлтэс эсвэл агуулах */
export interface UsageFocus {
  kind: "dept" | "warehouse";
  key: string;
  label: string;
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-text-muted transition-transform", open && "rotate-90")} />;
}

/**
 * Цех, хэлтсээр → материал (тоо хэмжээ нэгжтэй + ₮); материалаар → цех, хэлтэс; агуулахаар. Нэр, дүнгээр («84 сая») хайна. Баримтын
 * дугаар, огноо зөвхөн хамгийн доод drill-down-д («Олголтын баримтуудыг харах»).
 */
export function UsageLists({
  departments,
  materials,
  warehouses,
  total,
  onFocus,
}: {
  departments: UsageDeptView[];
  materials: UsageMaterialView[];
  warehouses: UsageWarehouse[];
  /** нийт зарцуулалт (дээд талын тоотой ижил) */
  total: number;
  onFocus: (f: UsageFocus) => void;
}) {
  const [mode, setMode] = useState<UsageMode>("depts");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const has = !!q.trim();
  const p = useMemo(() => parseQuery(q), [q]);

  const depts = useMemo(() => departments.filter((d) => !has || (amountMatches(p, d.amount) && p.words.every((w) => `${d.name} ${d.materials.map((m) => m.name).join(" ")}`.toLowerCase().includes(w)))), [departments, p, has]);
  const mats = useMemo(() => materials.filter((m) => !has || (amountMatches(p, m.amount) && p.words.every((w) => `${m.name} ${m.departments.map((d) => d.name).join(" ")}`.toLowerCase().includes(w)))), [materials, p, has]);
  const whs = useMemo(() => warehouses.filter((w) => !has || (amountMatches(p, w.amount) && p.words.every((x) => `${w.name} ${w.group ?? ""} ${w.keeper?.name ?? ""}`.toLowerCase().includes(x)))), [warehouses, p, has]);
  const count = mode === "depts" ? depts.length : mode === "materials" ? mats.length : whs.length;
  const maxAmount = Math.max(1, ...(mode === "depts" ? depts : mode === "materials" ? mats : whs).map((r) => r.amount));

  const bar = (amount: number) => (
    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/5">
      <span className="block h-full rounded-full bg-[rgb(var(--color-accent))]" style={{ width: `${Math.max(2, (amount / maxAmount) * 100)}%` }} />
    </span>
  );
  const rowClass = "focus-ring flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-white/[0.03] sm:flex-nowrap";

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
            { value: "depts", label: "Цех, хэлтсээр", shortLabel: "Цех" },
            { value: "materials", label: "Материалаар", shortLabel: "Материал" },
            { value: "warehouses", label: "Агуулахаар", shortLabel: "Агуулах" },
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
            placeholder="Цех, материал, дүн (84 сая) хайх"
            aria-label="Зарцуулалт хайх"
            className="focus-ring h-11 w-full rounded-xl border border-border bg-bg-elevated pl-10 pr-3 text-sm text-text placeholder:text-text-muted"
          />
        </label>
      </div>

      {count === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-text-muted">Хайлтад тохирох зүйл олдсонгүй</p>
      ) : (
        <ul className="divide-y divide-border">
          {mode === "depts" &&
            depts.slice(0, shown).map((d) => {
              const key = `d:${d.name}`;
              const isOpen = has && depts.length <= 3 ? true : open === key;
              return (
                <li key={key}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen && open === key ? null : key)} className={rowClass}>
                    <Chevron open={isOpen} />
                    <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">
                      <span className="block truncate text-sm text-text max-sm:whitespace-normal">{d.name}</span>
                      <span className="block text-[11px] text-text-muted">{d.documents} олголт</span>
                      {bar(d.amount)}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 max-sm:ml-7 max-sm:w-[calc(100%-2rem)] max-sm:justify-between">
                      <QtySum quantities={d.quantities} className="max-w-52 truncate text-xs text-text-muted max-md:hidden" />
                      <Amount value={d.amount} className="text-sm font-semibold text-text" />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-0.5 pb-3 pl-12 pr-4 text-xs text-text-muted">
                      {d.materials.map((m) => (
                        <div key={m.key} className="flex min-h-8 flex-wrap items-center gap-x-3">
                          <span className="min-w-0 flex-1 truncate max-sm:basis-full max-sm:whitespace-normal">{m.name}</span>
                          <Qty qty={m.quantity} unit={m.unit} className="shrink-0" />
                          <Amount value={m.amount} className="w-24 shrink-0 text-right max-sm:ml-auto max-sm:w-auto" />
                        </div>
                      ))}
                      <button type="button" onClick={() => onFocus({ kind: "dept", key: d.name, label: d.name })} className="focus-ring mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[#ffd56b] hover:underline">
                        <FileText className="size-3.5" /> Олголтын баримтуудыг харах
                      </button>
                    </div>
                  )}
                </li>
              );
            })}

          {mode === "materials" &&
            mats.slice(0, shown).map((m) => {
              const key = `m:${m.key}`;
              const isOpen = has && mats.length <= 3 ? true : open === key;
              return (
                <li key={key}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen && open === key ? null : key)} className={rowClass}>
                    <Chevron open={isOpen} />
                    <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">
                      <span className="block truncate text-sm text-text max-sm:whitespace-normal">{m.name}</span>
                      {bar(m.amount)}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 max-sm:ml-7 max-sm:w-[calc(100%-2rem)] max-sm:justify-between">
                      <Qty qty={m.quantity} unit={m.unit} className="text-xs text-text-muted" />
                      <Amount value={m.amount} className="text-sm font-semibold text-text" />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-0.5 pb-3 pl-12 pr-4 text-xs text-text-muted">
                      {m.departments.map((d) => (
                        <div key={d.name} className="flex min-h-8 flex-wrap items-center gap-x-3">
                          <span className="min-w-0 flex-1 truncate max-sm:basis-full max-sm:whitespace-normal">{d.name}</span>
                          <Qty qty={d.quantity} unit={m.unit} className="shrink-0" />
                          <Amount value={d.amount} className="w-24 shrink-0 text-right max-sm:ml-auto max-sm:w-auto" />
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}

          {mode === "warehouses" &&
            whs.slice(0, shown).map((w) => (
              <li key={w.key}>
                <button type="button" onClick={() => onFocus({ kind: "warehouse", key: w.key, label: w.name })} className={rowClass} title="Энэ агуулахын олголтын баримтуудыг харах">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text max-sm:whitespace-normal">{w.name}</span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {w.mapped ? w.group ?? "Бүлэггүй" : <span className="text-warning">Бүлэгт холбогдоогүй</span>}
                      {w.mapped && w.keeper ? ` · нярав ${w.keeper.name}` : ""} · {w.documents} олголт
                    </span>
                    {bar(w.amount)}
                  </span>
                  <Amount value={w.amount} className="shrink-0 text-sm font-semibold text-text" />
                </button>
              </li>
            ))}
        </ul>
      )}

      <dl className="border-t border-border bg-white/[0.02] px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3 font-semibold text-text">
          <dt>Нийт зарцуулалт</dt>
          <dd>
            <Amount value={total} />
          </dd>
        </div>
      </dl>
      {count > shown && (
        <button type="button" onClick={() => setShown((s) => s + PAGE * 2)} className="focus-ring min-h-11 w-full border-t border-border px-4 text-left text-xs text-[#ffd56b] hover:underline">
          Цааш харуулах ({count - shown})
        </button>
      )}
    </div>
  );
}
