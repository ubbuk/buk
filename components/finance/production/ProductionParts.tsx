"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, FileText, Mountain, Search } from "lucide-react";
import { Amount } from "@/components/finance/cash/Amount";
import { Qty, QtySum } from "@/components/finance/Qty";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CrusherProduct, DepartmentRow, DocLine, ProductRow, ProductionView } from "@/lib/onec/production-view";
import { cn } from "@/lib/utils";

/** «Нягтлан батлаагүй» шар тэмдэг: 1С-д баримт хараахан батлагдаагүй (Posted=false), тоо нь нийт дүнд орсон */
export function UnconfirmedBadge({ children = "Нягтлан батлаагүй", className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning", className)}>
      <AlertTriangle className="size-3" aria-hidden />
      {children}
    </span>
  );
}

const mmdd = (day: string) => `${day.slice(5, 7)}-${day.slice(8, 10)}`;

function DocLines({ docs }: { docs: DocLine[] | "loading" | "error" | undefined }) {
  if (docs === "loading" || docs === undefined) return <Skeleton className="m-2 h-16" />;
  if (docs === "error") return <p className="px-3 py-3 text-xs text-danger">Баримтыг татаж чадсангүй</p>;
  if (docs.length === 0) return <p className="px-3 py-3 text-xs text-text-muted">Баримт олдсонгүй</p>;
  return (
    <ul className="divide-y divide-border/60 text-xs">
      {docs.map((d, i) => (
        <li key={`${d.docNumber}|${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="ng-num w-12 shrink-0 text-text-muted">{mmdd(d.day)}</span>
          <span className="min-w-0 flex-1 truncate text-text-muted max-sm:basis-full">{d.department}</span>
          {d.repair && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">засвар</span>}
          {!d.posted && <UnconfirmedBadge />}
          <Qty qty={d.quantity} unit={d.unit} className="shrink-0 text-text" />
          {/* 1С-ийн баримтын дугаар: зөвхөн хамгийн доод түвшинд */}
          <span className="ng-num shrink-0 text-[11px] text-text-muted" title="Нягтланд бүртгэсэн баримтын дугаар">
            Нягтланд: {d.docNumber}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Бүтээгдэхүүнээр: хайлттай жагсаалт. Мөрийг дарвал тэр бүтээгдэхүүний баримтууд (хамгийн доод drill-down). */
export function ProductList({ products, costClosed, docs, onOpen }: { products: ProductRow[]; costClosed: boolean; docs: Record<string, DocLine[] | "loading" | "error">; onOpen: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [showSemi, setShowSemi] = useState(false);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = useMemo(() => products.filter((p) => words.every((w) => p.name.toLowerCase().includes(w))), [products, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const semiCount = list.filter((p) => p.stage === "semi").length;
  const shown = list.filter((p) => p.stage !== "semi" || showSemi || words.length > 0);
  const max = Math.max(1, ...products.filter((p) => !p.defect && p.stage === "finished").map((p) => p.qty));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <h3 className="text-sm font-semibold text-text">Бүтээгдэхүүнээр</h3>
        <label className="relative block min-w-0 flex-1 basis-60 sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Бүтээгдэхүүний нэр хайх"
            aria-label="Бүтээгдэхүүн хайх"
            className="focus-ring h-11 w-full rounded-xl border border-border bg-bg-elevated pl-10 pr-3 text-sm text-text placeholder:text-text-muted"
          />
        </label>
      </div>
      {shown.length === 0 && semiCount === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-text-muted">{products.length ? "Хайлтад тохирох бүтээгдэхүүн олдсонгүй" : "Энэ сард гарц бүртгэгдээгүй"}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((p) => {
            const isOpen = open === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => {
                    const next = isOpen ? null : p.id;
                    setOpen(next);
                    onOpen(next);
                  }}
                  className={cn("focus-ring flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-white/[0.03] sm:flex-nowrap", p.defect && "bg-danger/[0.04]")}
                >
                  <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-text-muted transition-transform", isOpen && "rotate-90")} />
                  <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text">
                      <span className={cn("min-w-0 max-sm:whitespace-normal", p.defect && "text-danger")}>{p.name}</span>
                      {p.stage === "semi" && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">Хагас боловсруулсан</span>}
                      {p.repairQty > 0 && <span className="shrink-0 text-[11px] text-text-muted">үүнээс засвар {fmt(p.repairQty)}</span>}
                      {p.unconfirmedQty > 0 && <UnconfirmedBadge>Нягтлан батлаагүй {fmt(p.unconfirmedQty)}</UnconfirmedBadge>}
                    </span>
                    {!p.defect && p.stage === "finished" && (
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                        <span className="block h-full rounded-full bg-[linear-gradient(90deg,#f5b523,#ffd56b)]" style={{ width: `${Math.max(2, (p.qty / max) * 100)}%` }} />
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 max-sm:ml-7 max-sm:w-[calc(100%-2rem)] max-sm:flex-row max-sm:items-center max-sm:justify-between">
                    <Qty qty={p.qty} unit={p.unit} className={cn("text-sm font-semibold", p.defect ? "text-danger" : "text-text")} />
                    {costClosed && p.cost && (
                      <span className="text-[11px] text-text-muted">
                        <Amount value={p.cost.amount} /> · нэгж <Amount value={p.cost.unitCost} />
                      </span>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-border/60 bg-black/10 pb-1 pl-8">
                    <p className="flex items-center gap-1.5 px-3 pt-2 text-[11px] text-text-muted">
                      <FileText className="size-3.5 text-[#ffd56b]" aria-hidden /> Энэ бүтээгдэхүүний баримтууд
                    </p>
                    <DocLines docs={docs[p.id]} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {semiCount > 0 && words.length === 0 && (
        <button type="button" onClick={() => setShowSemi((v) => !v)} aria-expanded={showSemi} className="focus-ring flex min-h-11 w-full items-center gap-2 border-t border-border px-4 text-xs text-text-muted hover:text-text">
          <ChevronRight aria-hidden className={cn("size-4 transition-transform", showSemi && "rotate-90")} />
          {showSemi ? "Хагас боловсруулсанг нуух" : `Хагас боловсруулсан (${semiCount}) харуулах`}
        </button>
      )}
    </div>
  );
}

const fmt = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(v);

/** Цехээр: гарцын хувь, хагас боловсруулсан, батлаагүй баримтын тоо */
export function DepartmentList({ departments }: { departments: DepartmentRow[] }) {
  if (departments.length === 0) return <p className="px-4 py-10 text-center text-sm text-text-muted">Цехийн гарц бүртгэгдээгүй</p>;
  return (
    <ul className="divide-y divide-border">
      {departments.map((d) => (
        <li key={d.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <span className="min-w-0 flex-1 max-sm:basis-full">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text">
              {d.name}
              <span className="text-[11px] text-text-muted">{d.share.toFixed(1)}%</span>
              {d.unconfirmedDocs > 0 && <UnconfirmedBadge>{d.unconfirmedDocs} баримт батлаагүй</UnconfirmedBadge>}
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
              <span className="block h-full rounded-full bg-[linear-gradient(90deg,#f5b523,#ffd56b)]" style={{ width: `${Math.max(2, d.share)}%` }} />
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
            <QtySum quantities={d.finished} className="text-sm font-semibold text-text" />
            {d.semi.length > 0 && (
              <span className="text-[11px] text-text-muted">
                хагас боловсруулсан <QtySum quantities={d.semi} />
              </span>
            )}
            {d.materialAmount !== null && (
              <span className="text-[11px] text-text-muted">
                материал <Amount value={d.materialAmount} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Бутлан ангилах үйлдвэр: түүхий эдийн гарц (бэлэн бүтээгдэхүүнд ордоггүй) */
export function CrusherSection({ crusher }: { crusher: NonNullable<ProductionView["crusher"]> }) {
  const max = Math.max(1, ...crusher.products.map((p) => p.qty));
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Mountain className="size-4 text-[#ffd56b]" aria-hidden /> Бутлах үйлдвэр
        </h3>
        <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
          {crusher.unconfirmedDocs > 0 && <UnconfirmedBadge>{crusher.unconfirmedDocs} баримт батлаагүй</UnconfirmedBadge>}
          <span>
            Өнөөдөр <QtySum quantities={crusher.today} className="font-semibold text-text" />
          </span>
          <span>
            Сар <QtySum quantities={crusher.total} className="font-semibold text-text" />
          </span>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {crusher.products.map((p: CrusherProduct) => (
          <li key={`${p.name}|${p.unit}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <span className="min-w-0 flex-1 max-sm:basis-full">
              <span className="flex flex-wrap items-center gap-2 text-sm text-text">
                {p.name}
                {p.unconfirmedQty > 0 && <UnconfirmedBadge>Нягтлан батлаагүй {fmt(p.unconfirmedQty)}</UnconfirmedBadge>}
              </span>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                <span className="block h-full rounded-full bg-[#60a5fa]" style={{ width: `${Math.max(2, (p.qty / max) * 100)}%` }} />
              </span>
            </span>
            <Qty qty={p.qty} unit={p.unit} className="shrink-0 text-sm font-semibold text-text" />
          </li>
        ))}
      </ul>
    </div>
  );
}
