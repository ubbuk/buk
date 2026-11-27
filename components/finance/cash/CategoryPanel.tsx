"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { CategoryRow, FlowReport } from "@/lib/onec/cash-report";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Amount } from "./Amount";

/**
 * «Хаанаас орж ирсэн» / «Хаашаа гарсан»: ангилал бүр дүн, хувь, харьцсан хэмжээний зурвастай. Ангиллыг дарвал харилцагчаар задарна;
 * ангилал, харилцагчийг «Хайх» дарж доорх гүйлгээний жагсаалтыг шүүнэ. 1С-ийн данс, баримтын дугаар энд харагдахгүй.
 */
export function CategoryPanel({
  title,
  tone,
  flow,
  onPickCategory,
  onPickParty,
  otherHint,
  renderDetail,
  foot,
}: {
  title: string;
  tone: "in" | "out";
  flow: FlowReport;
  onPickCategory: (c: CategoryRow) => void;
  onPickParty: (c: CategoryRow, party: string) => void;
  /** «Бусад»-ын хувь өндөр үед админд зориулсан санамж */
  otherHint?: React.ReactNode;
  /** ангилалын задрал: null биш бол харилцагчийн жагсаалтын оронд (жишээ нь «Банкны шимтгэл» → аль гүйлгээнд хамаарах) */
  renderDetail?: (c: CategoryRow) => React.ReactNode | null;
  /** ангиллын жагсаалтын доорх нэмэлт мөр */
  foot?: React.ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const bar = tone === "in" ? "bg-[rgb(var(--color-accent))]" : "bg-danger";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="min-w-0">{title}</CardTitle>
        <span className="shrink-0 whitespace-nowrap text-xs text-text-muted">{flow.categories.length} ангилал</span>
      </CardHeader>
      <CardBody className="space-y-1.5 !p-3">
        {flow.categories.length === 0 && <p className="px-2 py-6 text-center text-sm text-text-muted">Энэ сард гүйлгээ алга</p>}
        {flow.categories.map((c) => {
          const isOpen = open === c.id;
          return (
            <div key={c.id} className="rounded-xl border border-transparent hover:border-border">
              {/* 2 давхар мөр (утсан дээр ч): 1-р мөр нэр ... дүн; 2-р мөр бар ... хувь */}
              <div className="px-2 py-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={`${c.label}: харилцагчаар задлах`}
                    onClick={() => setOpen(isOpen ? null : c.id)}
                    className="focus-ring flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
                  >
                    <ChevronRight className={cn("size-4 shrink-0 text-text-muted transition-transform", isOpen && "rotate-90")} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{c.label}</span>
                  </button>
                  <Amount value={c.total} className="shrink-0 text-sm font-semibold text-text" />
                </div>
                <div className="mt-0.5 flex items-center gap-2 pl-6">
                  <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
                    <span className={cn("block h-full rounded-full", bar)} style={{ width: `${Math.max(2, c.share * 100)}%` }} />
                  </span>
                  <span className="w-10 shrink-0 text-right text-xs text-text-muted">{(c.share * 100).toFixed(c.share < 0.1 ? 1 : 0)}%</span>
                </div>
              </div>
              {isOpen && (
                <div className="mb-2 ml-8 mr-2 space-y-0.5 border-l border-border pl-3">
                  {renderDetail?.(c) ?? null}
                  {(renderDetail?.(c) ? [] : c.parties).map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => onPickParty(c, p.name)}
                      className="focus-ring flex min-h-8 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-xs text-text-muted hover:bg-white/5 hover:text-text"
                      title="Энэ харилцагчийн гүйлгээг харах"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0">
                        <Amount value={p.total} className="text-xs" />
                      </span>
                    </button>
                  ))}
                  {!renderDetail?.(c) && c.moreParties.count > 0 && (
                    <p className="px-2 py-1 text-[11px] text-text-muted">
                      … бусад {c.moreParties.count} харилцагч · <Amount value={c.moreParties.total} className="text-[11px]" />
                    </p>
                  )}
                  <button type="button" onClick={() => onPickCategory(c)} className="focus-ring mt-1 min-h-8 rounded-md px-2 text-xs text-[#ffd56b] hover:underline">
                    Бүх гүйлгээг харах ({c.count})
                  </button>
                  {c.id === "other" && otherHint}
                </div>
              )}
            </div>
          );
        })}
        {foot}
      </CardBody>
    </Card>
  );
}
