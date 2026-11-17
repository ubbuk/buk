"use client";

import { useMemo, useState } from "react";
import { BarChart3, Layers, Package, Percent, PieChart, TrendingUp, Users, Wallet } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, NUM, connectionFrom, formatStamp, money } from "@/components/finance/FinanceShell";
import { FinanceTabs } from "@/components/finance/FinanceTabs";
import { GranularChart } from "@/components/finance/GranularChart";
import { Sparkline, ViewToggle, type ViewMode } from "@/components/finance/NgParts";
import { BrandMark, CcKpi, CostDonut, Hologram, PanelHead, ShareBar, ccRankColumn } from "@/components/finance/sales/CommandParts";
import "@/components/finance/sales/sales-cc.css";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { MonthRefreshNote, RefreshButton, todayUb, useMonthRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth, YearSection } from "@/components/finance/YearSection";
import { YmPicker, useIsAdmin, useYm } from "@/components/finance/useYm";
import { cn, formatNumber } from "@/lib/utils";

// Борлуулалт нь зөвхөн борлуулалт, P&L-ийг ашиглана: мөнгөн хөрөнгийг татахгүй
const SALES_KINDS = ["sales", "pl"] as const;

interface Summary {
  month: string;
  kpi: { revenue: number; cost: number; cost_documents: number; cost_requisitions: number; gross_profit: number; documents: number; clients: number };
  daily: { date: string; revenue: number; gross_profit: number }[];
  topItems: { item_code: string; item: string; qty: number; revenue: number; gross_profit: number }[];
  topClients: { client_code: string; client: string; revenue: number }[];
  pl: { income: number; expense: number; netProfit: number };
  lastSyncedAt: string | null;
}

type ItemRow = Summary["topItems"][number];
type ClientRow = Summary["topClients"][number];

const itemColumns = (maxRevenue: number): DataTableColumn<ItemRow>[] => [
  {
    key: "item",
    header: "Бараа",
    sortable: true,
    accessor: (r) => r.item || r.item_code,
    render: (r) => (
      <span className="cc-name">
        <span className="text-text">{r.item || r.item_code}</span>
        <ShareBar value={r.revenue} max={maxRevenue} />
      </span>
    ),
  },
  { key: "qty", header: "Тоо", sortable: true, accessor: (r) => r.qty, render: (r) => formatNumber(r.qty), className: NUM },
  { key: "revenue", header: "Борлуулалт", sortable: true, accessor: (r) => r.revenue, render: (r) => money(r.revenue), className: NUM },
  { key: "profit", header: "Бохир ашиг", sortable: true, accessor: (r) => r.gross_profit, render: (r) => <span className="cc-profit">{money(r.gross_profit)}</span>, className: NUM },
];

const clientColumns = (maxRevenue: number): DataTableColumn<ClientRow>[] => [
  {
    key: "client",
    header: "Харилцагч",
    sortable: true,
    accessor: (r) => r.client || "Тодорхойгүй",
    render: (r) => (
      <span className="cc-name">
        <span className="text-text">{r.client || "Тодорхойгүй"}</span>
        <ShareBar value={r.revenue} max={maxRevenue} />
      </span>
    ),
  },
  { key: "revenue", header: "Борлуулалт", sortable: true, accessor: (r) => r.revenue, render: (r) => money(r.revenue), className: NUM },
];

export default function SalesPage() {
  const { ym: month, isCurrent, view, year } = useYm();
  const isAdmin = useIsAdmin();
  const [mode, setMode] = useState<ViewMode>("chart");
  const { data, error, loading, reload } = useFinanceData<Summary>(view === "month" ? `/api/dashboard/summary?month=${month}` : null);
  // Хуудас Postgres-ийн өгөгдлөөр шууд нээгдэнэ; одоогийн сар 5 минутаас илүү хуучирсан бол ар талд 1С-ээс татаж, дуусмагц дахин ачаална.
  // Өнгөрсөн сарыг зөвхөн админ татна (сервер мөн шалгана).
  const refresh = useMonthRefresh(month, reload, "month", SALES_KINDS);
  const canRefresh = isCurrent || isAdmin;
  const empty = data && data.daily.length === 0;
  const margin = data && data.kpi.revenue ? (data.kpi.gross_profit / data.kpi.revenue) * 100 : null;
  // Хуримтлагдсан борлуулалт (бодит өдрийн цувааны нийлбэр) - гол KPI-ийн sparkline
  const spark = useMemo(() => {
    let acc = 0;
    return (data?.daily ?? []).filter((d) => !isCurrent || d.date <= todayUb()).map((d) => (acc += d.revenue));
  }, [data, isCurrent]);
  const itemCols = useMemo(() => (data ? [ccRankColumn(data.topItems), ...itemColumns(Math.max(0, ...data.topItems.map((r) => r.revenue)))] : itemColumns(0)), [data]);
  const clientCols = useMemo(() => (data ? [ccRankColumn(data.topClients), ...clientColumns(Math.max(0, ...data.topClients.map((r) => r.revenue)))] : clientColumns(0)), [data]);

  const costCard = data ? (
    <section className={cn("cc-card cc-cost", mode === "table" && "cc-cost-wide")}>
      <PanelHead icon={PieChart} title="Борлуулалтын өртгийн задаргаа" />
      <div className="cc-cost-body">
        <CostDonut
          parts={[
            { label: "Баримтаар", value: data.kpi.cost_documents, color: "#24b8ff", money: money(data.kpi.cost_documents) },
            { label: "Шаардах хуудсаар", value: data.kpi.cost_requisitions, color: "#f4c45a", money: money(data.kpi.cost_requisitions) },
          ]}
        />
        <dl className="cc-cost-list">
          <div className="cc-cost-row">
            <dt><i style={{ background: "#24b8ff" }} />Борлуулсан барааны өртөг (баримтаар)</dt>
            <dd className="ng-num">{money(data.kpi.cost_documents)}</dd>
          </div>
          <div className="cc-cost-row">
            <dt><i style={{ background: "#f4c45a" }} />Шаардах хуудсаар шууд өртөгт бичсэн</dt>
            <dd className="ng-num">{money(data.kpi.cost_requisitions)}</dd>
          </div>
          <div className="cc-cost-row cc-cost-total">
            <dt>Борлуулалтын өртөг (нийт)</dt>
            <dd className="ng-num">{money(data.kpi.cost)}</dd>
          </div>
        </dl>
      </div>
    </section>
  ) : (
    <section className="cc-card cc-cost">
      <Skeleton className="m-4 h-24" />
    </section>
  );

  return (
    <div className="sales-cc">
      <aside className="cc-rail" aria-label="Санхүүгийн цэс">
        <FinanceTabs />
      </aside>

      <div className="cc-main">
        <header className="cc-header">
          <BrandMark />
          <div className="cc-titleblock">
            <p className="cc-eyebrow-tag">Санхүүгийн удирдлага</p>
            <h1>Борлуулалтын шинжилгээ</h1>
            <p className="cc-subtitle">Удирдлагын санхүүгийн хяналтын самбар</p>
          </div>
          <div className="cc-header-right">
            <YmPicker withView />
            {view === "month" && <ViewToggle value={mode} onChange={setMode} />}
          </div>
        </header>

        {view === "month" && <MonthRefreshNote phase={refresh.phase} retryAt={refresh.retryAt} />}

        {view === "year" ? (
          <div className="cc-card cc-year">
            <YearSection tab="sales" year={year} label="борлуулалт" />
          </div>
        ) : (
          <>
            {error && <ErrorNote message={error} />}

            {empty ? (
              <div className="cc-card cc-year">
                <MissingMonth busy={refresh.busy} onLoad={refresh.refresh} />
              </div>
            ) : (
              <>
                <div className="cc-kpis">
                  {loading && !data ? (
                    Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
                  ) : data ? (
                    <>
                      <CcKpi accent="gold" label="Нийт борлуулалт" value={money(data.kpi.revenue)} icon={Wallet} spark={<Sparkline values={spark} className="absolute inset-x-0 bottom-0 w-full" />} hint={`${formatNumber(data.kpi.documents, 0)} баримт · ${formatNumber(data.kpi.clients, 0)} харилцагч`} />
                      <CcKpi accent="green" label="Бохир ашиг" value={money(data.kpi.gross_profit)} icon={TrendingUp} />
                      <CcKpi accent="blue" label="Борлуулалтын өртөг" value={money(data.kpi.cost)} icon={Layers} />
                      <CcKpi accent="violet" label="Ашгийн хувь" value={margin == null ? "—" : `${margin.toFixed(1)}%`} icon={Percent} ring={margin} />
                    </>
                  ) : null}
                </div>

                <div className="cc-stage">
                  <section className="cc-card cc-table cc-left">
                    {data ? (
                      <DataTable
                        heading={
                          <>
                            <Package className="size-4 text-[#f4c45a]" />
                            Борлуулалт өндөртэй 10 бараа
                          </>
                        }
                        data={data.topItems}
                        columns={itemCols}
                        getRowId={(r) => r.item_code || r.item}
                        searchPlaceholder="Бараа хайх..."
                      />
                    ) : (
                      <SkeletonTable rows={5} cols={4} />
                    )}
                  </section>

                  <section className="cc-card cc-center">
                    {mode === "chart" ? (
                      <>
                        <PanelHead icon={BarChart3} title="Өдөр бүрийн борлуулалт" aside={<span className="cc-legend"><i />Борлуулалт</span>} />
                        <div className="cc-chart">{data ? <GranularChart data={data.daily} keys={["revenue"]} today={isCurrent ? todayUb() : undefined} series={[{ key: "revenue", label: "Борлуулалт", color: "rgb(var(--color-accent))" }]} /> : <Skeleton className="h-56" />}</div>
                      </>
                    ) : (
                      costCard
                    )}
                  </section>

                  <section className="cc-card cc-table cc-right">
                    {data ? (
                      <DataTable
                        heading={
                          <>
                            <Users className="size-4 text-[#f4c45a]" />
                            Тэргүүлэх 10 харилцагч
                          </>
                        }
                        data={data.topClients}
                        columns={clientCols}
                        getRowId={(r) => r.client_code || r.client}
                        searchPlaceholder="Харилцагч хайх..."
                      />
                    ) : (
                      <SkeletonTable rows={5} cols={2} />
                    )}
                  </section>

                  <div className="cc-holo-row">
                    <Hologram />
                    {mode === "chart" && <div className="cc-holo-cost">{costCard}</div>}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        <footer className="cc-bottom">
          <FinanceTabs />
          <div className="cc-sync">
            {(() => {
              const c = connectionFrom(data?.lastSyncedAt, refresh.phase === "failed" || refresh.phase === "error");
              return c && <span className={cn("cc-conn", c === "ok" ? "cc-conn-ok" : "cc-conn-off")}>{c === "ok" ? "1С холбогдсон" : "1С холбогдохгүй"}</span>;
            })()}
            <div className="cc-sync-time">
              <p>Сүүлд шинэчилсэн</p>
              <p className="ng-num">{formatStamp(data?.lastSyncedAt)}</p>
            </div>
            {view === "month" && canRefresh ? <RefreshButton busy={refresh.busy} retryAt={refresh.retryAt} onClick={refresh.refresh} /> : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
