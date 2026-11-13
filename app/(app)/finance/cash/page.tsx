"use client";

import { ArrowDownLeft, ArrowUpRight, Landmark, Scale } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, NUM, money } from "@/components/finance/FinanceShell";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { MonthRefreshNote, RefreshButton, useMonthRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { formatNumber } from "@/lib/utils";

const CASH_KINDS = ["cash"] as const;

interface CashResponse {
  month: string;
  totals: { inflow: number; outflow: number; transactions: number; accounts: number };
  daily: { date: string; inflow: number; outflow: number }[];
  byAccount: { account: string; inflow: number; outflow: number }[];
  byItem: { item: string; inflow: number; outflow: number }[];
  recent: { id: string; date: string; account: string; client: string; item: string; inflow: number; outflow: number; memo: string; doc: string }[];
  lastSyncedAt: string | null;
}

type AccountRow = CashResponse["byAccount"][number];
type Txn = CashResponse["recent"][number];

const accountColumns: DataTableColumn<AccountRow>[] = [
  { key: "account", header: "Данс / касс", sortable: true, accessor: (r) => r.account || "Тодорхойгүй", render: (r) => <span className="text-text">{r.account || "Тодорхойгүй"}</span> },
  { key: "inflow", header: "Орлого", sortable: true, accessor: (r) => r.inflow, render: (r) => money(r.inflow), className: NUM },
  { key: "outflow", header: "Зарлага", sortable: true, accessor: (r) => r.outflow, render: (r) => money(r.outflow), className: NUM },
  { key: "net", header: "Цэвэр", sortable: true, accessor: (r) => r.inflow - r.outflow, render: (r) => money(r.inflow - r.outflow), className: NUM },
];

const txnColumns: DataTableColumn<Txn>[] = [
  { key: "date", header: "Огноо", sortable: true, accessor: (r) => r.date, render: (r) => r.date },
  { key: "account", header: "Данс", accessor: (r) => r.account, render: (r) => r.account },
  { key: "client", header: "Харилцагч / гүйлгээний утга", accessor: (r) => `${r.client} ${r.memo} ${r.doc}`, render: (r) => (
      <div>
        <p className="text-text">{r.client || "—"}</p>
        <p className="max-w-md truncate text-[11px] text-text-muted" title={r.memo}>{r.memo} {r.doc && `(${r.doc})`}</p>
      </div>
    ) },
  { key: "item", header: "Зүйл", accessor: (r) => r.item, render: (r) => r.item },
  { key: "amount", header: "Дүн", sortable: true, accessor: (r) => r.inflow - r.outflow, className: NUM, render: (r) =>
      r.inflow > 0 ? <span className="text-success">+{money(r.inflow)}</span> : <span className="text-danger">−{money(r.outflow)}</span> },
];

export default function CashPage() {
  const { ym: month, isCurrent } = useYm();
  const isAdmin = useIsAdmin();
  const { data, error, loading, reload } = useFinanceData<CashResponse>(`/api/dashboard/cash?month=${month}`);
  // Хуудас Postgres-ийн өгөгдлөөр шууд нээгдэнэ; 5 минутаас илүү хуучирсан бол ар талд 1С-ээс татаж, дуусмагц дахин ачаална
  const refresh = useMonthRefresh(month, reload, "month", CASH_KINDS);
  const canRefresh = isCurrent || isAdmin; // өнгөрсөн сарыг зөвхөн админ татна
  const empty = data && data.totals.transactions === 0;

  return (
    <FinanceShell
      title="Мөнгөн хөрөнгө"
      lastSyncedAt={data?.lastSyncedAt}
      notice={<MonthRefreshNote phase={refresh.phase} retryAt={refresh.retryAt} />}
      refresh={canRefresh ? <RefreshButton busy={refresh.busy} retryAt={refresh.retryAt} onClick={refresh.refresh} /> : undefined}
    >
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
            <KpiCard label="Нийт орлого" value={money(data.totals.inflow)} icon={ArrowDownLeft} tone="success" />
            <KpiCard label="Нийт зарлага" value={money(data.totals.outflow)} icon={ArrowUpRight} tone="danger" />
            <KpiCard label="Цэвэр урсгал" value={money(data.totals.inflow - data.totals.outflow)} icon={Scale} tone="accent" />
            <KpiCard label="Гүйлгээ / данс" value={`${formatNumber(data.totals.transactions, 0)} / ${formatNumber(data.totals.accounts, 0)}`} icon={Landmark} />
          </>
        ) : null}
      </div>

          <Card>
            <CardHeader>
              <CardTitle>Өдөр бүрийн орлого, зарлага</CardTitle>
            </CardHeader>
            <CardBody>
              {data ? (
                <DailyBarChart
                  data={data.daily}
                  series={[
                    { key: "inflow", label: "Орлого", color: "rgb(var(--color-success))" },
                    { key: "outflow", label: "Зарлага", color: "rgb(var(--color-danger))" },
                  ]}
                />
              ) : (
                <Skeleton className="h-56" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Данс, кассаар</CardTitle>
            </CardHeader>
            {data ? <DataTable data={data.byAccount} columns={accountColumns} getRowId={(r) => r.account} searchPlaceholder="Данс хайх..." /> : <SkeletonTable rows={4} cols={4} />}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Сүүлийн гүйлгээнүүд</CardTitle>
              <span className="text-xs text-text-muted">Сүүлийн 100</span>
            </CardHeader>
            {data ? <DataTable data={data.recent} columns={txnColumns} getRowId={(r) => r.id} searchPlaceholder="Харилцагч, утга, баримтаар хайх..." /> : <SkeletonTable rows={6} cols={5} />}
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
