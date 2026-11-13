"use client";

import { FileText, Percent, TrendingUp, Users, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, NUM, money } from "@/components/finance/FinanceShell";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { MonthRefreshNote, RefreshButton, useMonthRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth, YearSection } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { formatNumber } from "@/lib/utils";

// Борлуулалт нь зөвхөн борлуулалт, P&L-ийг ашиглана: мөнгөн хөрөнгийг татахгүй
const SALES_KINDS = ["sales", "pl"] as const;

interface Summary {
  month: string;
  kpi: { revenue: number; cost: number; gross_profit: number; documents: number; clients: number };
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
  const { data, error, loading, reload } = useFinanceData<Summary>(view === "month" ? `/api/dashboard/summary?month=${month}` : null);
  // Хуудас Postgres-ийн өгөгдлөөр шууд нээгдэнэ; одоогийн сар 5 минутаас илүү хуучирсан бол ар талд 1С-ээс татаж, дуусмагц дахин ачаална.
  // Өнгөрсөн сарыг зөвхөн админ татна (сервер мөн шалгана).
  const refresh = useMonthRefresh(month, reload, "month", SALES_KINDS);
  const canRefresh = isCurrent || isAdmin;
  const empty = data && data.daily.length === 0;
  const margin = data && data.kpi.revenue ? (data.kpi.gross_profit / data.kpi.revenue) * 100 : null;

  return (
    <FinanceShell
      title="Борлуулалт"
      withView
      lastSyncedAt={data?.lastSyncedAt}
      notice={view === "month" ? <MonthRefreshNote phase={refresh.phase} retryAt={refresh.retryAt} /> : undefined}
      refresh={view === "month" && canRefresh ? <RefreshButton busy={refresh.busy} retryAt={refresh.retryAt} onClick={refresh.refresh} /> : undefined}
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
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
                ) : data ? (
                  <>
                    <KpiCard label="Борлуулалт" value={money(data.kpi.revenue)} icon={Wallet} tone="accent" />
                    <KpiCard label="Бохир ашиг" value={money(data.kpi.gross_profit)} icon={TrendingUp} tone="success" hint={margin == null ? undefined : `Ашгийн хувь ${margin.toFixed(1)}%`} />
                    <KpiCard label="Борлуулалтын өртөг" value={money(data.kpi.cost)} icon={Percent} />
                    <KpiCard label="Баримт / харилцагч" value={`${formatNumber(data.kpi.documents, 0)} / ${formatNumber(data.kpi.clients, 0)}`} icon={data.kpi.clients ? Users : FileText} />
                  </>
                ) : null}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Өдөр бүрийн борлуулалт</CardTitle>
                </CardHeader>
                <CardBody>{data ? <DailyBarChart data={data.daily} series={[{ key: "revenue", label: "Борлуулалт", color: "rgb(var(--color-accent))" }]} /> : <Skeleton className="h-56" />}</CardBody>
              </Card>

              <div className="grid gap-5 lg:grid-cols-5">
                <Card className="lg:col-span-3">
                  <CardHeader>
                    <CardTitle>Борлуулалт өндөртэй 10 бараа</CardTitle>
                  </CardHeader>
                  {data ? <DataTable data={data.topItems} columns={itemColumns} getRowId={(r) => r.item_code || r.item} searchPlaceholder="Бараа хайх..." /> : <SkeletonTable rows={5} cols={4} />}
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Тэргүүлэх 10 харилцагч</CardTitle>
                  </CardHeader>
                  {data ? <DataTable data={data.topClients} columns={clientColumns} getRowId={(r) => r.client_code || r.client} searchPlaceholder="Харилцагч хайх..." /> : <SkeletonTable rows={5} cols={2} />}
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </FinanceShell>
  );
}
