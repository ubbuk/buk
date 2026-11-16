"use client";

import { useMemo, useState } from "react";
import { FileText, Package, Percent, ShoppingCart, TrendingUp, Users, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell, NUM, connectionFrom, money } from "@/components/finance/FinanceShell";
import { GranularChart } from "@/components/finance/GranularChart";
import { FinanceKpi as KpiCard, ViewToggle, rankColumn, type ViewMode } from "@/components/finance/NgParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { MonthRefreshNote, RefreshButton, todayUb, useMonthRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth, YearSection } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { formatNumber } from "@/lib/utils";

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

const itemColumns: DataTableColumn<ItemRow>[] = [
  { key: "item", header: "Бараа", sortable: true, accessor: (r) => r.item || r.item_code, render: (r) => <span className="text-text">{r.item || r.item_code}</span> },
  { key: "qty", header: "Тоо", sortable: true, accessor: (r) => r.qty, render: (r) => formatNumber(r.qty), className: NUM },
  { key: "revenue", header: "Борлуулалт", sortable: true, accessor: (r) => r.revenue, render: (r) => money(r.revenue), className: NUM },
  { key: "profit", header: "Бохир ашиг", sortable: true, accessor: (r) => r.gross_profit, render: (r) => money(r.gross_profit), className: NUM },
];

const clientColumns: DataTableColumn<ClientRow>[] = [
  { key: "client", header: "Харилцагч", sortable: true, accessor: (r) => r.client || "Тодорхойгүй", render: (r) => <span className="text-text">{r.client || "Тодорхойгүй"}</span> },
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
  const itemCols = useMemo(() => (data ? [rankColumn(data.topItems), ...itemColumns] : itemColumns), [data]);
  const clientCols = useMemo(() => (data ? [rankColumn(data.topClients), ...clientColumns] : clientColumns), [data]);

  return (
    <FinanceShell
      title="Борлуулалт"
      subtitle="Борлуулалт, бохир ашиг, шилдэг бараа ба харилцагч"
      icon={ShoppingCart}
      withView
      lastSyncedAt={data?.lastSyncedAt}
      connection={connectionFrom(data?.lastSyncedAt, refresh.phase === "failed" || refresh.phase === "error")}
      notice={view === "month" ? <MonthRefreshNote phase={refresh.phase} retryAt={refresh.retryAt} /> : undefined}
      refresh={view === "month" && canRefresh ? <RefreshButton busy={refresh.busy} retryAt={refresh.retryAt} onClick={refresh.refresh} /> : undefined}
      trailing={view === "month" ? <ViewToggle value={mode} onChange={setMode} /> : undefined}
    >
      {view === "year" ? (
        <YearSection tab="sales" year={year} label="борлуулалт" />
      ) : (
        <>
          {error && <ErrorNote message={error} />}

          {empty ? (
            <MissingMonth busy={refresh.busy} onLoad={refresh.refresh} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {loading && !data ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
                ) : data ? (
                  <>
                    <KpiCard featured spark={spark} label="Борлуулалт" value={money(data.kpi.revenue)} icon={Wallet} tone="accent" />
                    <KpiCard label="Бохир ашиг" value={money(data.kpi.gross_profit)} icon={TrendingUp} tone="success" hint={margin == null ? undefined : `Ашгийн хувь ${margin.toFixed(1)}%`} />
                    <KpiCard label="Борлуулалтын өртөг" value={money(data.kpi.cost)} icon={Percent} />
                    <KpiCard label="Баримт / харилцагч" value={`${formatNumber(data.kpi.documents, 0)} / ${formatNumber(data.kpi.clients, 0)}`} icon={data.kpi.clients ? Users : FileText} />
                  </>
                ) : null}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Борлуулалтын өртгийн задаргаа</CardTitle>
                  <span className="text-xs text-text-muted">Нийт өртөг, бохир ашиг өөрчлөгдөхгүй</span>
                </CardHeader>
                <CardBody>
                  {data ? (
                    <dl className="grid gap-2 text-sm sm:max-w-xl">
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-text-muted">Борлуулсан барааны өртөг (баримтаар)</dt>
                        <dd className="ng-num text-text">{money(data.kpi.cost_documents)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-text-muted">Шаардах хуудсаар шууд өртөгт бичсэн</dt>
                        <dd className="ng-num text-text">{money(data.kpi.cost_requisitions)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
                        <dt className="font-medium text-text">Борлуулалтын өртөг (нийт)</dt>
                        <dd className="ng-num font-medium text-text">{money(data.kpi.cost)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <Skeleton className="h-20" />
                  )}
                </CardBody>
              </Card>

              {mode === "chart" && (
                <Card>
                  <CardHeader>
                    <CardTitle>Өдөр бүрийн борлуулалт</CardTitle>
                  </CardHeader>
                  <CardBody>{data ? <GranularChart data={data.daily} keys={["revenue"]} today={isCurrent ? todayUb() : undefined} series={[{ key: "revenue", label: "Борлуулалт", color: "rgb(var(--color-accent))" }]} /> : <Skeleton className="h-56" />}</CardBody>
                </Card>
              )}

              <div className="grid gap-5 lg:grid-cols-5">
                <Card className="min-w-0 lg:col-span-3">
                  {data ? (
                    <DataTable
                      heading={
                        <>
                          <Package className="size-4 text-[#ffd56b]" />
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
                </Card>
                <Card className="min-w-0 lg:col-span-2">
                  {data ? (
                    <DataTable
                      heading={
                        <>
                          <Users className="size-4 text-[#ffd56b]" />
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
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </FinanceShell>
  );
}
