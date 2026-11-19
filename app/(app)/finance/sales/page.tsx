"use client";

import { useState } from "react";
import { FileText, Layers, Percent, TrendingUp, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, connectionFrom } from "@/components/finance/FinanceShell";
import { FinanceKpi as KpiCard } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import { SalesLists } from "@/components/finance/sales/SalesLists";
import { DocumentList } from "@/components/finance/docs/DocumentList";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { MonthRefreshNote, RefreshButton, useMonthRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth, YearSection } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { formatMoneyFull, formatMoneyShort } from "@/lib/money-short";
import { monthRange } from "@/lib/onec/dates";
import type { SalesClient, SalesItem, SalesKpi } from "@/lib/onec/sales-view";

// Борлуулалт нь зөвхөн борлуулалт, P&L-ийг ашиглана: мөнгөн хөрөнгийг татахгүй
const SALES_KINDS = ["sales", "pl"] as const;

interface SalesResponse {
  month: string;
  kpi: SalesKpi;
  clients: SalesClient[];
  items: SalesItem[];
  trend: { month: string; revenue: number; profit: number }[];
  lastSyncedAt: string | null;
}

const MN_MONTH = (ym: string) => `${ym.slice(0, 4)} оны ${Number(ym.slice(5, 7))}-р сар`;

export default function SalesPage() {
  const { ym: month, isCurrent, view, year } = useYm();
  const isAdmin = useIsAdmin();
  // Харилцагчийн борлуулалтын баримтууд: хамгийн доод drill-down (баримтын дугаар, огноо)
  const [docClient, setDocClient] = useState<SalesClient | null>(null);
  const { data, error, loading, reload } = useFinanceData<SalesResponse>(view === "month" ? `/api/dashboard/sales?month=${month}` : null);
  // Хуудас Postgres-ийн өгөгдлөөр шууд нээгдэнэ; одоогийн сар 5 минутаас илүү хуучирсан бол ар талд шинэчилж, дуусмагц дахин ачаална.
  // Өнгөрсөн сарыг зөвхөн админ шинэчилнэ (сервер мөн шалгана).
  const refresh = useMonthRefresh(month, reload, "month", SALES_KINDS);
  const canRefresh = isCurrent || isAdmin;
  const empty = data && data.clients.length === 0 && data.kpi.revenue === 0 && data.kpi.cost === 0;
  const c = connectionFrom(data?.lastSyncedAt, refresh.phase === "failed" || refresh.phase === "error");

  return (
    <FinanceShell
      title="Борлуулалт"
      subtitle={`Орлого, өртөг, ашиг · ${MN_MONTH(month)}`}
      icon={Wallet}
      lastSyncedAt={data?.lastSyncedAt}
      connection={c}
      refresh={view === "month" && canRefresh ? <RefreshButton busy={refresh.busy} retryAt={refresh.retryAt} onClick={refresh.refresh} /> : undefined}
      notice={view === "month" ? <MonthRefreshNote phase={refresh.phase} retryAt={refresh.retryAt} /> : undefined}
      withView
    >
      {view === "year" ? (
        <Card>
          <YearSection tab="sales" year={year} label="борлуулалт" />
        </Card>
      ) : (
        <>
          {error && <ErrorNote message={error} />}
          {empty ? (
            <Card>
              <MissingMonth busy={refresh.busy} onLoad={refresh.refresh} />
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {loading && !data ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
                ) : data ? (
                  <>
                    <KpiCard featured label="Орлого" value={<Amount value={data.kpi.revenue} />} valueText={formatMoneyShort(data.kpi.revenue)} icon={Wallet} tone="accent" hint={`${data.clients.length} харилцагч`} />
                    <KpiCard
                      label="Өртөг"
                      value={<Amount value={data.kpi.cost} />}
                      valueText={formatMoneyShort(data.kpi.cost)}
                      icon={Layers}
                      hint={
                        data.kpi.costDirect > 0
                          ? `Борлуулсан бараа ${formatMoneyShort(data.kpi.costOfGoods)} + цехээс шууд зарцуулсан материал ${formatMoneyShort(data.kpi.costDirect)}`
                          : "Борлуулсан барааны өртөг"
                      }
                    />
                    <KpiCard label="Ашиг" value={<Amount value={data.kpi.profit} />} valueText={formatMoneyShort(data.kpi.profit)} icon={TrendingUp} tone={data.kpi.profit < 0 ? "danger" : "success"} hint="Орлого − өртөг" />
                    <KpiCard label="Ашгийн хувь" value={data.kpi.margin === null ? "—" : `${data.kpi.margin.toFixed(1)}%`} icon={Percent} hint="Ашиг нь орлогын хэдэн хувь" />
                  </>
                ) : null}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{month.slice(0, 4)} оны сар бүрийн орлого, ашиг</CardTitle>
                </CardHeader>
                <CardBody>
                  {data ? (
                    <DailyBarChart
                      data={data.trend.map((t) => ({ date: t.month, revenue: t.revenue, profit: t.profit }))}
                      series={[
                        { key: "revenue", label: "Орлого", color: "rgb(var(--color-accent))" },
                        { key: "profit", label: "Ашиг", color: "rgb(var(--color-success))" },
                      ]}
                      label={(m) => `${Number(m.slice(5, 7))}`}
                      tooltipTitle={MN_MONTH}
                      unit="сараар"
                    />
                  ) : (
                    <Skeleton className="h-56" />
                  )}
                </CardBody>
              </Card>

              <Card>
                {data ? <SalesLists clients={data.clients} items={data.items} onClientDocs={(cl) => setDocClient(cl)} /> : <Skeleton className="m-4 h-64" />}
              </Card>

              {docClient && (
                <div id="sales-documents" className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <FileText className="size-4 text-[#ffd56b]" aria-hidden />
                    <span className="font-medium text-text">{docClient.name}</span>
                    <span className="text-text-muted">· борлуулалтын баримтууд · {formatMoneyFull(docClient.revenue)}</span>
                    <button type="button" onClick={() => setDocClient(null)} className="focus-ring min-h-9 rounded-lg px-2 text-xs text-text-muted hover:text-text">
                      Хаах
                    </button>
                  </div>
                  <DocumentList
                    key={docClient.code}
                    url={`/api/dashboard/documents?from=${monthRange(month).from}&to=${monthRange(month).to}&kinds=sale${docClient.code ? `&party=${encodeURIComponent(docClient.code)}` : ""}`}
                    title="Борлуулалтын баримтууд"
                    money
                    emptyDescription="Энэ сард борлуулалтын баримт олдсонгүй."
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </FinanceShell>
  );
}
