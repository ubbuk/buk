"use client";

import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { addDays } from "@/lib/onec/dates";
import type { DirectorCard, SimpleProduct } from "@/lib/onec/production-view";
import { unitName, type Quantity } from "@/lib/units";
import { cn } from "@/lib/utils";

// Захирлын харагдац: зөвхөн энгийн үгс (ширхэг, шоо метр, Мэдээ ороогүй, Сүүлд). Нягтлангийн нэр томьёо, баримтын дугаар энд байхгүй.

const WEEKDAY = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];
const MONTH_DAY = (day: string) => `${Number(day.slice(5, 7))}-р сарын ${Number(day.slice(8, 10))}`;
export const mnDate = (day: string) => `${MONTH_DAY(day)}, ${WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]}`;
const mmdd = (day: string) => `${day.slice(5, 7)}-${day.slice(8, 10)}`;
/** 1,919 (мянгатын таслалтай; 100-аас бага бол 1 орон) */
export const num = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 }).format(v);

export const workshopHref = (name: string, day?: string | null) => `/finance/production/${encodeURIComponent(name)}${day ? `?day=${day}` : ""}`;

/** «1,919 ширхэг · 12 шоо метр» */
export function qtyLine(qs: readonly Quantity[]): string {
  const parts = qs.filter((q) => q.qty !== 0).map((q) => `${num(q.qty)} ${unitName(q.unit)}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Өдөр сонгогч: ◀ «11-р сарын 18, Лхагва» ▶, Өнөөдөр, Өчигдөр, календарь. Ирээдүй рүү шилжихгүй. */
export function DayBar({ day, today, onDay }: { day: string; today: string; onDay: (d: string) => void }) {
  const arrow = "focus-ring ng-panel inline-flex size-11 items-center justify-center rounded-xl text-text-muted hover:text-text disabled:pointer-events-none disabled:opacity-30";
  const chip = (active: boolean) => cn("focus-ring ng-panel h-11 rounded-xl px-3.5 text-sm", active ? "border-[rgba(255,213,107,0.6)] text-[#ffd56b]" : "text-text-muted hover:text-text");
  const yesterday = addDays(today, -1);
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Өмнөх өдөр" onClick={() => onDay(addDays(day, -1))} className={arrow}>
          <ChevronLeft className="size-4" />
        </button>
        <label className="ng-panel relative flex h-11 min-w-[11.5rem] cursor-pointer items-center justify-center gap-2.5 rounded-xl px-4 text-sm font-medium text-text focus-within:ring-2 focus-within:ring-[rgba(255,213,107,0.6)]">
          <CalendarDays className="size-4 text-[#ffd56b]" aria-hidden />
          <span>{mnDate(day)}</span>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => e.target.value && e.target.value <= today && onDay(e.target.value)}
            onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
            aria-label="Өдөр сонгох"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <button type="button" aria-label="Дараах өдөр" disabled={day >= today} onClick={() => onDay(addDays(day, 1))} className={arrow}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      <button type="button" onClick={() => onDay(today)} className={chip(day === today)}>
        Өнөөдөр
      </button>
      <button type="button" onClick={() => onDay(yesterday)} className={chip(day === yesterday)}>
        Өчигдөр
      </button>
    </div>
  );
}

/** Нэг том мөр: «Тэр өдөр нийт үйлдвэрлэсэн: 1,919 ширхэг · 3 цех ажилласан» */
export function TotalLine({ total, worked }: { total: readonly Quantity[]; worked: number }) {
  const has = total.some((q) => q.qty > 0);
  return (
    <div className="rounded-xl border border-border bg-bg-surface px-5 py-4 shadow-card">
      {has || worked > 0 ? (
        <p className="text-sm text-text-muted">
          Тэр өдөр нийт үйлдвэрлэсэн: <span className="ng-num text-xl font-semibold text-text sm:text-2xl">{qtyLine(total)}</span>
          <span className="ml-1.5 whitespace-nowrap text-text">· {worked} цех ажилласан</span>
        </p>
      ) : (
        <p className="text-sm text-text-muted">Энэ өдөр үйлдвэрлэлийн мэдээ ороогүй байна</p>
      )}
    </div>
  );
}

/** Цехийн карт: нэр, ТОМ тоо + нэгж, доор гол бүтээгдэхүүн. Мэдээгүй цех: саарал тасархай хүрээ. Улаан, шар тэмдэг байхгүй. */
export function WorkshopCards({ cards, selected, onSelect }: { cards: DirectorCard[]; selected: string | null; onSelect: (name: string) => void }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => {
        const has = c.day.length > 0;
        const active = selected === c.name;
        return (
          <li key={c.name}>
            <button
              type="button"
              onClick={() => onSelect(c.name)}
              aria-pressed={active}
              className={cn(
                "focus-ring flex h-full w-full flex-col items-start rounded-xl p-4 text-left transition-colors", has && "min-h-[8.5rem]",
                has ? "border bg-bg-surface shadow-card hover:bg-white/[0.04]" : "border border-dashed border-text-muted/40 bg-transparent",
                has && (active ? "border-[#ffd56b] bg-[rgba(245,181,35,0.1)]" : "border-border")
              )}
            >
              <span className={cn("text-sm font-medium", has ? "text-text" : "text-text-muted")}>{c.name}</span>
              {has ? (
                <>
                  <span className="mt-2 flex flex-wrap items-baseline gap-x-2">
                    {c.day.map((q) => (
                      <span key={q.unit} className="whitespace-nowrap">
                        <span className="ng-num text-[28px] font-semibold leading-none text-text">{num(q.qty)}</span>
                        <span className="ml-1.5 text-xs text-text-muted">{unitName(q.unit)}</span>
                      </span>
                    ))}
                  </span>
                  <span className="mt-auto pt-3 text-xs text-text-muted">{c.top ? `Гол нь: ${c.top.name}` : ""}</span>
                </>
              ) : (
                <>
                  <span className="mt-3 text-base text-text-muted">Мэдээ ороогүй</span>
                  <span className="mt-auto pt-3 text-xs text-text-muted">{c.lastDay ? `Сүүлд: ${mmdd(c.lastDay)}` : "Сүүлд: —"}</span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Энгийн жагсаалт: бүтээгдэхүүний нэр, тоо */
export function ProductLines({ products, empty = "Мэдээ ороогүй" }: { products: readonly SimpleProduct[]; empty?: string }) {
  if (products.length === 0) return <p className="px-4 py-5 text-sm text-text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {products.map((p) => (
        <li key={`${p.name}|${p.unit}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1 text-text">{p.name}</span>
          <span className="ng-num shrink-0 whitespace-nowrap font-semibold text-text">
            {num(p.qty)} <span className="text-xs font-normal text-text-muted">{unitName(p.unit)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Сонгосон картын өдрийн бүтээгдэхүүн + цехийн хуудас руу линк */
export function CardDayDetail({ card, day, onClose }: { card: DirectorCard; day: string; onClose: () => void }) {
  return (
    <section aria-label={`${card.name}: ${mnDate(day)}`} className="rounded-xl border border-[rgba(255,213,107,0.4)] bg-bg-surface shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text">
          {card.name} <span className="font-normal text-text-muted">· {mnDate(day)}</span>
        </h3>
        <span className="flex items-center gap-2">
          <Link href={workshopHref(card.name, day)} className="focus-ring inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-xs text-[#ffd56b] hover:bg-white/[0.04]">
            Цехийн хуудас →
          </Link>
          <button type="button" onClick={onClose} className="focus-ring min-h-9 rounded-lg border border-border px-3 text-xs text-text-muted hover:text-text">
            Хаах
          </button>
        </span>
      </header>
      <ProductLines products={card.products} />
    </section>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: number;
  title: string;
}

/** Хуудас хэвтээ гүйлгэгдэхгүй багана график (flex): өдөр эсвэл сар бүр нэг багана; дарахад onSelect */
export function Bars({ items, selected, onSelect, height = 96, labelEvery = 5 }: { items: BarItem[]; selected?: string | null; onSelect?: (key: string) => void; height?: number; labelEvery?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex w-full items-end gap-[2px]" style={{ height: height + 18 }} role="img" aria-label="Багана график">
      {items.map((i, idx) => {
        const h = i.value > 0 ? Math.max(3, (i.value / max) * height) : 0;
        const isSel = selected === i.key;
        const bar = (
          <>
            <span className="flex w-full flex-1 items-end">
              <span className={cn("block w-full rounded-t-[3px]", isSel ? "bg-[#ffd56b]" : "bg-[linear-gradient(180deg,#ffd56b,#f5b523)] opacity-80")} style={{ height: h }} />
            </span>
            <span className={cn("h-[18px] pt-1 text-[10px] leading-none", isSel ? "text-[#ffd56b]" : "text-text-muted")}>{idx % labelEvery === 0 || isSel ? i.label : ""}</span>
          </>
        );
        const box = "flex h-full min-w-0 flex-1 flex-col";
        return onSelect ? (
          <button key={i.key} type="button" title={i.title} aria-label={i.title} aria-pressed={isSel} onClick={() => onSelect(i.key)} className={cn(box, "focus-ring hover:bg-white/[0.05]")}>
            {bar}
          </button>
        ) : (
          <div key={i.key} title={i.title} className={box}>
            {bar}
          </div>
        );
      })}
    </div>
  );
}

export const dayBars = (days: DirectorCard["monthDays"], unit: string): BarItem[] => days.map((d) => ({ key: d.date, label: String(Number(d.date.slice(8, 10))), value: d.qty, title: `${MONTH_DAY(d.date)}: ${num(d.qty)} ${unitName(unit)}` }));

/** «11-р сар — нийт явц»: цех бүр нэг мөр (нэр | хэвтээ багана | сарын нийт). Мөр дарахад сарын бүтээгдэхүүн, өдөр бүрийн багана. */
export function MonthProgress({ cards, month, day, selected, onSelect }: { cards: DirectorCard[]; month: string; day: string; selected: string | null; onSelect: (name: string) => void }) {
  const rows = [...cards].sort((a, b) => Number(b.monthQty > 0) - Number(a.monthQty > 0));
  const maxBy = new Map<string, number>();
  for (const c of rows) maxBy.set(c.unit, Math.max(maxBy.get(c.unit) ?? 0, c.monthQty));
  return (
    <section className="rounded-xl border border-border bg-bg-surface shadow-card">
      <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-text">{Number(month.slice(5, 7))}-р сар — нийт явц</h2>
      <ul className="divide-y divide-border">
        {rows.map((c) => {
          const open = selected === c.name;
          const has = c.monthQty > 0;
          const pct = has ? Math.max(2, (c.monthQty / (maxBy.get(c.unit) || 1)) * 100) : 0;
          return (
            <li key={c.name}>
              <button type="button" aria-expanded={open} onClick={() => onSelect(c.name)} className="focus-ring flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 text-left hover:bg-white/[0.03] sm:flex-nowrap">
                <span className={cn("min-w-0 flex-1 text-sm sm:w-56 sm:flex-none", has ? "text-text" : "text-text-muted")}>{c.name}</span>
                <span className="order-last h-2.5 min-w-0 basis-full overflow-hidden rounded-full bg-white/5 sm:order-none sm:basis-auto sm:flex-1" aria-hidden>
                  <span className="block h-full rounded-full bg-[linear-gradient(90deg,#f5b523,#ffd56b)]" style={{ width: `${pct}%` }} />
                </span>
                <span className={cn("ng-num ml-auto shrink-0 whitespace-nowrap text-sm font-semibold sm:w-40 sm:text-right", has ? "text-text" : "font-normal text-text-muted")}>{has ? qtyLine(c.month) : "Мэдээ ороогүй"}</span>
                <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
              </button>
              {open && (
                <div className="space-y-3 border-t border-border bg-white/[0.015] px-5 py-4">
                  {has ? (
                    <>
                      <Bars items={dayBars(c.monthDays, c.unit)} />
                      <div className="-mx-5 border-t border-border">
                        <ProductLines products={c.monthProducts} />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-text-muted">Энэ сард мэдээ ороогүй</p>
                  )}
                  <Link href={workshopHref(c.name, day)} className="focus-ring inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-xs text-[#ffd56b] hover:bg-white/[0.04]">
                    Цехийн хуудас →
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
