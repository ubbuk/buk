"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, FileText, Search, X } from "lucide-react";
import { AGING_LABEL, type AgingBucket } from "@/lib/onec/receivable-aging";
import type { CustomerView } from "@/lib/onec/receivables-view";
import { amountMatches, parseQuery } from "@/lib/query-parse";
import { cn } from "@/lib/utils";
import { Amount } from "@/components/finance/cash/Amount";
import { SegmentedTabs } from "@/components/finance/NgParts";

const PAGE = 25;
export type AgingKey = AgingBucket | "unknown";
export const AGING_COLOR: Record<AgingKey, string> = { b0_30: "#60a5fa", b31_60: "#fbbf24", b61_90: "#fb923c", b90: "#ef4444", unknown: "#6b7280" };
const ORDER: AgingKey[] = ["b0_30", "b31_60", "b61_90", "b90", "unknown"];

/** Харилцагчийн өрийн насны зурвас (0–30 → 90+ ).: өнгө бүр нэг насны бүлэг */
function AgeBar({ aging, total }: { aging: CustomerView["aging"]; total: number }) {
  return (
    <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
      {ORDER.map((k) => (aging[k] > 0 ? <span key={k} style={{ width: `${(aging[k] / Math.max(total, 1)) * 100}%`, background: AGING_COLOR[k] }} /> : null))}
    </span>
  );
}

function Change({ value, previous }: { value: number | null; previous: number | null }) {
  if (value === null || previous === null || Math.abs(value) < 1) return null;
  const up = value > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px]", up ? "text-danger" : "text-text-muted")} title={`Өмнөх сарын эцэст ${Math.round(previous).toLocaleString("en-US")}₮ байсан`}>
      {up ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
      <Amount value={Math.abs(value)} className="text-[11px]" /> өмнөх сараас
    </span>
  );
}

/**
 * Харилцагчаар: өр (нас, өмнөх сартай харьцуулалт), урьдчилж төлсөн. Нас сонгох (дээрх картаас) эсвэл нэр, дүнгээр («84 сая») хайна.
 * Мөрийг дарвал насны задаргаа; «Баримтуудыг харах» нь хамгийн доод drill-down.
 */
export function ReceivablesLists({
  customers,
  bucket,
  onBucket,
  onDocs,
}: {
  customers: CustomerView[];
  bucket: AgingKey | null;
  onBucket: (b: AgingKey | null) => void;
  onDocs: (c: CustomerView) => void;
}) {
  const [tab, setTab] = useState<"debt" | "prepaid">("debt");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const p = useMemo(() => parseQuery(q), [q]);
  const has = !!q.trim();

  const debtors = useMemo(() => customers.filter((c) => c.balance > 0), [customers]);
  const prepaid = useMemo(() => customers.filter((c) => c.balance < 0).sort((a, b) => a.balance - b.balance), [customers]);
  const base = tab === "debt" ? debtors : prepaid;
  const list = useMemo(
    () =>
      base.filter((c) => {
        if (bucket && tab === "debt" && !(c.aging[bucket] > 0)) return false;
        if (!has) return true;
        return amountMatches(p, c.balance) && p.words.every((w) => c.name.toLowerCase().includes(w));
      }),
    [base, bucket, tab, p, has]
  );
  const max = Math.max(1, ...list.map((c) => Math.abs(c.balance)));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <SegmentedTabs
          label="Харагдац"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setOpen(null);
            setShown(PAGE);
          }}
          tabs={[
            { value: "debt", label: `Өртэй (${debtors.length})`, shortLabel: `Өртэй (${debtors.length})` },
            { value: "prepaid", label: `Урьдчилж төлсөн (${prepaid.length})`, shortLabel: `Урьдчилгаа (${prepaid.length})` },
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
            placeholder="Харилцагч, дүн (84 сая) хайх"
            aria-label="Авлага хайх"
            className="focus-ring h-11 w-full rounded-xl border border-border bg-bg-elevated pl-10 pr-3 text-sm text-text placeholder:text-text-muted"
          />
        </label>
        {bucket && tab === "debt" && (
          <button type="button" onClick={() => onBucket(null)} className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[rgba(80,140,240,0.4)] px-3 text-xs text-text">
            <i className="size-2 rounded-full" style={{ background: AGING_COLOR[bucket] }} /> {AGING_LABEL[bucket]} <X className="size-3" aria-hidden />
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-text-muted">Хайлтад тохирох харилцагч олдсонгүй</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.slice(0, shown).map((c) => {
            const key = c.key || c.name;
            const isOpen = open === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : key)}
                  className="focus-ring flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-white/[0.03] sm:flex-nowrap"
                >
                  <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-text-muted transition-transform", isOpen && "rotate-90")} />
                  <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">
                    <span className="block truncate text-sm text-text max-sm:whitespace-normal">{c.name}</span>
                    {tab === "debt" ? (
                      <AgeBar aging={c.aging} total={c.balance} />
                    ) : (
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/5">
                        <span className="block h-full rounded-full bg-[rgb(var(--color-accent))]" style={{ width: `${Math.max(2, (Math.abs(c.balance) / max) * 100)}%` }} />
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end max-sm:ml-7 max-sm:w-[calc(100%-2rem)] max-sm:flex-row max-sm:items-center max-sm:justify-between">
                    <Amount value={Math.abs(c.balance)} className="text-sm font-semibold text-text" />
                    {tab === "debt" ? <Change value={c.change} previous={c.previousBalance} /> : <span className="text-[11px] text-text-muted">урьдчилж төлсөн</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-1 pb-3 pl-12 pr-4 text-xs text-text-muted">
                    {tab === "debt" &&
                      ORDER.filter((k) => c.aging[k] > 0).map((k) => (
                        <div key={k} className="flex min-h-8 items-center gap-3">
                          <i className="size-2.5 shrink-0 rounded-full" style={{ background: AGING_COLOR[k] }} aria-hidden />
                          <span className="min-w-0 flex-1">{AGING_LABEL[k]}</span>
                          <Amount value={c.aging[k]} className="shrink-0" />
                        </div>
                      ))}
                    {tab === "debt" && c.aging.oldestDays !== null && <p className="pt-1">Хамгийн хуучин төлөгдөөгүй борлуулалт {c.aging.oldestDays} хоногийн өмнөх</p>}
                    {c.key && (
                      <button type="button" onClick={() => onDocs(c)} className="focus-ring mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[#ffd56b] hover:underline">
                        <FileText className="size-3.5" aria-hidden /> Борлуулалт, төлбөрийн баримтуудыг харах
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > shown && (
        <button type="button" onClick={() => setShown((s) => s + PAGE * 2)} className="focus-ring min-h-11 w-full border-t border-border px-4 text-left text-xs text-[#ffd56b] hover:underline">
          Цааш харуулах ({list.length - shown})
        </button>
      )}
    </div>
  );
}
