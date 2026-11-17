"use client";

import { useMemo, useState } from "react";
import { BarChart3, Boxes, Factory, FileText, Layers, ListChecks, PieChart, Search, Warehouse, Wallet, X } from "lucide-react";
import type { DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, NUM, formatStamp, money } from "@/components/finance/FinanceShell";
import { FinanceTabs } from "@/components/finance/FinanceTabs";
import { GranularChart } from "@/components/finance/GranularChart";
import { SegmentedTabs, ViewToggle, type ViewMode } from "@/components/finance/NgParts";
import { RankedRows, type RankedRow } from "@/components/finance/RankedRows";
import { KeeperLabel } from "@/components/finance/StockTree";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton, todayUb } from "@/components/finance/useOnecRefresh";
import { useUrlFilters } from "@/components/finance/useUrlFilters";
import { YmPicker, useYm } from "@/components/finance/useYm";
import { BrandMark, PagedTable, PanelHead, UsageDonut, UsageKpi, type DonutSlice } from "@/components/finance/usage/UsageParts";
import "@/components/finance/usage/usage-cc.css";
import { cn, formatNumber } from "@/lib/utils";
import type { UsageDepartment, UsageDocument, UsageMaterial } from "@/lib/onec/usage";
import type { UsageComparison, UsageWarehouse } from "@/lib/onec/usage-compare";

interface UsageResponse {
  month: string;
  totals: { amount: number; documents: number; materials: number };
  byMaterial: UsageMaterial[];
  byDepartment: UsageDepartment[];
  byWarehouse: UsageWarehouse[];
  daily: { date: string; amount: number; previous?: number }[];
  /** өмнөх сарын мөн үетэй харьцуулалт; өмнөх сарыг татаж чадаагүй бол null */
  comparison: UsageComparison | null;
  documents: UsageDocument[];
  meta: OdataMeta;
}

const documentColumns: DataTableColumn<UsageDocument>[] = [
  { key: "date", header: "Огноо", sortable: true, accessor: (r) => r.date, render: (r) => <span className="ng-num">{r.date.slice(0, 10)}</span> },
  { key: "number", header: "Дугаар", sortable: true, accessor: (r) => r.number, render: (r) => <span className="ng-num">{r.number}</span> },
  { key: "department", header: "Хэлтэс, цех", sortable: true, accessor: (r) => r.department, render: (r) => r.department },
  { key: "warehouse", header: "Агуулах", sortable: true, accessor: (r) => r.warehouse, render: (r) => r.warehouse },
  { key: "purpose", header: "Зориулалт", accessor: (r) => `${r.purpose} ${r.recipient}`, render: (r) => (
      <div className="max-w-[22rem]">
        <p className="truncate text-text">{r.purpose || "—"}</p>
        {r.recipient && <p className="truncate text-[11px] text-text-muted">{r.recipient}</p>}
      </div>
    ) },
  { key: "amount", header: "Дүн", sortable: true, accessor: (r) => r.amount, className: NUM, render: (r) => money(r.amount) },
];

type Tab = "material" | "dept" | "warehouse";
const TABS = [
  { value: "material", label: "Материалаар", short: "Материал", icon: Boxes },
  { value: "dept", label: "Хэлтэс, цехээр", short: "Хэлтэс, цех", icon: Factory },
  { value: "warehouse", label: "Агуулахаар", short: "Агуулах", icon: Warehouse },
] as const;
const isTab = (v: string): v is Tab => TABS.some((t) => t.value === v);

const DONUT_COLORS = ["#f4c45a", "#24b8ff", "#35d9a4", "#9b8cff", "#f3b54a"];
const DONUT_REST = "#5f7595";

/** «Өмнөх сарын 1-12-той харьцуулахад» / «Өмнөх сартай харьцуулахад» */
const compareHint = (c: UsageComparison | null) => (c ? (c.throughDay ? `Өмнөх сарын 1–${c.throughDay}-той харьцуулахад` : "Өмнөх сартай харьцуулахад") : undefined);

export default function UsagePage() {
  const { ym: month, isCurrent } = useYm();
  const { data, error, loading, retryAt, refresh } = useOdataData<UsageResponse>(`/api/dashboard/usage?month=${month}`);
  // Таб, хайлт нь URL-д: ?tab=material|dept|warehouse&q= (components/finance/useUrlFilters.ts)
  const f = useUrlFilters(["tab"] as const);
  const tab: Tab = isTab(f.values.tab) ? f.values.tab : "material";
  const [mode, setMode] = useState<ViewMode>("chart");
  const empty = data && data.documents.length === 0;
  const cmp = data?.comparison ?? null;

  const spark = useMemo(() => {
    let acc = 0;
    return (data?.daily ?? []).filter((d) => !isCurrent || d.date <= todayUb()).map((d) => (acc += d.amount));
  }, [data, isCurrent]);

  const rows = useMemo<RankedRow[]>(() => {
    if (!data) return [];
    if (tab === "material") {
      return data.byMaterial.map((m) => ({
        key: m.key,
        name: m.name,
        sub: `${formatNumber(m.quantity, 2)}${m.unit ? ` ${m.unit}` : ""} · ${formatNumber(m.documents, 0)} баримт`,
        amount: m.amount,
        search: m.name,
      }));
    }
    if (tab === "dept") {
      return data.byDepartment.map((d) => ({ key: d.name, name: d.name, sub: `${formatNumber(d.documents, 0)} баримт`, amount: d.amount, search: d.name }));
    }
    return data.byWarehouse.map((w) => ({
      key: w.key,
      name: w.name,
      sub: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {w.mapped ? <span>{w.group ?? "Бүлэггүй"}</span> : <span className="text-warning">ERP-д холбогдоогүй</span>}
          {w.mapped && <KeeperLabel keeper={w.keeper} />}
          <span>· {formatNumber(w.documents, 0)} баримт</span>
        </span>
      ),
      amount: w.amount,
      search: `${w.name} ${w.group ?? ""} ${w.keeper?.name ?? ""}`,
    }));
  }, [data, tab]);

  const counts: Record<Tab, number> = { material: data?.byMaterial.length ?? 0, dept: data?.byDepartment.length ?? 0, warehouse: data?.byWarehouse.length ?? 0 };
  const tabs = TABS.map((t) => ({ ...t, label: data ? `${t.label} (${formatNumber(counts[t.value], 0)})` : t.label, shortLabel: data ? `${t.short} (${formatNumber(counts[t.value], 0)})` : t.short }));

  // Donut: сонгосон бүлэглэлтийн (таб) нэг хэмжээсийн дүнгүүд. Эхний 5 + «Бусад» (үлдсэн мөрүүдийн нийлбэр). Материал, хэлтэс, агуулахыг хольж нэгтгэхгүй.
  const slices = useMemo<DonutSlice[]>(() => {
    const sorted = [...rows].sort((a, b) => b.amount - a.amount);
    const top = sorted.slice(0, 5).map((r, i) => ({ key: r.key, label: r.name, value: r.amount, color: DONUT_COLORS[i] }));
    const rest = sorted.slice(5);
    return rest.length ? [...top, { key: "__rest", label: `Бусад (${formatNumber(rest.length, 0)})`, value: rest.reduce((a, r) => a + r.amount, 0), color: DONUT_REST }] : top;
  }, [rows]);
  const tabLabel = TABS.find((t) => t.value === tab)?.label ?? "";
  const connection = error || data?.meta.stale ? "offline" : data ? "ok" : null;

  return (
    <div className="usage-cc">
      <header className="uc-header">
        <BrandMark />
        <div className="uc-titleblock">
          <p className="uc-eyebrow">Санхүүгийн удирдлага</p>
          <h1>Зарцуулалтын шинжилгээ</h1>
          <p className="uc-subtitle">1С-ээс татсан материалын зарцуулалтын мэдээлэл</p>
        </div>
        <div className="uc-header-right">
          <YmPicker />
          {connection && <span className={cn("uc-conn", connection === "ok" ? "uc-conn-ok" : "uc-conn-off")}>{connection === "ok" ? "1С холбогдсон" : "1С холбогдохгүй"}</span>}
          <div className="uc-sync-time">
            <p>Сүүлд шинэчилсэн</p>
            <p className="ng-num">{formatStamp(data?.meta.fetchedAt)}</p>
          </div>
          <RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />
          <ViewToggle value={mode} onChange={setMode} />
        </div>
      </header>

      <div className="uc-nav">
        <FinanceTabs />
      </div>

      {error && <ErrorNote message={data ? `${error}. Сүүлд татсан өгөгдлийг харуулж байна.` : error} />}
      {data?.meta.stale && <ErrorNote message="1С холбогдохгүй байна. Сүүлд татсан өгөгдлийг харуулж байна." />}

      <div className="uc-kpis">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : data ? (
          <>
            <UsageKpi accent="gold" spark={spark} label="Нийт зарцуулалт" value={money(data.totals.amount)} icon={Wallet} delta={cmp?.changePct} hint={compareHint(cmp)} />
            <UsageKpi accent="green" label="Шаардах хуудас" value={formatNumber(data.totals.documents, 0)} icon={FileText} delta={cmp?.documentsChangePct} hint={compareHint(cmp)} />
            <UsageKpi accent="blue" label="Материалын төрөл" value={formatNumber(data.totals.materials, 0)} icon={Boxes} />
            <UsageKpi accent="violet" label="Хэлтэс, цех" value={formatNumber(data.byDepartment.length, 0)} icon={Layers} />
          </>
        ) : null}
      </div>

      {empty ? (
        <div className="uc-card">
          <EmptyState title="Энэ сард батлагдсан шаардах хуудас алга" description="Дээрээс өөр сар сонгоно уу." />
        </div>
      ) : (
        <>
          <div className={cn("uc-analytics", mode !== "chart" && "uc-analytics-solo")}>
            {mode === "chart" && (
              <section className="uc-card uc-chart-card">
                <PanelHead icon={BarChart3} title="Өдөр бүрийн зарцуулалт" />
                <div className="uc-chart">
                  {data ? (
                    <GranularChart
                      data={data.daily}
                      keys={cmp ? ["amount", "previous"] : ["amount"]}
                      today={isCurrent ? todayUb() : undefined}
                      series={[
                        { key: "amount", label: "Энэ сар", color: "rgb(var(--color-accent))" },
                        ...(cmp ? [{ key: "previous", label: "Өмнөх сар", color: "rgba(148,163,184,0.55)" }] : []),
                      ]}
                    />
                  ) : (
                    <Skeleton className="h-56" />
                  )}
                </div>
              </section>
            )}

            <section className="uc-card uc-structure">
              <PanelHead icon={PieChart} title="Зарцуулалтын бүтэц" aside={<span className="uc-hint">{tabLabel}</span>} />
              {data ? (
                <div className="uc-structure-body">
                  <UsageDonut slices={slices} total={money(data.totals.amount)} caption="Нийт зарцуулалт" />
                  <ul className="uc-legend">
                    {slices.map((s) => (
                      <li key={s.key}>
                        <i style={{ background: s.color }} />
                        <span className="uc-legend-name" title={s.label}>{s.label}</span>
                        <span className="ng-num">{money(s.value)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Skeleton className="m-4 h-40" />
              )}
            </section>
          </div>

          <SegmentedTabs label="Зарцуулалтын харагдац" value={tab} onChange={(v) => f.set("tab", v === "material" ? "" : v)} tabs={tabs} />

          <section className="uc-card uc-ranked">
            <div className="uc-ranked-bar">
              <label className="uc-search">
                <Search className="size-3.5 shrink-0" aria-hidden />
                <input type="search" value={f.qInput} onChange={(e) => f.setQInput(e.target.value)} placeholder="Материал, хэлтэс, агуулах хайх..." aria-label="Материал, хэлтэс, агуулах хайх" />
              </label>
              {f.q && (
                <button type="button" onClick={() => f.clear([])} className="uc-clear focus-ring">
                  <X className="size-4" aria-hidden />
                  Хайлт арилгах
                </button>
              )}
            </div>
            {data ? <RankedRows key={tab} rows={rows} query={f.q} /> : <SkeletonTable rows={6} cols={4} />}
          </section>

          <section className="uc-card">
            {data ? (
              <PagedTable
                heading={
                  <>
                    <ListChecks className="size-4 text-[#f4c45a]" />
                    Шаардах хуудасны жагсаалт
                  </>
                }
                data={data.documents}
                columns={documentColumns}
                getRowId={(r) => r.id}
                searchPlaceholder="Дугаар, хэлтэс, зориулалтаар хайх..."
              />
            ) : (
              <SkeletonTable rows={8} cols={6} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
