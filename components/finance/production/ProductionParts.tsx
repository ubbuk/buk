"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, FileText, Search } from "lucide-react";
import { Amount } from "@/components/finance/cash/Amount";
import { Qty, QtySum } from "@/components/finance/Qty";
import { Skeleton } from "@/components/ui/Skeleton";
import { activePreset, presetRange, rangeLabel, shiftRange, type DateRange, type RangePreset } from "@/lib/onec/production-range";
import type { DocLine, ProductionCard, ProductRow } from "@/lib/onec/production-view";
import { cn } from "@/lib/utils";

export type DocState = DocLine[] | "loading" | "error";

const fmt = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(v);
const mmdd = (day: string) => `${day.slice(5, 7)}-${day.slice(8, 10)}`;

/** «Нягтлан батлаагүй» шар тэмдэг: 1С-д баримт хараахан батлагдаагүй (Posted=false), тоо нь нийт дүнд орсон */
export function UnconfirmedBadge({ children = "Нягтлан батлаагүй", className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning", className)}>
      <AlertTriangle className="size-3" aria-hidden />
      {children}
    </span>
  );
}

/** Хамгийн доод түвшин: баримтын дугаар, огноо, цаг */
function DocLines({ docs }: { docs: DocState | undefined }) {
  if (docs === "loading" || docs === undefined) return <Skeleton className="m-2 h-16" />;
  if (docs === "error") return <p className="px-3 py-3 text-xs text-danger">Баримтыг татаж чадсангүй</p>;
  if (docs.length === 0) return <p className="px-3 py-3 text-xs text-text-muted">Баримт олдсонгүй</p>;
  return (
    <ul className="divide-y divide-border/60 text-xs">
      {docs.map((d, i) => (
        <li key={`${d.docNumber}|${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="ng-num shrink-0 text-text-muted">
            {mmdd(d.day)}
            {d.time && <span className="ml-1.5">{d.time}</span>}
          </span>
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

/** Бүтээгдэхүүн бүр мөр + зурвас + тоо. Мөрийг дарвал тэр бүтээгдэхүүний баримтууд (дугаар, огноо, цаг). */
export function ProductRows({ products, costClosed = false, getDocs, onOpen }: { products: ProductRow[]; costClosed?: boolean; getDocs: (id: string) => DocState | undefined; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...products.filter((p) => !p.defect && p.stage !== "semi").map((p) => p.qty));
  return (
    <ul className="divide-y divide-border">
      {products.map((p) => {
        const isOpen = open === p.id;
        return (
          <li key={p.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => {
                setOpen(isOpen ? null : p.id);
                if (!isOpen) onOpen(p.id);
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
                {!p.defect && p.stage !== "semi" && (
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                    <span className={cn("block h-full rounded-full", p.stage === "crusher" ? "bg-[#60a5fa]" : "bg-[linear-gradient(90deg,#f5b523,#ffd56b)]")} style={{ width: `${Math.max(2, (p.qty / max) * 100)}%` }} />
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
                <DocLines docs={getDocs(p.id)} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Цех бүр нэг карт: гарчигт нэр + сонгосон хугацаа, баруун дээд буланд «Өнөөдөр · Сар», доор бүтээгдэхүүн бүр. Дэд хэлтсүүд эх цехийнхээ картанд. */
export function ProductionCardView({ card, label, getDocs, onOpen }: { card: ProductionCard; label: string; getDocs: (id: string) => DocState | undefined; onOpen: (id: string) => void }) {
  return (
    <section className="rounded-xl border border-border bg-bg-surface shadow-card" aria-label={card.name}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">
            {card.name} <span className="ng-num ml-1 text-[11px] font-normal text-text-muted">· {label}</span>
          </h3>
          {card.subDepartments.length > 0 && <p className="mt-1 text-[11px] leading-snug text-text-muted">{card.subDepartments.join(" · ")}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          {card.unconfirmedDocs > 0 && <UnconfirmedBadge>{card.unconfirmedDocs} баримт батлаагүй</UnconfirmedBadge>}
          <span>
            Өнөөдөр <QtySum quantities={card.today} className="font-semibold text-text" />
          </span>
          <span>
            Сар <QtySum quantities={card.month} className="font-semibold text-text" />
          </span>
        </div>
      </header>
      {card.empty ? <p className="px-4 py-3 text-[11px] text-text-muted">— үйлдвэрлэлгүй</p> : <ProductRows products={card.products} getDocs={getDocs} onOpen={onOpen} />}
    </section>
  );
}

/** Бүтээгдэхүүнээр нэгдсэн жагсаалт: хайлттай, хагас боловсруулсан нь нуугдсан */
export function ProductList({ products, costClosed, getDocs, onOpen }: { products: ProductRow[]; costClosed: boolean; getDocs: (id: string) => DocState | undefined; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [showSemi, setShowSemi] = useState(false);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = useMemo(() => products.filter((p) => words.every((w) => p.name.toLowerCase().includes(w))), [products, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const semiCount = list.filter((p) => p.stage === "semi").length;
  const shown = list.filter((p) => p.stage !== "semi" || showSemi || words.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-b border-border p-4">
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
        <p className="px-4 py-10 text-center text-sm text-text-muted">{products.length ? "Хайлтад тохирох бүтээгдэхүүн олдсонгүй" : "Сонгосон хугацаанд гарц бүртгэгдээгүй"}</p>
      ) : (
        <ProductRows products={shown} costClosed={costClosed} getDocs={getDocs} onOpen={onOpen} />
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

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "today", label: "Өнөөдөр" },
  { id: "yesterday", label: "Өчигдөр" },
  { id: "week", label: "Энэ 7 хоног" },
  { id: "month", label: "Энэ сар" },
];

/** Хугацаа сонгогч: [Өнөөдөр] [Өчигдөр] [Энэ 7 хоног] [Энэ сар] ◀ ▶ календарь + «Бүх цех ▾» шүүлтүүр */
export function RangeBar({ period, today, groups, group, onRange, onGroup }: { period: DateRange; today: string; groups: string[]; group: string | null; onRange: (r: DateRange) => void; onGroup: (g: string | null) => void }) {
  const active = activePreset(period, today);
  const prev = shiftRange(period, -1, today);
  const next = shiftRange(period, 1, today);
  const arrow = "focus-ring ng-panel inline-flex size-10 items-center justify-center rounded-xl text-text-muted hover:text-text disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div role="group" aria-label="Хугацаа" className="ng-panel inline-flex max-w-full rounded-xl p-1 text-sm max-sm:grid max-sm:w-full max-sm:grid-cols-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            onClick={() => onRange(presetRange(p.id, today))}
            className={cn("focus-ring h-8 shrink-0 whitespace-nowrap rounded-lg px-3 transition-colors", active === p.id ? "bg-[rgba(245,181,35,0.16)] text-[#ffd56b] shadow-[0_0_0_1px_rgba(255,213,107,0.5)_inset]" : "text-text-muted hover:text-text")}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Өмнөх хугацаа" disabled={!prev} onClick={() => prev && onRange(prev)} className={arrow}>
          <ChevronLeft className="size-4" />
        </button>
        <label className="ng-panel focus-within:ring-2 focus-within:ring-[rgba(255,213,107,0.6)] relative flex h-10 cursor-pointer items-center gap-2.5 rounded-xl pl-3.5 pr-3 text-sm text-text">
          <CalendarDays className="size-4 text-[#ffd56b]" />
          <span className="ng-num">{rangeLabel(period)}</span>
          <input
            type="date"
            value={period.to}
            max={today}
            onChange={(e) => e.target.value && e.target.value <= today && onRange({ from: e.target.value, to: e.target.value })}
            onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
            aria-label="Өдөр сонгох"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <button type="button" aria-label="Дараах хугацаа" disabled={!next} onClick={() => next && onRange(next)} className={arrow}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      <label className="ng-panel focus-within:ring-2 focus-within:ring-[rgba(255,213,107,0.6)] relative flex h-10 min-w-0 items-center rounded-xl pl-3.5 pr-9 text-sm text-text max-sm:w-full">
        <select value={group ?? ""} onChange={(e) => onGroup(e.target.value || null)} aria-label="Цех" className="h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-2 focus:outline-none">
          <option value="" className="bg-bg-elevated">
            Бүх цех
          </option>
          {groups.map((g) => (
            <option key={g} value={g} className="bg-bg-elevated">
              {g}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 size-3.5 text-text-muted" aria-hidden />
      </label>
    </div>
  );
}
