"use client";

import Image from "next/image";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Delta, Sparkline } from "@/components/finance/NgParts";
import { cn } from "@/lib/utils";

// «Зарцуулалтын шинжилгээ» хуудасны зөвхөн харагдацын бүрэлдэхүүнүүд (өгөгдөл, тооцоо хуудаснаас шууд ирнэ).

export function BrandMark() {
  return (
    <div className="uc-brand">
      <Image src="/images/ubbuk-logo-mark.webp" alt="" width={40} height={40} className="size-10 object-contain" />
      <div className="leading-tight">
        <p className="uc-brand-name">УБ БҮК ХК</p>
        <p className="uc-brand-sub">Ulaanbaatar Buk JSC</p>
      </div>
    </div>
  );
}

type Accent = "gold" | "green" | "blue" | "violet";

/** KPI карт: дүрс, гарчиг, том тоо, заавал биш харьцуулалтын % ба тайлбар; `spark`: хуримтлагдсан бодит цуваа */
export function UsageKpi({ label, value, icon: Icon, accent, delta, hint, spark }: { label: string; value: string; icon: LucideIcon; accent: Accent; delta?: number | null; hint?: string; spark?: number[] }) {
  return (
    <div className={cn("uc-kpi", `uc-${accent}`)}>
      {spark && spark.length > 1 && <Sparkline values={spark} className="uc-spark" />}
      <span className="uc-kpi-icon">
        <Icon className="size-[22px]" />
      </span>
      <div className="uc-kpi-text">
        <p className="uc-kpi-label">{label}</p>
        <p className="uc-kpi-value ng-num">{value}</p>
        {(delta != null || hint) && (
          <div className="uc-kpi-foot">
            {delta != null && <Delta pct={delta} costLike />}
            {hint && <span>{hint}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function PanelHead({ icon: Icon, title, aside }: { icon: LucideIcon; title: string; aside?: React.ReactNode }) {
  return (
    <div className="uc-panel-head">
      <span className="uc-panel-icon">
        <Icon className="size-4" />
      </span>
      <h3>{title}</h3>
      {aside && <div className="ml-auto min-w-0">{aside}</div>}
    </div>
  );
}

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Зарцуулалтын бүтцийн donut: нэг бүлэглэлтийн (материал / хэлтэс / агуулах) бодит дүнгүүд. Төвд нийт дүн. */
export function UsageDonut({ slices, total, caption }: { slices: DonutSlice[]; total: string; caption: string }) {
  const sum = slices.reduce((a, s) => a + Math.max(s.value, 0), 0);
  const r = 46;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="uc-donut-wrap">
      <svg viewBox="0 0 120 120" className="uc-donut" role="img" aria-label={`${caption}: ${slices.map((s) => s.label).join(", ")}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(110,170,235,0.14)" strokeWidth="14" />
        {sum > 0 &&
          slices.map((s) => {
            const len = (Math.max(s.value, 0) / sum) * c;
            const el = <circle key={s.key} cx="60" cy="60" r={r} fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={`${Math.max(len - 1.2, 0)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />;
            off += len;
            return el;
          })}
      </svg>
      <div className="uc-donut-center">
        <p className="ng-num">{total}</p>
        <p>{caption}</p>
      </div>
    </div>
  );
}

const SIZES = [10, 15, 20] as const;

/** Хуудаслалтын хуудасны дугааруудын жагсаалт: 1 … хүрээ … сүүлийн хуудас (null = «…») */
function pageList(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set([1, count, page - 1, page, page + 1].filter((n) => n >= 1 && n <= count));
  const out: (number | null)[] = [];
  let prev = 0;
  for (const n of [...set].sort((a, b) => a - b)) {
    if (n - prev > 1) out.push(null);
    out.push(n);
    prev = n;
  }
  return out;
}

/**
 * Хайлт, эрэмбэлэлттэй хүснэгт + клиент талын хуудаслалт (10 / 15 / 20). `DataTable`-тэй ижил хайлт, эрэмбийн дүрэм; хуудаслалт нь
 * хайлт, эрэмбийн ДАРАА бүх мөр дээр ажиллана: мөр хаяхгүй. Нарийн дэлгэц дээр хүснэгт хэвтээ гүйнэ.
 */
export function PagedTable<T>({ data, columns, getRowId, heading, searchPlaceholder = "Хайх...", emptyTitle = "Өгөгдөл олдсонгүй", unit = "баримт" }: { data: T[]; columns: DataTableColumn<T>[]; getRowId: (row: T) => string; heading?: React.ReactNode; searchPlaceholder?: string; emptyTitle?: string; unit?: string }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [size, setSize] = useState<(typeof SIZES)[number]>(10);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let rows = data;
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter((row) => columns.some((col) => String(col.accessor(row) ?? "").toLowerCase().includes(q)));
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        rows = [...rows].sort((a, b) => {
          const av = col.accessor(a);
          const bv = col.accessor(b);
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return rows;
  }, [data, columns, query, sortKey, sortDir]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pageCount);
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(current * size, total);
  const visible = filtered.slice((current - 1) * size, current * size);

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
    setPage(1);
  }

  return (
    <div className="uc-paged">
      <div className="uc-paged-bar">
        {heading && <div className="uc-paged-title">{heading}</div>}
        <label className="uc-search">
          <Search className="size-3.5 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </label>
        <label className="uc-size">
          <span>Нэг хуудсанд</span>
          <select
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value) as (typeof SIZES)[number]);
              setPage(1);
            }}
            aria-label="Нэг хуудсанд харуулах мөр"
          >
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n} мөр
              </option>
            ))}
          </select>
        </label>
      </div>

      {total === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <div className="uc-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className={col.className} aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                    {col.sortable ? (
                      <button type="button" onClick={() => toggleSort(col.key)} className="focus-ring">
                        {col.header}
                        {sortKey === col.key ? sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      <span>{col.header}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={getRowId(row)}>
                  {columns.map((col) => (
                    <td key={col.key} className={col.className}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="uc-pager">
        <p aria-live="polite">
          {from}-{to} / {total} {unit}
        </p>
        <nav aria-label="Хуудаслалт">
          <button type="button" className="uc-page-btn focus-ring" onClick={() => setPage(current - 1)} disabled={current <= 1} aria-label="Өмнөх хуудас">
            <ChevronLeft className="size-4" />
          </button>
          {pageList(current, pageCount).map((n, i) =>
            n === null ? (
              <span key={`gap${i}`} className="uc-page-gap" aria-hidden>
                …
              </span>
            ) : (
              <button key={n} type="button" className={cn("uc-page-btn focus-ring", n === current && "uc-page-on")} onClick={() => setPage(n)} aria-label={`${n}-р хуудас`} aria-current={n === current ? "page" : undefined}>
                {n}
              </button>
            )
          )}
          <button type="button" className="uc-page-btn focus-ring" onClick={() => setPage(current + 1)} disabled={current >= pageCount} aria-label="Дараах хуудас">
            <ChevronRight className="size-4" />
          </button>
        </nav>
      </div>
    </div>
  );
}
