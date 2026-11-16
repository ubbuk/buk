"use client";

import { useMemo, useState } from "react";
import { Boxes, Coins, Factory, FileText, Layers, ListChecks, Search, Warehouse, Wallet, X } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell, NUM, money } from "@/components/finance/FinanceShell";
import { GranularChart } from "@/components/finance/GranularChart";
import { FinanceKpi as KpiCard, SegmentedTabs, ViewToggle, type ViewMode } from "@/components/finance/NgParts";
import { RankedRows, type RankedRow } from "@/components/finance/RankedRows";
import { KeeperLabel } from "@/components/finance/StockTree";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton, todayUb } from "@/components/finance/useOnecRefresh";
import { useUrlFilters } from "@/components/finance/useUrlFilters";
import { useYm } from "@/components/finance/useYm";
import { formatNumber } from "@/lib/utils";
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

  return (
    <FinanceShell
      title="Зарцуулалт"
      subtitle="1С-ээс татсан материалын зарцуулалтын мэдээлэл"
      icon={Coins}
      lastSyncedAt={data?.meta.fetchedAt}
      connection={error || data?.meta.stale ? "offline" : data ? "ok" : null}
      refresh={<RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />}
      controls={
        <>
          <label className="ng-panel relative flex h-10 min-w-0 flex-1 basis-56 items-center gap-2 rounded-xl px-3 text-sm text-text max-sm:basis-full">
            <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
            <input
              type="search"
              value={f.qInput}
              onChange={(e) => f.setQInput(e.target.value)}
              placeholder="Материал, хэлтэс, агуулах хайх..."
              aria-label="Материал, хэлтэс, агуулах хайх"
              className="focus-ring h-full min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
            />
          </label>
          {f.q && (
            <button type="button" onClick={() => f.clear([])} className="focus-ring ng-panel inline-flex h-10 items-center gap-1 rounded-xl px-3 text-sm text-text-muted hover:text-text">
              <X className="size-4" aria-hidden />
              Хайлт арилгах
            </button>
          )}
        </>
      }
      trailing={<ViewToggle value={mode} onChange={setMode} />}
    >
      {error && <ErrorNote message={data ? `${error}. Сүүлд татсан өгөгдлийг харуулж байна.` : error} />}
      {data?.meta.stale && <ErrorNote message="1С холбогдохгүй байна. Сүүлд татсан өгөгдлийг харуулж байна." />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1.35fr_1fr_1fr_1fr]">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : data ? (
          <>
            <KpiCard featured spark={spark} label="Нийт зарцуулалт" value={money(data.totals.amount)} icon={Wallet} tone="accent" delta={cmp?.changePct} deltaCostLike hint={compareHint(cmp)} />
            <KpiCard label="Шаардах хуудас" value={formatNumber(data.totals.documents, 0)} icon={FileText} delta={cmp?.documentsChangePct} deltaCostLike hint={compareHint(cmp)} />
            <KpiCard label="Материалын төрөл" value={formatNumber(data.totals.materials, 0)} icon={Boxes} />
            <KpiCard label="Хэлтэс, цех" value={formatNumber(data.byDepartment.length, 0)} icon={Layers} />
          </>
        ) : null}
      </div>

      {empty ? (
        <Card>
          <EmptyState title="Энэ сард батлагдсан шаардах хуудас алга" description="Дээрээс өөр сар сонгоно уу." />
        </Card>
      ) : (
        <>
          {mode === "chart" && (
            <Card>
              <CardHeader>
                <CardTitle>Өдөр бүрийн зарцуулалт</CardTitle>
              </CardHeader>
              <CardBody>
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
              </CardBody>
            </Card>
          )}

          <Card className="min-w-0">
            <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <SegmentedTabs label="Зарцуулалтын харагдац" value={tab} onChange={(v) => f.set("tab", v === "material" ? "" : v)} tabs={tabs} />
            </CardHeader>
            {data ? <RankedRows key={tab} rows={rows} query={f.q} /> : <SkeletonTable rows={6} cols={4} />}
          </Card>

          <Card>
            {data ? (
              <DataTable
                heading={
                  <>
                    <ListChecks className="size-4 text-[#ffd56b]" />
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
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
