"use client";

import { useState } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, FileText } from "lucide-react";
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

/** «Тайлан хоцорч байна?»: ЗӨВХӨН нэг тохиолдолд: цех сүүлийн 30 хоногт 5+ тайлантай идэвхтэй ажилласан атлаа сүүлийн 7 хоногт тайлангүй. Жижиг шар тэмдэг; бусад анхааруулга, улаан өнгө байхгүй. */
export function LagBadge({ recent }: { recent: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-px text-[10px] font-medium text-warning" title={`Сүүлийн 30 хоногт ${recent} тайлантай байсан, сүүлийн 7 хоногт тайлан ороогүй`}>
      <AlertTriangle className="size-2.5" aria-hidden />
      Тайлан хоцорч байна?
    </span>
  );
}

/** «11-24 (өчигдөр)», «10-29 (27 хоногийн өмнө)» */
export function lastReportShort(lr: { day: string; daysAgo: number } | null): string {
  if (!lr) return "тайлан алга";
  const ago = lr.daysAgo === 0 ? "өнөөдөр" : lr.daysAgo === 1 ? "өчигдөр" : `${lr.daysAgo} хоногийн өмнө`;
  return `${mmdd(lr.day)} (${ago})`;
}

/** Хамгийн доод түвшин: өдрөөр задарсан баримтууд (өдрийн нийт, дугаар, цаг) */
function DocLines({ docs }: { docs: DocState | undefined }) {
  if (docs === "loading" || docs === undefined) return <Skeleton className="m-2 h-16" />;
  if (docs === "error") return <p className="px-3 py-3 text-xs text-danger">Баримтыг татаж чадсангүй</p>;
  if (docs.length === 0) return <p className="px-3 py-3 text-xs text-text-muted">Баримт олдсонгүй</p>;
  const days: { day: string; unit: string; total: number; docs: DocLine[] }[] = [];
  for (const d of docs) {
    let g = days.find((x) => x.day === d.day);
    if (!g) days.push((g = { day: d.day, unit: d.unit, total: 0, docs: [] }));
    g.total += d.quantity;
    g.docs.push(d);
  }
  return (
    <div className="text-xs">
      {days.map((g) => (
        <div key={g.day} className="border-b border-border/60 last:border-b-0">
          <p className="flex items-center justify-between gap-3 bg-white/[0.02] px-3 py-1.5 font-medium text-text">
            <span className="ng-num">{mmdd(g.day)}</span>
            <Qty qty={Math.round(g.total * 1000) / 1000} unit={g.unit} className="text-text" />
          </p>
          <ul className="divide-y divide-border/40">
            {g.docs.map((d, i) => (
              <li key={`${d.docNumber}|${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 pl-6">
                <span className="ng-num shrink-0 text-text-muted">{d.time || "—"}</span>
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
        </div>
      ))}
    </div>
  );
}

/** Бүтээгдэхүүн бүр мөр + зурвас + тоо. Мөрийг дарвал өдрөөр задарна (өдөр бүрийн тоо, баримтын дугаар, цаг). */
export function ProductRows({ products, getDocs, onOpen }: { products: ProductRow[]; getDocs: (id: string) => DocState | undefined; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...products.filter((p) => !p.defect).map((p) => p.qty));
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
                {!p.defect && (
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                    <span className={cn("block h-full rounded-full", p.stage === "crusher" ? "bg-[#60a5fa]" : p.stage === "semi" ? "bg-[#a78bfa]" : "bg-[linear-gradient(90deg,#f5b523,#ffd56b)]")} style={{ width: `${Math.max(2, (p.qty / max) * 100)}%` }} />
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 max-sm:ml-7 max-sm:w-[calc(100%-2rem)] max-sm:flex-row max-sm:items-center max-sm:justify-between">
                <Qty qty={p.qty} unit={p.unit} className={cn("text-sm font-semibold", p.defect ? "text-danger" : "text-text")} />
                {p.cost && (
                  <span className="text-[11px] text-text-muted">
                    <Amount value={p.cost.amount} /> · нэгж <Amount value={p.cost.unitCost} />
                  </span>
                )}
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-border/60 bg-black/10 pb-1 pl-8">
                <p className="flex items-center gap-1.5 px-3 pt-2 text-[11px] text-text-muted">
                  <FileText className="size-3.5 text-[#ffd56b]" aria-hidden /> Өдрөөр, баримтаар
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

/**
 * Хураангуй хүснэгт: Цех | Гарц | Гол бүтээгдэхүүн | Сүүлийн тайлан. ЗӨВХӨН сонгосон хугацаанд гарцтай цехүүд, их гарцаараа. Мөрийг дарвал тэр цех сонгогдоно.
 * Гарцгүй цехүүд доор нэг саарал мөрөнд (өнгөгүй; «Тайлан хоцорч байна?» шар тэмдгээс бусад анхааруулга байхгүй).
 */
export function SummaryTable({ cards, periodWord, selected, onSelect }: { cards: ProductionCard[]; periodWord: string; selected: string | null; onSelect: (name: string) => void }) {
  const active = cards.filter((c) => c.periodTotal > 0).sort((a, b) => b.periodTotal - a.periodTotal || a.name.localeCompare(b.name, "mn"));
  const idle = cards.filter((c) => c.periodTotal <= 0);
  const head = "text-[11px] font-medium text-text-muted";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-surface shadow-card">
      {active.length > 0 && (
        <div role="table" aria-label="Цехийн хураангуй">
          <div role="row" className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)] gap-x-4 border-b border-border px-4 py-2 md:grid">
            <span role="columnheader" className={head}>
              Цех
            </span>
            <span role="columnheader" className={head}>
              {periodWord}
            </span>
            <span role="columnheader" className={head}>
              Гол бүтээгдэхүүн
            </span>
            <span role="columnheader" className={head}>
              Сүүлийн тайлан
            </span>
          </div>
          <ul className="divide-y divide-border">
            {active.map((c) => (
              <li key={c.name} role="row">
                <button
                  type="button"
                  aria-pressed={selected === c.name}
                  onClick={() => onSelect(c.name)}
                  className={cn(
                    "focus-ring grid w-full grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-white/[0.03] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)] md:items-center",
                    selected === c.name && "bg-[rgba(245,181,35,0.07)] shadow-[inset_3px_0_0_#ffd56b]"
                  )}
                >
                  <span role="cell" className="col-span-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-text">
                      {c.name}
                      {c.semi && <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-normal text-text-muted">хагас боловсруулсан</span>}
                      {c.lagging && <LagBadge recent={c.recentReports} />}
                    </span>
                    {c.unconfigured && <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">Тохиргоогүй хэлтэс: {c.departments.join(" · ")}</span>}
                  </span>
                  <span role="cell" className="min-w-0 justify-self-end text-right md:justify-self-start md:text-left">
                    <QtySum quantities={c.period} className="text-base font-semibold text-text" />
                  </span>
                  <span role="cell" className="col-span-2 min-w-0 text-sm text-text md:col-span-1">
                    {c.top ? (
                      <>
                        <span className="text-text-muted md:hidden">Гол: </span>
                        {c.top.name} <Qty qty={c.top.qty} unit={c.top.unit} className="text-text-muted" />
                      </>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </span>
                  <span role="cell" className="col-span-2 min-w-0 text-xs text-text-muted md:col-span-1 md:text-sm">
                    <span className="md:hidden">Сүүлийн тайлан: </span>
                    <span className="ng-num">{lastReportShort(c.lastReport)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {idle.length > 0 && (
        <p className={cn("bg-white/[0.03] px-4 py-2.5 text-xs leading-relaxed text-text-muted", active.length > 0 && "border-t border-border")}>
          {periodWord} тайлангүй:{" "}
          {idle.map((c, i) => (
            <span key={c.name}>
              {i > 0 && ", "}
              <button type="button" onClick={() => onSelect(c.name)} className="focus-ring rounded underline-offset-2 hover:text-text hover:underline">
                {c.name}
              </button>{" "}
              <span className="ng-num">({c.lastReport ? `сүүлд ${mmdd(c.lastReport.day)}` : "тайлан алга"})</span>
              {c.lagging && (
                <>
                  {" "}
                  <LagBadge recent={c.recentReports} />
                </>
              )}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Сонгосон цехийн дэлгэрэнгүй: 1С-ийн хэлтсүүд, энэ сар, сүүлийн 7 хоног, сүүлийн тайлан */
export function CardDetail({ card, onClear }: { card: ProductionCard; onClear: () => void }) {
  return (
    <div className="rounded-xl border border-[rgba(255,213,107,0.4)] bg-bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-text">
            {card.name}
            {card.semi && <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-normal text-text-muted">хагас боловсруулсан</span>}
            {card.lagging && <LagBadge recent={card.recentReports} />}
          </h3>
          <p className="mt-1 text-[11px] leading-snug text-text-muted">1С-ийн хэлтэс: {card.departments.join(" · ") || "—"}</p>
        </div>
        <button type="button" onClick={onClear} className="focus-ring min-h-9 rounded-lg border border-border px-3 text-xs text-text-muted hover:text-text">
          Бүх цех
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] text-text-muted">Энэ сар</dt>
          <dd className="mt-0.5 text-sm font-semibold text-text">
            <QtySum quantities={card.month} />
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-text-muted">Сүүлийн 7 хоног</dt>
          <dd className="mt-0.5 text-sm font-semibold text-text">
            <QtySum quantities={card.week} />
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-[11px] text-text-muted">Сүүлийн тайлан</dt>
          <dd className="ng-num mt-0.5 text-sm text-text">{lastReportShort(card.lastReport)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Сонгосон хугацаанд тайлан алга */
export function EmptyPeriod({ showMonthButton, onMonth }: { showMonthButton: boolean; onMonth: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="text-sm text-text-muted">Энэ хугацаанд 1С-д тайлан алга</p>
      {showMonthButton && (
        <button type="button" onClick={onMonth} className="focus-ring min-h-10 rounded-xl border border-[rgba(255,213,107,0.6)] bg-[rgba(245,181,35,0.12)] px-4 text-sm font-medium text-[#ffd56b] hover:bg-[rgba(245,181,35,0.2)]">
          Энэ сар руу шилжих
        </button>
      )}
    </div>
  );
}

/** Гол хүснэгт: цех бүрийн хэсэг, дотор нь бүтээгдэхүүн × тоо × нэгж; мөрийг дарвал өдрөөр задарна */
export function ProductTable({ cards, getDocs, onOpen }: { cards: ProductionCard[]; getDocs: (card: string, id: string) => DocState | undefined; onOpen: (card: string, id: string) => void }) {
  const shown = cards.filter((c) => !c.empty);
  if (shown.length === 0) return null;
  return (
    <div className="divide-y divide-border">
      {shown.map((c) => (
        <section key={c.name} aria-label={c.name}>
          <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-white/[0.02] px-4 py-2.5">
            <h4 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-text">
              {c.name}
              {c.semi && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-normal text-text-muted">хагас боловсруулсан</span>}
              {c.unconfirmedDocs > 0 && <UnconfirmedBadge>{c.unconfirmedDocs} баримт батлаагүй</UnconfirmedBadge>}
            </h4>
            <QtySum quantities={c.period} className="text-sm font-semibold text-text" />
          </header>
          <ProductRows products={c.products} getDocs={(id) => getDocs(c.name, id)} onOpen={(id) => onOpen(c.name, id)} />
        </section>
      ))}
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
