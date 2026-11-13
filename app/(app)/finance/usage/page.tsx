"use client";

import { Boxes, FileText, Layers, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, NUM, money } from "@/components/finance/FinanceShell";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton } from "@/components/finance/useOnecRefresh";
import { useYm } from "@/components/finance/useYm";
import { formatNumber } from "@/lib/utils";
import type { UsageDepartment, UsageDocument, UsageMaterial } from "@/lib/onec/usage";

interface UsageResponse {
  month: string;
  totals: { amount: number; documents: number; materials: number };
  byMaterial: UsageMaterial[];
  byDepartment: UsageDepartment[];
  daily: { date: string; amount: number }[];
  documents: UsageDocument[];
  meta: OdataMeta;
}

const materialColumns: DataTableColumn<UsageMaterial>[] = [
  { key: "name", header: "Материал", sortable: true, accessor: (r) => r.name, render: (r) => <span className="text-text">{r.name}</span> },
  { key: "quantity", header: "Нийт тоо", sortable: true, accessor: (r) => r.quantity, className: NUM, render: (r) => `${formatNumber(r.quantity, 2)}${r.unit ? ` ${r.unit}` : ""}` },
  { key: "amount", header: "Дүн", sortable: true, accessor: (r) => r.amount, className: NUM, render: (r) => money(r.amount) },
  { key: "documents", header: "Баримт", sortable: true, accessor: (r) => r.documents, className: NUM, render: (r) => formatNumber(r.documents, 0) },
];

const departmentColumns: DataTableColumn<UsageDepartment>[] = [
  { key: "name", header: "Хэлтэс, цех", sortable: true, accessor: (r) => r.name, render: (r) => <span className="text-text">{r.name}</span> },
  { key: "amount", header: "Дүн", sortable: true, accessor: (r) => r.amount, className: NUM, render: (r) => money(r.amount) },
  { key: "documents", header: "Баримт", sortable: true, accessor: (r) => r.documents, className: NUM, render: (r) => formatNumber(r.documents, 0) },
];

const documentColumns: DataTableColumn<UsageDocument>[] = [
  { key: "date", header: "Огноо", sortable: true, accessor: (r) => r.date, render: (r) => r.date.slice(0, 10) },
  { key: "number", header: "Дугаар", sortable: true, accessor: (r) => r.number, render: (r) => r.number },
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

export default function UsagePage() {
  const { ym: month } = useYm();
  const { data, error, loading, retryAt, refresh } = useOdataData<UsageResponse>(`/api/dashboard/usage?month=${month}`);
  const empty = data && data.documents.length === 0;

  return (
    <FinanceShell
      title="Зарцуулалт"
      lastSyncedAt={data?.meta.fetchedAt}
      refresh={<RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />}
    >
      {error && <ErrorNote message={data ? `${error}. Сүүлд татсан өгөгдлийг харуулж байна.` : error} />}
      {data?.meta.stale && <ErrorNote message="1С холбогдохгүй байна. Сүүлд татсан өгөгдлийг харуулж байна." />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : data ? (
          <>
            <KpiCard label="Нийт зарцуулалт" value={money(data.totals.amount)} icon={Wallet} tone="accent" />
            <KpiCard label="Шаардах хуудас" value={formatNumber(data.totals.documents, 0)} icon={FileText} />
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
          <Card>
            <CardHeader>
              <CardTitle>Өдөр бүрийн зарцуулалт</CardTitle>
            </CardHeader>
            <CardBody>{data ? <DailyBarChart data={data.daily} series={[{ key: "amount", label: "Зарцуулалт", color: "rgb(var(--color-accent))" }]} /> : <Skeleton className="h-56" />}</CardBody>
          </Card>

          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Материалаар</CardTitle>
              </CardHeader>
              {data ? <DataTable data={data.byMaterial} columns={materialColumns} getRowId={(r) => r.key} searchPlaceholder="Материал хайх..." /> : <SkeletonTable rows={6} cols={4} />}
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Хэлтэс, цехээр</CardTitle>
              </CardHeader>
              {data ? <DataTable data={data.byDepartment} columns={departmentColumns} getRowId={(r) => r.name} searchPlaceholder="Хэлтэс хайх..." /> : <SkeletonTable rows={5} cols={3} />}
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Шаардах хуудасны жагсаалт</CardTitle>
            </CardHeader>
            {data ? <DataTable data={data.documents} columns={documentColumns} getRowId={(r) => r.id} searchPlaceholder="Дугаар, хэлтэс, зориулалтаар хайх..." /> : <SkeletonTable rows={8} cols={6} />}
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
