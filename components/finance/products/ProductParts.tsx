"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Search, X } from "lucide-react";
import { Bars, mnDate, num, shortUnit, type BarItem } from "@/components/finance/production/DirectorParts";
import { addMonths, monthRange } from "@/lib/onec/dates";
import type { ProductCard, ProductDetail } from "@/lib/onec/product-search";
import { cn } from "@/lib/utils";

// «Бүтээгдэхүүн» табын хэсгүүд. Захирлын харагдац: зөвхөн энгийн үгс (үйлдвэрлэсэн, зарсан, агуулахад). Данс, баримтын дугаар, нягтлангийн нэр томьёо энд байхгүй.

export { shortUnit };

const COLOR_PRODUCED = "#f5b523";
const COLOR_SOLD = "#60a5fa";

export type PeriodKey = "this" | "last" | "year" | "month" | "custom";

/** Хугацааны нэр: «Энэ сар», «2026 оны 10-р сар» ... */
export function periodLabel(key: PeriodKey, from: string, to: string): string {
  if (key === "this") return "Энэ сар";
  if (key === "last") return "Өнгөрсөн сар";
  if (key === "year") return "Энэ жил";
  if (key === "month") return `${from.slice(0, 4)} оны ${Number(from.slice(5, 7))}-р сар`;
  return `${from} – ${to}`;
}

/** Хайлтын хайрцаг: бичиж дуусаад 350мс-ийн дараа `onSearch`. Production хуудсанд Enter дарахад л шилжинэ (instant=false). */
export function ProductSearchBox({ value, onSearch, instant = true, autoFocus = false }: { value: string; onSearch: (q: string) => void; instant?: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (!instant || text === last.current) return;
    const t = setTimeout(() => {
      last.current = text;
      onSearch(text.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [text, instant, onSearch]);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        last.current = text;
        onSearch(text.trim());
      }}
      className="ng-panel flex min-h-14 items-center gap-3 rounded-2xl px-4 focus-within:ring-2 focus-within:ring-[rgba(255,213,107,0.6)]"
    >
      <Search className="size-5 shrink-0 text-[#ffd56b]" aria-hidden />
      <input
        type="search"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        placeholder="Бүтээгдэхүүн хайх (1000, дэр, шон)"
        aria-label="Бүтээгдэхүүн хайх"
        enterKeyHint="search"
        className="h-14 min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-muted/70 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button type="button" aria-label="Хайлтыг цэвэрлэх" onClick={() => { setText(""); last.current = ""; onSearch(""); }} className="focus-ring inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:text-text">
          <X className="size-4" />
        </button>
      )}
    </form>
  );
}

/** Хугацаа: Энэ сар / Өнгөрсөн сар / Энэ жил / сар сонгох */
export function PeriodBar({ active, month, today, onPreset, onMonth }: { active: PeriodKey; month: string; today: string; onPreset: (k: "this" | "last" | "year") => void; onMonth: (ym: string) => void }) {
  const chip = (on: boolean) => cn("focus-ring ng-panel h-11 shrink-0 whitespace-nowrap rounded-xl px-3.5 text-sm", on ? "border-[rgba(255,213,107,0.6)] text-[#ffd56b]" : "text-text-muted hover:text-text");
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Хугацаа">
      <button type="button" className={chip(active === "this")} aria-pressed={active === "this"} onClick={() => onPreset("this")}>
        Энэ сар
      </button>
      <button type="button" className={chip(active === "last")} aria-pressed={active === "last"} onClick={() => onPreset("last")}>
        Өнгөрсөн сар
      </button>
      <button type="button" className={chip(active === "year")} aria-pressed={active === "year"} onClick={() => onPreset("year")}>
        Энэ жил
      </button>
      <label className={cn(chip(active === "month"), "relative inline-flex cursor-pointer items-center gap-2 focus-within:ring-2 focus-within:ring-[rgba(255,213,107,0.6)]")}>
        <CalendarDays className="size-4 text-[#ffd56b]" aria-hidden />
        <span>{active === "month" ? `${month.slice(0, 4)} · ${Number(month.slice(5, 7))}-р сар` : "Сар сонгох"}</span>
        <input
          type="month"
          value={month}
          max={today.slice(0, 7)}
          aria-label="Сар сонгох"
          onChange={(e) => e.target.value && e.target.value <= today.slice(0, 7) && onMonth(e.target.value)}
          onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

const qtyText = (v: number | null, unit: string) => (v === null ? "—" : `${num(v)} ${shortUnit(unit)}`);

function Big({ label, value, unit, color }: { label: string; value: number | null; unit: string; color?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span className="ng-num text-[26px] font-semibold leading-none text-text" style={color ? { color } : undefined}>
          {value === null ? "—" : num(value)}
        </span>
        {value !== null && <span className="text-xs text-text-muted">{shortUnit(unit)}</span>}
      </p>
    </div>
  );
}

/** Хайлтын үр дүнгийн нэг карт: нэр · хугацаа; Үйлдвэрлэсэн | Зарсан | Агуулахад одоо; жижгээр Брак, Засвар, Хийсэн цехүүд */
export function ProductCardView({ card, period, open, onToggle, children }: { card: ProductCard; period: string; open: boolean; onToggle: () => void; children?: React.ReactNode }) {
  const small = [card.defect > 0 ? `Брак ${num(card.defect)}` : "", card.repair > 0 ? `Засвар ${num(card.repair)}` : ""].filter(Boolean).join(" · ");
  const shops = card.workshops.map((w) => `${w.short} ${num(w.qty)}`).join(", ");
  const stores = card.warehouses.map((w) => `${w.name} ${num(w.qty)}`).join(", ");
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-bg-surface shadow-card">
      <button type="button" aria-expanded={open} onClick={onToggle} className="focus-ring flex w-full flex-col gap-3 p-4 text-left hover:bg-white/[0.03]">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm font-medium text-text">
            {card.name}
            <span className="text-text-muted"> · {period}</span>
          </span>
          <ChevronDown aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
        </span>
        <span className="grid grid-cols-3 gap-3">
          <Big label="Үйлдвэрлэсэн" value={card.produced} unit={card.unit} color={COLOR_PRODUCED} />
          <Big label="Зарсан" value={card.sold} unit={card.unit} color={card.sold === null ? undefined : COLOR_SOLD} />
          <Big label="Агуулахад одоо" value={card.stock} unit={card.unit} />
        </span>
        {(small || shops || stores) && (
          <span className="flex flex-col gap-0.5 text-xs text-text-muted">
            {small && <span>{small}</span>}
            {shops && <span>Хийсэн: {shops}</span>}
            {stores && <span>Агуулахад: {stores}</span>}
          </span>
        )}
      </button>
      {open && children && <div className="border-t border-border">{children}</div>}
    </li>
  );
}

/** Хайлтгүй үед: хамгийн их үйлдвэрлэсэн/зарсан жагсаалт (мөр дарахад карт) */
export function TopList({ title, items, kind, onPick }: { title: string; items: ProductCard[]; kind: "produced" | "sold"; onPick: (c: ProductCard) => void }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-bg-surface shadow-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{title}</h2>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-muted">Мэдээ ороогүй</p>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((c, i) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)} className="focus-ring flex min-h-12 w-full items-baseline gap-3 px-4 py-2.5 text-left hover:bg-white/[0.04]">
                <span className="w-5 shrink-0 text-xs text-text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 text-sm text-text">{c.name}</span>
                <span className="ng-num shrink-0 text-base font-semibold" style={{ color: kind === "produced" ? COLOR_PRODUCED : COLOR_SOLD }}>
                  {num(kind === "produced" ? c.produced : (c.sold ?? 0))}
                  <span className="ml-1 text-xs font-normal text-text-muted">{shortUnit(c.unit)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const daysInMonth = (ym: string): string[] => {
  const { from, to } = monthRange(ym);
  const out: string[] = [];
  for (let d = Number(from.slice(8)); d <= Number(to.slice(8)); d++) out.push(`${ym}-${String(d).padStart(2, "0")}`);
  return out;
};

/** Хос багана: сар бүрийн үйлдвэрлэсэн (алт), зарсан (цэнхэр) */
function PairBars({ months, showSales, selected, onSelect }: { months: ProductDetail["months"]; showSales: boolean; selected: string | null; onSelect: (m: string) => void }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.produced, m.sold ?? 0]));
  const H = 88;
  const h = (v: number) => (v > 0 ? Math.max(3, (v / max) * H) : 0);
  return (
    <div className="flex w-full items-end gap-[3px]" style={{ height: H + 20 }} role="img" aria-label={showSales ? "Сар бүрийн үйлдвэрлэсэн, зарсан" : "Сар бүрийн үйлдвэрлэсэн"}>
      {months.map((m) => (
        <button
          key={m.month}
          type="button"
          onClick={() => onSelect(m.month)}
          title={`${m.month.slice(0, 4)} оны ${Number(m.month.slice(5, 7))}-р сар: үйлдвэрлэсэн ${num(m.produced)}${showSales ? `, зарсан ${num(m.sold ?? 0)}` : ""}`}
          aria-label={`${Number(m.month.slice(5, 7))}-р сар`}
          aria-pressed={selected === m.month}
          className={cn("focus-ring flex h-full min-w-0 flex-1 flex-col hover:bg-white/[0.05]", selected === m.month && "bg-white/[0.06]")}
        >
          <span className="flex w-full flex-1 items-end justify-center gap-[2px]">
            <span className="block w-1/2 rounded-t-[3px]" style={{ height: h(m.produced), background: COLOR_PRODUCED }} />
            {showSales && <span className="block w-1/2 rounded-t-[3px]" style={{ height: h(m.sold ?? 0), background: COLOR_SOLD }} />}
          </span>
          <span className={cn("h-5 pt-1 text-[10px] leading-none", selected === m.month ? "text-[#ffd56b]" : "text-text-muted")}>{Number(m.month.slice(5, 7))}</span>
        </button>
      ))}
    </div>
  );
}

const Legend = ({ showSales }: { showSales: boolean }) => (
  <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ background: COLOR_PRODUCED }} />
      Үйлдвэрлэсэн
    </span>
    {showSales && (
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: COLOR_SOLD }} />
        Зарсан
      </span>
    )}
  </p>
);

/** Карт дарахад: а) өдөр бүрээр (сонгосон хугацаанд), б) сүүлийн 12 сар */
export function ProductDetailView({ detail, from, to, today, showSales, onMonth }: { detail: ProductDetail; from: string; to: string; today: string; showSales: boolean; onMonth: (ym: string) => void }) {
  const unit = shortUnit(detail.unit);
  const [chartMonth, setChartMonth] = useState(() => (to.slice(0, 7) > today.slice(0, 7) ? today.slice(0, 7) : to.slice(0, 7)));
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    setChartMonth(to.slice(0, 7) > today.slice(0, 7) ? today.slice(0, 7) : to.slice(0, 7));
    setPicked(null);
  }, [from, to, today, detail.id]);

  const byDate = new Map(detail.days.map((d) => [d.date, d]));
  const bars: BarItem[] = daysInMonth(chartMonth).map((date) => {
    const d = byDate.get(date);
    return { key: date, label: String(Number(date.slice(8))), value: d?.produced ?? 0, title: `${mnDate(date)}: ${qtyText(d?.produced ?? 0, detail.unit)}` };
  });
  const rows = detail.days.filter((d) => d.date >= from && d.date <= to);
  const chartMonths = [...new Set([chartMonth, ...detail.months.map((m) => m.month)])];
  const monthSelected = from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : null;

  return (
    <div className="space-y-6 p-4">
      <section aria-label="Өдөр бүрээр" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">Өдөр бүрээр</h3>
          <div className="flex items-center gap-2 text-sm">
            <button type="button" aria-label="Өмнөх сар" onClick={() => setChartMonth(addMonths(chartMonth, -1))} className="focus-ring ng-panel size-9 rounded-lg text-text-muted hover:text-text">‹</button>
            <span className="min-w-24 text-center text-text">{chartMonth.slice(0, 4)} · {Number(chartMonth.slice(5, 7))}-р сар</span>
            <button type="button" aria-label="Дараагийн сар" disabled={chartMonth >= today.slice(0, 7)} onClick={() => setChartMonth(addMonths(chartMonth, 1))} className="focus-ring ng-panel size-9 rounded-lg text-text-muted hover:text-text disabled:opacity-30">›</button>
          </div>
        </div>
        <Bars items={bars} selected={picked} onSelect={(k) => setPicked((p) => (p === k ? null : k))} height={72} labelEvery={5} />
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-text-muted/40 px-4 py-5 text-sm text-text-muted">Энэ хугацаанд хөдөлгөөн алга</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {rows.map((d) => {
              const open = picked === d.date;
              return (
                <li key={d.date} className={cn(open && "bg-white/[0.05]")}>
                  <button type="button" aria-expanded={open} onClick={() => setPicked(open ? null : d.date)} className="focus-ring flex min-h-12 w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-white/[0.04]">
                    <span className="text-text">{mnDate(d.date)}</span>
                    <span className="ng-num text-text-muted">
                      {d.produced !== 0 && <span style={{ color: COLOR_PRODUCED }}>үйлдвэрлэсэн {num(d.produced)} {unit}</span>}
                      {d.produced !== 0 && showSales && d.sold !== null && d.sold !== 0 && " · "}
                      {showSales && d.sold !== null && d.sold !== 0 && <span style={{ color: COLOR_SOLD }}>зарсан {num(d.sold)} {unit}</span>}
                    </span>
                  </button>
                  {open && d.workshops.length > 0 && <p className="px-3 pb-2.5 text-xs text-text-muted">{d.workshops.map((w) => `${w.short} ${num(w.qty)}`).join(" · ")}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Сүүлийн 12 сар" className="space-y-3">
        <h3 className="text-sm font-semibold text-text">Сүүлийн 12 сар</h3>
        <Legend showSales={showSales} />
        <PairBars months={detail.months} showSales={showSales} selected={monthSelected} onSelect={onMonth} />
        <div className="overflow-hidden rounded-lg border border-border text-sm">
          <div className={cn("grid gap-x-2 border-b border-border px-3 py-1.5 text-[11px] text-text-muted", showSales ? "grid-cols-[3.2rem_1fr_1fr_1fr]" : "grid-cols-[3.2rem_1fr]")}>
            <span>Сар</span>
            <span className="text-right">Үйлдвэрлэсэн</span>
            {showSales && <span className="text-right">Зарсан</span>}
            {showSales && <span className="text-right">Эцэст үлдсэн</span>}
          </div>
          <ul className="divide-y divide-border">
            {[...detail.months].reverse().map((m) => (
              <li key={m.month}>
                <button type="button" onClick={() => onMonth(m.month)} className={cn("focus-ring grid min-h-11 w-full items-baseline gap-x-2 px-3 py-2 text-left hover:bg-white/[0.04]", showSales ? "grid-cols-[3.2rem_1fr_1fr_1fr]" : "grid-cols-[3.2rem_1fr]", monthSelected === m.month && "bg-white/[0.06]")}>
                  <span className="text-text-muted">{m.month.slice(2, 4)}/{m.month.slice(5)}</span>
                  <span className="ng-num text-right text-text">{num(m.produced)}</span>
                  {showSales && <span className="ng-num text-right text-text">{num(m.sold ?? 0)}</span>}
                  {showSales && <span className="ng-num text-right text-text-muted">{m.closing === null ? "—" : num(m.closing)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {showSales && <p className="text-[11px] text-text-muted">«Эцэст үлдсэн» нь одоогийн үлдэгдлээс сар бүрийн үйлдвэрлэл, борлуулалтыг хасаж тооцсон тул шилжүүлэг, засвар зэргээс болж бага зэрэг зөрж болно.</p>}
      </section>
    </div>
  );
}
