"use client";

import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Landmark, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, NUM, money } from "@/components/finance/FinanceShell";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton } from "@/components/finance/useOnecRefresh";
import { useYm } from "@/components/finance/useYm";
import { formatNumber } from "@/lib/utils";
import type { CashAccount, CashCounterpart, CashEntry, CashResult } from "@/lib/onec/cash";

// 1С-ийн OData-аас шууд (5 минутын cache); 1С холбогдохгүй бол сүүлд хадгалсныг харуулна
type CashResponse = CashResult & { meta: OdataMeta };

const accountColumns: DataTableColumn<CashAccount>[] = [
  { key: "name", header: "Данс", sortable: true, accessor: (r) => `${r.name} ${r.code}`, render: (r) => (
      <div>
        <p className="text-text">{r.name}</p>
        <p className="text-[11px] text-text-muted">{r.code}</p>
      </div>
    ) },
  { key: "opening", header: "Эхний үлдэгдэл", sortable: true, accessor: (r) => r.opening, className: NUM, render: (r) => money(r.opening) },
  { key: "inflow", header: "Орлого", sortable: true, accessor: (r) => r.inflow, className: NUM, render: (r) => money(r.inflow) },
  { key: "outflow", header: "Зарлага", sortable: true, accessor: (r) => r.outflow, className: NUM, render: (r) => money(r.outflow) },
  { key: "transfers", header: "Шилжүүлэг (орсон − гарсан)", sortable: true, accessor: (r) => r.transfersIn - r.transfersOut, className: NUM, render: (r) => money(r.transfersIn - r.transfersOut) },
  { key: "closing", header: "Эцсийн үлдэгдэл", sortable: true, accessor: (r) => r.closing, className: NUM, render: (r) => <span className="text-text">{money(r.closing)}</span> },
];

const counterpartColumns: DataTableColumn<CashCounterpart>[] = [
  { key: "name", header: "Харилцагч / харьцсан данс", sortable: true, accessor: (r) => `${r.name} ${r.account}`, render: (r) => (
      <div>
        <p className="text-text">{r.name}</p>
        {r.account && <p className="text-[11px] text-text-muted">Данс {r.account}</p>}
      </div>
    ) },
  { key: "inflow", header: "Орлого", sortable: true, accessor: (r) => r.inflow, className: NUM, render: (r) => (r.inflow ? <span className="text-success">{money(r.inflow)}</span> : "—") },
  { key: "outflow", header: "Зарлага", sortable: true, accessor: (r) => r.outflow, className: NUM, render: (r) => (r.outflow ? <span className="text-danger">{money(r.outflow)}</span> : "—") },
];

const entryColumns = (transfer: boolean): DataTableColumn<CashEntry>[] => [
  { key: "date", header: "Огноо", sortable: true, accessor: (r) => r.date, render: (r) => r.date },
  { key: "account", header: transfer ? "Зарлагадсан данс" : "Данс", accessor: (r) => r.account, render: (r) => r.account },
  { key: "counterpart", header: transfer ? "Хүлээн авсан данс" : "Харилцагч / гүйлгээний утга", accessor: (r) => `${r.counterpart} ${r.memo} ${r.article} ${r.document}`, render: (r) => (
      <div>
        <p className="text-text">{r.counterpart}</p>
        <p className="max-w-md truncate text-[11px] text-text-muted" title={r.memo}>{[r.document, r.article, r.memo].filter(Boolean).join(" · ")}</p>
      </div>
    ) },
  { key: "amount", header: "Дүн", sortable: true, accessor: (r) => (r.type === "outflow" ? -r.amount : r.amount), className: NUM, render: (r) =>
      r.type === "inflow" ? <span className="text-success">+{money(r.amount)}</span> : r.type === "outflow" ? <span className="text-danger">−{money(r.amount)}</span> : <span className="text-text-muted">{money(r.amount)}</span> },
];

export default function CashPage() {
  const { ym } = useYm();
  const { data, error, loading, retryAt, refresh } = useOdataData<CashResponse>(`/api/dashboard/cash?month=${ym}`);
  const empty = data && data.totals.entries === 0 && data.accounts.length === 0;
  const diff = data ? Math.abs(data.totals.difference) : 0;

  return (
    <FinanceShell title={`Мөнгөн хөрөнгө${data ? ` · ${data.asOf}-ны үлдэгдэл` : ""}`} lastSyncedAt={data?.meta.fetchedAt} refresh={<RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />}>
      {error && <ErrorNote message={data ? `${error}. Сүүлд татсан өгөгдлийг харуулж байна.` : error} />}
      {data?.meta.stale && <ErrorNote message="1С холбогдохгүй байна. Сүүлд татсан өгөгдлийг харуулж байна." />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {loading && !data ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : data ? (
          <>
            <KpiCard label="Эхний үлдэгдэл" value={money(data.totals.opening)} icon={Wallet} hint={`${data.month}-01`} />
            <KpiCard label="Нийт орлого" value={money(data.totals.inflow)} icon={ArrowDownLeft} tone="success" />
            <KpiCard label="Нийт зарлага" value={money(data.totals.outflow)} icon={ArrowUpRight} tone="danger" />
            <KpiCard label="Дотоод шилжүүлэг" value={money(data.totals.internal)} icon={ArrowLeftRight} hint="Орлого, зарлагад тооцоогүй" />
            <KpiCard
              label="Эцсийн үлдэгдэл"
              value={money(data.totals.closing)}
              icon={Landmark}
              tone="accent"
              hint={diff < 1 ? "Эхний + орлого − зарлага таарсан" : `Тулгалтад ${money(data.totals.difference)} зөрүүтэй`}
            />
          </>
        ) : null}
      </div>

      {empty ? (
        <Card>
          <div className="px-6 py-12 text-center text-sm text-text-muted">Энэ сард мөнгөн хөрөнгийн гүйлгээ алга. Дээрээс өөр сар сонгоно уу.</div>
        </Card>
      ) : (
        <>
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
              <CardTitle>Данс, банкаар</CardTitle>
              {data && diff >= 1 && <span className="text-xs text-warning">Тулгалтын зөрүү {formatNumber(data.totals.difference, 2)}₮ (ханшийн зөрүү зэрэг)</span>}
            </CardHeader>
            {data ? <DataTable data={data.accounts} columns={accountColumns} getRowId={(r) => r.key} searchPlaceholder="Данс хайх..." /> : <SkeletonTable rows={4} cols={6} />}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Харилцагч, харьцсан дансаар</CardTitle>
              <span className="text-xs text-text-muted">Эхний 20</span>
            </CardHeader>
            {data ? <DataTable data={data.byCounterpart} columns={counterpartColumns} getRowId={(r) => r.key} searchPlaceholder="Харилцагч, данс хайх..." /> : <SkeletonTable rows={6} cols={3} />}
          </Card>

          {data && data.transfers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Дотоод шилжүүлэг</CardTitle>
                <span className="text-xs text-text-muted">Касс, банк, валют хоорондын: орлого, зарлагад тооцоогүй</span>
              </CardHeader>
              <DataTable data={data.transfers} columns={entryColumns(true)} getRowId={(r) => r.id} searchPlaceholder="Шилжүүлэг хайх..." />
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Сүүлийн гүйлгээнүүд</CardTitle>
              <span className="text-xs text-text-muted">Сүүлийн 200</span>
            </CardHeader>
            {data ? <DataTable data={data.recent} columns={entryColumns(false)} getRowId={(r) => r.id} searchPlaceholder="Харилцагч, утга, зүйлээр хайх..." /> : <SkeletonTable rows={4} cols={4} />}
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
