"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, Layers, Minus, Receipt, TrendingUp } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, NUM, connectionFrom, money } from "@/components/finance/FinanceShell";
import { FilterSelect, FinanceKpi as KpiCard, ViewToggle, rankColumn, type ViewMode } from "@/components/finance/NgParts";
import { DocumentList } from "@/components/finance/docs/DocumentList";
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

const PALETTE = ["rgb(var(--color-accent))", "#4f8ff0", "#34d399", "#f87171", "#a78bfa"];

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
  // дансны КОД биш НЭР (1С-ийн дансны төлөвлөгөөнөөс); код нь зөвхөн tooltip-д
  { key: "name", header: "Данс", sortable: true, accessor: (r) => `${r.name} ${r.account}`, render: (r) => <span className="text-text" title={`Данс ${r.account}`}>{r.name || "Нэргүй данс"}</span> },
  { key: "group", header: "Бүлэг", sortable: true, accessor: (r) => r.group, render: (r) => r.group },
  { key: "amount", header: "Дүн", sortable: true, accessor: (r) => r.amount, className: NUM, render: (r) => money(r.amount) },
  { key: "share", header: "Эзлэх хувь", sortable: true, accessor: (r) => r.share, className: NUM, render: (r) => `${formatNumber(r.share, 1)}%` },
];

const ALL = "";

export default function ExpensesPage() {
  const { ym: month, isCurrent, view, year } = useYm();
  const isAdmin = useIsAdmin();
  const [group, setGroup] = useState(ALL);
  // Дарж задлах: бүлэг -> дансууд -> тухайн данс дээр бичилт хийсэн баримтууд -> баримтын drawer
  const [account, setAccount] = useState<AccountRow | null>(null);
  const jump = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const [mode, setMode] = useState<ViewMode>("chart");
  const { data, error, loading, reload } = useFinanceData<ExpensesResponse>(view === "month" ? `/api/dashboard/expenses?month=${month}` : null);
  // Postgres-ээс шууд; 5 минутаас илүү хуучирсан бол ар талд 1С-ээс татаж, дуусмагц дахин ачаална (Борлуулалттай нэг татаалт)
  const sync = useMonthRefresh(month, reload, "month", EXPENSE_KINDS);
  const canRefresh = isCurrent || isAdmin; // өнгөрсөн сарыг зөвхөн админ татна
  const empty = data && data.accounts.length === 0 && data.groups.length === 0;

  // Сүүлийн 6 сарын нийт зардлын бодит цуваа: гол KPI-ийн sparkline
  const spark = useMemo(() => (data ? data.months.map((m) => m.total) : []), [data]);
  const accounts = useMemo(() => (data ? data.accounts.filter((a) => !group || a.group === group) : []), [data, group]);
  const groupCols = useMemo(() => (data ? [rankColumn(data.groups), ...groupColumns] : groupColumns), [data]);
  const accountCols = useMemo(() => (data ? [rankColumn(accounts), ...accountColumns] : accountColumns), [data, accounts]);

  return (
    <FinanceShell
      title="Зардал"
      subtitle="Зардлын бүлэг, дансаар задаргаа, өмнөх сартай харьцуулалт"
      icon={BarChart3}
      withView
      lastSyncedAt={data?.lastSyncedAt}
      connection={connectionFrom(data?.lastSyncedAt, sync.phase === "failed" || sync.phase === "error")}
      notice={view === "month" ? <MonthRefreshNote phase={sync.phase} retryAt={sync.retryAt} /> : undefined}
      refresh={view === "month" && canRefresh ? <RefreshButton busy={sync.busy} retryAt={sync.retryAt} onClick={sync.refresh} /> : undefined}
      controls={view === "month" && data && <FilterSelect icon={Layers} label="Зардлын бүлэг" value={group} onChange={setGroup} options={[{ value: ALL, label: "Бүх бүлэг" }, ...data.groups.map((g) => ({ value: g.group, label: g.group }))]} />}
      trailing={view === "month" ? <ViewToggle value={mode} onChange={setMode} /> : undefined}
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
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {loading && !data ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
                ) : data ? (
                  <>
                    <KpiCard featured spark={spark} label="Нийт зардал" value={money(data.total)} icon={Receipt} tone="accent" delta={data.changePct} deltaCostLike hint={data.changePct === null ? undefined : "Өмнөх сараас"} />
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

              {mode === "chart" && (
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
              )}

              <Card>
                {data ? (
                  <DataTable
                    heading={
                      <>
                        <Layers className="size-4 text-[#ffd56b]" />
                        Бүлгээр
                      </>
                    }
                    data={data.groups}
                    columns={groupCols}
                    getRowId={(r) => r.group}
                    onRowClick={(r) => {
                      setGroup(r.group);
                      setAccount(null);
                      jump("expense-accounts");
                    }}
                    searchPlaceholder="Бүлэг хайх..."
                  />
                ) : (
                  <SkeletonTable rows={4} cols={5} />
                )}
              </Card>

              <Card id="expense-accounts">
                {data ? (
                  <DataTable
                    heading={
                      <>
                        <Receipt className="size-4 text-[#ffd56b]" />
                        Дансаар · дарвал баримтууд гарна
                      </>
                    }
                    data={accounts}
                    columns={accountCols}
                    getRowId={(r) => `${r.account}|${r.group}`}
                    onRowClick={(r) => {
                      setAccount(r);
                      jump("expense-documents");
                    }}
                    searchPlaceholder="Данс, нэрээр хайх..."
                  />
                ) : (
                  <SkeletonTable rows={6} cols={5} />
                )}
              </Card>

              {account && (
                <div id="expense-documents" className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-text-muted">Данс:</span>
                    <span className="font-medium text-text" title={`Данс ${account.account}`}>
                      {account.name || "Нэргүй данс"}
                    </span>
                    <button type="button" onClick={() => setAccount(null)} className="focus-ring rounded-lg px-2 py-1 text-xs text-text-muted hover:text-text">
                      Хаах
                    </button>
                  </div>
                  <DocumentList key={`${account.account}:${month}`} url={`/api/dashboard/documents/account?account=${encodeURIComponent(account.account)}&month=${month}&side=debit`} title="Энэ данс дээр бичилт хийсэн баримтууд" hideWarehouseFilter emptyDescription="Энэ сард энэ дансны дебит талд баримт олдсонгүй." />
                </div>
              )}
            </>
          )}
        </>
      )}
    </FinanceShell>
  );
}
