"use client";

import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Qty } from "@/components/finance/Qty";
import { Skeleton } from "@/components/ui/Skeleton";
import { isWeekend, shiftMonth } from "@/lib/onec/production-month";
import type { DaySection, GridCell, ProductionGrid } from "@/lib/onec/production-view";
import { cn } from "@/lib/utils";
import type { Quantity } from "@/lib/units";

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

/** «Тайлан хоцорч байна?»: ЗӨВХӨН нэг тохиолдолд: цех сүүлийн 30 хоногт 5+ тайлантай идэвхтэй ажилласан атлаа сүүлийн 7 хоногт тайлангүй. Бусад анхааруулга, улаан өнгө байхгүй. */
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

/** Нэгжийн товч: ширхэг -> ш, шоо метр -> м³, тонн -> т */
export const unitShort = (unit: string): string => ({ ширхэг: "ш", "шоо метр": "м³", тонн: "т", кг: "кг", метр: "м", литр: "л" })[unit] ?? unit;
const numText = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 }).format(v);

const WEEKDAY = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];
const weekdayOf = (date: string) => WEEKDAY[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];

/** Сар сонгогч: ◀ 2026-11 ▶ (календарь); ирээдүй рүү шилжихгүй */
export function MonthBar({ month, current, onMonth }: { month: string; current: string; onMonth: (m: string) => void }) {
  const prev = shiftMonth(month, -1, current);
  const next = shiftMonth(month, 1, current);
  const arrow = "focus-ring ng-panel inline-flex size-10 items-center justify-center rounded-xl text-text-muted hover:text-text disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Өмнөх сар" disabled={!prev} onClick={() => prev && onMonth(prev)} className={arrow}>
          <ChevronLeft className="size-4" />
        </button>
        <label className="ng-panel focus-within:ring-2 focus-within:ring-[rgba(255,213,107,0.6)] relative flex h-10 cursor-pointer items-center gap-2.5 rounded-xl pl-3.5 pr-4 text-sm text-text">
          <CalendarDays className="size-4 text-[#ffd56b]" />
          <span className="ng-num">{month}</span>
          <input
            type="month"
            value={month}
            max={current}
            onChange={(e) => e.target.value && e.target.value <= current && onMonth(e.target.value)}
            onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
            aria-label="Сар сонгох"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <button type="button" aria-label="Дараах сар" disabled={!next} onClick={() => next && onMonth(next)} className={arrow}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      {month !== current && (
        <button type="button" onClick={() => onMonth(current)} className="focus-ring ng-panel h-10 rounded-xl px-3 text-sm text-text-muted hover:text-text">
          Энэ сар
        </button>
      )}
    </div>
  );
}

function QtyLines({ qty }: { qty: Quantity[] }) {
  return (
    <>
      {qty.map((q) => (
        <span key={q.unit} className="block whitespace-nowrap leading-tight">
          <span className="ng-num text-[11px] font-medium">{numText(q.qty)}</span>
          <span className="ml-0.5 text-[9px] text-text-muted">{unitShort(q.unit)}</span>
        </span>
      ))}
    </>
  );
}

/**
 * «Цех × Өдөр»: мөр = цех, багана = сарын өдрүүд, нүд = өдрийн бэлэн гарц (нэгжтэй), баруун талд «Сарын нийт», доод мөр = өдрийн нийт (нэгж тусдаа).
 * Хоосон нүд «·», амралтын өдөр бүдэг, өнөөдөр хүрээтэй, нягтлан батлаагүй нь улбар шар цэгтэй. Гарцгүй цех доор, саарал.
 * Нүд дарвал (өдөр + цех), өдрийн толгой дарвал (өдөр, бүх цех), цехийн нэр дарвал цехийн дэлгэрэнгүй. Утсан дээр хэвтээ гүйлгэнэ, цехийн нэр түгжигдсэн.
 */
export function ProductionGridView({
  grid,
  today,
  selectedDay,
  selectedCard,
  onCell,
  onDay,
  onCard,
}: {
  grid: ProductionGrid;
  today: string;
  selectedDay: string | null;
  selectedCard: string | null;
  onCell: (card: string, day: string) => void;
  onDay: (day: string) => void;
  onCard: (card: string) => void;
}) {
  const sticky = "sticky left-0 z-10 shadow-[1px_0_0_rgba(80,140,240,0.25)]";
  // Түгжигдсэн багана ЗААВАЛ тод (opaque) дэвсгэртэй: үгүй бол гүйлгэсэн өдрүүд цехийн нэрний дээгүүр харагдана
  const stickyBg = { backgroundColor: "#0a1a3c" };
  const colTone = (date: string) => cn(isWeekend(date) && "bg-white/[0.035] text-text-muted", date === today && "shadow-[inset_1px_0_0_#ffd56b,inset_-1px_0_0_#ffd56b]", date === selectedDay && "bg-[rgba(245,181,35,0.1)]");
  const dot = <span className="absolute right-1 top-1 size-1.5 rounded-full bg-[#fb923c]" title="Нягтлан батлаагүй баримт орсон" aria-label="Нягтлан батлаагүй" />;
  const cellBox = "relative z-0 flex min-h-11 w-full min-w-[3.1rem] flex-col items-center justify-center px-1 py-1";

  const renderCell = (cell: GridCell | null, date: string, card: string | null, idle = false) => {
    if (!cell) return <span className={cn(cellBox, "text-text-muted/50")}>·</span>;
    const inner = (
      <>
        <QtyLines qty={cell.qty} />
        {cell.unconfirmed && dot}
      </>
    );
    if (!card) return <span className={cn(cellBox, "font-semibold text-text")}>{inner}</span>;
    return (
      <button
        type="button"
        onClick={() => onCell(card, date)}
        aria-label={`${card}, ${date}`}
        aria-pressed={selectedDay === date && selectedCard === card}
        className={cn(cellBox, "focus-ring hover:bg-white/[0.06]", idle ? "text-text-muted" : "text-text", selectedDay === date && selectedCard === card && "bg-[rgba(245,181,35,0.22)] ring-1 ring-inset ring-[#ffd56b]")}
      >
        {inner}
      </button>
    );
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border bg-bg-surface shadow-card">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th scope="col" style={stickyBg} className={cn(sticky, "z-20 min-w-[7.5rem] max-w-[7.5rem] border-b border-border px-2 py-2 text-left text-[11px] font-medium text-text-muted sm:min-w-[12rem] sm:max-w-none sm:px-3")}>
                Цех
              </th>
              {grid.days.map((d) => (
                <th key={d} scope="col" className={cn("border-b border-border p-0 text-center font-normal", colTone(d))}>
                  <button type="button" onClick={() => onDay(d)} aria-label={`${d}: бүх цех`} aria-pressed={selectedDay === d && !selectedCard} className={cn("focus-ring flex w-full flex-col items-center px-1 py-1.5 hover:bg-white/[0.06]", d === today && "text-[#ffd56b]")}>
                    <span className={cn("ng-num text-[11px] font-semibold", d === today ? "text-[#ffd56b]" : "text-text")}>{Number(d.slice(8, 10))}</span>
                    <span className="text-[9px] text-text-muted">{weekdayOf(d)}</span>
                  </button>
                </th>
              ))}
              <th scope="col" className="min-w-[5.5rem] border-b border-l border-border px-2 py-2 text-right text-[11px] font-medium text-text-muted">
                Сарын нийт
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.name} className={cn(r.idle && "bg-white/[0.02]")}>
                <th scope="row" style={stickyBg} className={cn(sticky, "min-w-[7.5rem] max-w-[7.5rem] border-b border-border px-2 py-1.5 text-left font-normal sm:max-w-none sm:px-3", r.idle && "text-text-muted", selectedCard === r.name && "shadow-[inset_3px_0_0_#ffd56b]")}>
                  <button type="button" onClick={() => onCard(r.name)} aria-pressed={selectedCard === r.name} className="focus-ring block w-full text-left">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className={cn("text-xs font-medium", r.idle ? "text-text-muted" : "text-text")}>{r.name}</span>
                      {r.semi && <span className="rounded-full border border-border px-1.5 py-px text-[9px] text-text-muted">хагас боловсруулсан</span>}
                      {r.lagging && <LagBadge recent={r.recentReports} />}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-text-muted">
                      Сүүлийн тайлан: <span className="ng-num">{lastReportShort(r.lastReport)}</span>
                    </span>
                  </button>
                </th>
                {grid.days.map((d, i) => (
                  <td key={d} className={cn("border-b border-border p-0 text-center align-middle", colTone(d))}>
                    {renderCell(r.cells[i], d, r.name, r.idle)}
                  </td>
                ))}
                <td className="border-b border-l border-border px-2 py-1 text-right align-middle">
                  {r.total.length ? (
                    <span className={cn("inline-block text-right", r.idle && "text-text-muted")}>
                      <QtyLines qty={r.total} />
                    </span>
                  ) : (
                    <span className="text-text-muted/50">—</span>
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" style={stickyBg} className={cn(sticky, "px-3 py-2 text-left text-[11px] font-semibold text-text")}>
                Өдрийн нийт
                <span className="block text-[9px] font-normal text-text-muted">нэгж тусдаа</span>
              </th>
              {grid.days.map((d, i) => (
                <td key={d} className={cn("p-0 text-center align-middle", colTone(d))}>
                  {renderCell(grid.totals.days[i], d, null)}
                </td>
              ))}
              <td className="border-l border-border px-2 py-1 text-right align-middle font-semibold text-text">
                <span className="inline-block text-right">{grid.totals.month.length ? <QtyLines qty={grid.totals.month} /> : "—"}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
        <span className="mr-1 inline-block size-1.5 rounded-full bg-[#fb923c] align-middle" /> нягтлан батлаагүй баримт орсон. «Өдрийн нийт»-д ширхэг, шоо метр тусдаа; хагас боловсруулсан цех (БАЗ, Арматур) орохгүй. Огноо = 1С-д тайлан бичсэн өдөр.
      </p>
    </div>
  );
}

export type DayState = { day: string; sections: DaySection[] } | "loading" | "error";

/** Нүд / өдрийн толгой дарахад: өдрийн задаргаа. Цех бүрийн бүтээгдэхүүн, тоо, брак, засвар, дор нь 1С-ийн баримтын дугаар, цаг (хамгийн доод түвшин). */
export function DayDetailView({ day, card, state, onClose }: { day: string; card: string | null; state: DayState | undefined; onClose: () => void }) {
  return (
    <section aria-label={`${day} задаргаа`} className="rounded-xl border border-[rgba(255,213,107,0.4)] bg-bg-surface shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text">
          <span className="ng-num">{day}</span> · {card ?? "Бүх цех"}
        </h3>
        <button type="button" onClick={onClose} aria-label="Хаах" className="focus-ring inline-flex size-9 items-center justify-center rounded-lg text-text-muted hover:text-text">
          <X className="size-4" />
        </button>
      </header>
      {state === undefined || state === "loading" ? (
        <Skeleton className="m-4 h-32" />
      ) : state === "error" ? (
        <p className="px-4 py-6 text-sm text-danger">Задаргааг татаж чадсангүй</p>
      ) : state.sections.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-text-muted">Энэ өдөр 1С-д тайлан алга</p>
      ) : (
        <div className="divide-y divide-border">
          {state.sections.map((sec) => (
            <div key={sec.card}>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white/[0.02] px-4 py-2 text-sm font-semibold text-text">
                {sec.card}
                {sec.semi && <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-normal text-text-muted">хагас боловсруулсан</span>}
                {sec.unconfirmedDocs > 0 && <UnconfirmedBadge>{sec.unconfirmedDocs} баримт батлаагүй</UnconfirmedBadge>}
              </p>
              <ul className="divide-y divide-border/60">
                {sec.products.map(({ row, docs }) => (
                  <li key={row.id} className={cn("px-4 py-2.5", row.defect && "bg-danger/[0.04]")}>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text">
                        <span className={cn(row.defect && "text-danger")}>{row.name}</span>
                        {row.repairQty > 0 && <span className="text-[11px] text-text-muted">үүнээс засвар {fmt(row.repairQty)}</span>}
                      </span>
                      <Qty qty={row.qty} unit={row.unit} className={cn("text-sm font-semibold", row.defect ? "text-danger" : "text-text")} />
                    </div>
                    <ul className="mt-1.5 space-y-1 text-xs">
                      {docs.map((d, i) => (
                        <li key={`${d.docNumber}|${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-3 text-text-muted">
                          <span className="ng-num w-11 shrink-0">{d.time || "—"}</span>
                          {/* 1С-ийн баримтын дугаар: зөвхөн хамгийн доод түвшинд */}
                          <span className="ng-num shrink-0" title="Баримтын дугаар">
                            Дугаар: {d.docNumber}
                          </span>
                          <span className="min-w-0 flex-1 truncate max-sm:basis-full">{d.department}</span>
                          {d.repair && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px]">засвар</span>}
                          {!d.posted && <UnconfirmedBadge />}
                          <Qty qty={d.quantity} unit={d.unit} className="shrink-0 text-text" />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
