"use client";

import { ArrowDownRight, ArrowUpRight, Minus, Receipt, TrendingUp } from "lucide-react";
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
import { cn, formatNumber } from "@/lib/utils";

// Зардал нь зөвхөн P&L-ийг ашиглана
const EXPENSE_KINDS = ["pl"] as const;

interface GroupRow {
  group: string;
  amount: number;
  prevAmount: number;
  changePct: number | null;
  share: number;
}
interface AccountRow {
  account: string;
  name: string;
  group: string;
  amount: number;
  share: number;
}
interface ExpensesResponse {
  month: string;
  prevMonth: string;
  total: number;
  prevTotal: number;
  changePct: number | null;
  groups: GroupRow[];
  seriesGroups: string[];
  months: { month: string; total: number; groups: Record<string, number> }[];
  accounts: AccountRow[];
  lastSyncedAt: string | null;
}

const PALETTE = ["rgb(var(--color-accent))", "rgb(var(--color-warning))", "rgb(var(--color-danger))", "rgb(var(--color-success))", "rgb(var(--color-text-muted))"];

/** Өсөлт (зардал нэмэгдсэн) нь улаан, буурсан нь ногоон */
function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-text-muted">—</span>;
  const up = pct > 0;
  const Icon = pct === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-1", pct === 0 ? "text-text-muted" : up ? "text-danger" : "text-success")}>
      <Icon className="size-3.5" />
      {up ? "+" : ""}
      {formatNumber(pct, 1)}%
    </span>
  );
}

const groupColumns: DataTableColumn<GroupRow>[] = [
  { key: "group", header: "Бүлэг", sortable: true, accessor: (r) => r.group, render: (r) => <span className="text-text">{r.group}</span> },
  { key: "amount", header: "Энэ сар", sortable: true, accessor: (r) => r.amount, className: NUM, render: (r) => money(r.amount) },
  { key: "prev", header: "Өмнөх сар", sortable: true, accessor: (r) => r.prevAmount, className: NUM, render: (r) => money(r.prevAmount) },
  { key: "change", header: "Өөрчлөлт", sortable: true, accessor: (r) => r.changePct, className: NUM, render: (r) => <Change pct={r.changePct} /> },
  { key: "share", header: "Эзлэх хувь", sortable: true, accessor: (r) => r.share, className: NUM, render: (r) => `${formatNumber(r.share, 1)}%` },
];

const accountColumns: DataTableColumn<AccountRow>[] = [
  { key: "account", header: "Данс", sortable: true, accessor: (r) => r.account, render: (r) => <span className="text-text">{r.account}</span> },
  { key: "name", header: "Нэр", sortable: true, accessor: (r) => r.name, render: (r) => r.name || <span className="text-text-muted">—</span> },
  { key: "group", header: "Бүлэг", sortable: true, accessor: (r) => r.group, render: (r) => r.group },
  { key: "amount", header: "Дүн", sortable: true, accessor: (r) => r.amount, className: NUM, render: (r) => money(r.amount) },
  { key: "share", header: "Эзлэх хувь", sortable: true, accessor: (r) => r.share, className: NUM, render: (r) => `${formatNumber(r.share, 1)}%` },
];

export default function ExpensesPage() {
  const { ym: month, isCurrent, view, year } = useYm();
  const isAdmin = useIsAdmin();
  const { data, error, loading, reload } = useFinanceData<ExpensesResponse>(view === "month" ? `/api/dashboard/expenses?month=${month}` : null);
  // Postgres-ээс шууд; 5 минутаас илүү хуучирсан бол ар талд 1С-ээс татаж, дуусмагц дахин ачаална (Борлуулалттай нэг татаалт)
  const sync = useMonthRefresh(month, reload, "month", EXPENSE_KINDS);
  const canRefresh = isCurrent || isAdmin; // өнгөрсөн сарыг зөвхөн админ татна
  const empty = data && data.accounts.length === 0 && data.groups.length === 0;

  return (
    <FinanceShell
      title="Зардал"
      withView
      lastSyncedAt={data?.lastSyncedAt}
      notice={view === "month" ? <MonthRefreshNote phase={sync.phase} retryAt={sync.retryAt} /> : undefined}
      refresh={view === "month" && canRefresh ? <RefreshButton busy={sync.busy} retryAt={sync.retryAt} onClick={sync.refresh} /> : undefined}
    >
      {view === "year" ? (
        <YearSection tab="expenses" year={year} label="зардал" />
      ) : (
      <>
      {error && <ErrorNote message={error} />}

      {empty ? (
        <MissingMonth busy={sync.busy} onLoad={sync.refresh} />
      ) : (
        <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading && !data ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : data ? (
          <>
            <KpiCard label="Нийт зардал" value={money(data.total)} icon={Receipt} tone="accent" />
            <KpiCard label="Өмнөх сар" value={money(data.prevTotal)} icon={Receipt} />
            <KpiCard
              label="Өмнөх сартай харьцуулахад"
              value={data.changePct === null ? "—" : `${data.changePct > 0 ? "+" : ""}${formatNumber(data.changePct, 1)}%`}
              icon={TrendingUp}
              tone={data.changePct === null || data.changePct === 0 ? undefined : data.changePct > 0 ? "danger" : "success"}
            />
          </>
        ) : null}
      </div>

          <Card>
            <CardHeader>
              <CardTitle>Сүүлийн 6 сарын зардал</CardTitle>
            </CardHeader>
            <CardBody>
              {data ? (
                <DailyBarChart
                  data={data.months.map((m) => ({ date: m.month, ...m.groups }))}
                  series={data.seriesGroups.map((g, i) => ({ key: g, label: g, color: PALETTE[i % PALETTE.length] }))}
                  label={(d) => d.slice(5)}
                  unit="сараар"
                />
              ) : (
                <Skeleton className="h-56" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Бүлгээр</CardTitle>
            </CardHeader>
            {data ? <DataTable data={data.groups} columns={groupColumns} getRowId={(r) => r.group} searchPlaceholder="Бүлэг хайх..." /> : <SkeletonTable rows={4} cols={5} />}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Дансаар</CardTitle>
            </CardHeader>
            {data ? <DataTable data={data.accounts} columns={accountColumns} getRowId={(r) => `${r.account}|${r.group}`} searchPlaceholder="Данс, нэрээр хайх..." /> : <SkeletonTable rows={6} cols={5} />}
          </Card>
        </>
      )}
      </>
      )}
    </FinanceShell>
  );
}
