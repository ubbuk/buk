"use client";

import { useMemo, useState } from "react";
import { Boxes, Coins, Factory, FileText, Layers, ListChecks, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell, NUM, money } from "@/components/finance/FinanceShell";
import { GranularChart } from "@/components/finance/GranularChart";
import { FilterSelect, FinanceKpi as KpiCard, ViewToggle, rankColumn, type ViewMode } from "@/components/finance/NgParts";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton, todayUb } from "@/components/finance/useOnecRefresh";
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

const ALL = "";

export default function UsagePage() {
  const { ym: month, isCurrent } = useYm();
  const { data, error, loading, retryAt, refresh } = useOdataData<UsageResponse>(`/api/dashboard/usage?month=${month}`);
  const [dept, setDept] = useState(ALL);
  const [material, setMaterial] = useState(ALL);
  const [mode, setMode] = useState<ViewMode>("chart");
  const empty = data && data.documents.length === 0;

  // Шүүлтүүр: «Бүх хэлтэс» нь баримтын жагсаалт, өдрийн график, нийт дүн, баримтын тоонд; «Бүх материал» нь материалын хүснэгтэд үйлчилнэ
  const documents = useMemo(() => (data ? data.documents.filter((d) => !dept || d.department === dept) : []), [data, dept]);
  const materials = useMemo(() => (data ? data.byMaterial.filter((m) => !material || m.key === material) : []), [data, material]);
  const daily = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, { amount: number; count: number }>();
    for (const d of documents) {
      const k = d.date.slice(0, 10);
      const cur = by.get(k) ?? { amount: 0, count: 0 };
      cur.amount += d.amount;
      cur.count += 1;
      by.set(k, cur);
    }
    return data.daily.map((d) => ({ date: d.date, amount: by.get(d.date)?.amount ?? 0, count: by.get(d.date)?.count ?? 0 }));
  }, [data, documents]);
  const spark = useMemo(() => {
    let acc = 0;
    return daily.filter((d) => !isCurrent || d.date <= todayUb()).map((d) => (acc += d.amount));
  }, [daily, isCurrent]);
  const total = documents.reduce((s, d) => s + d.amount, 0);
  const materialCols = useMemo(() => (data ? [rankColumn(materials), ...materialColumns] : materialColumns), [data, materials]);
  const deptCols = useMemo(() => (data ? [rankColumn(data.byDepartment), ...departmentColumns] : departmentColumns), [data]);

  return (
    <FinanceShell
      title="Зарцуулалт"
      subtitle="1С-ээс татсан материалын зарцуулалтын мэдээлэл"
      icon={Coins}
      lastSyncedAt={data?.meta.fetchedAt}
      connection={error || data?.meta.stale ? "offline" : data ? "ok" : null}
      refresh={<RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />}
      controls={
        data && (
          <>
            <FilterSelect icon={Factory} label="Хэлтэс, цех" value={dept} onChange={setDept} options={[{ value: ALL, label: "Бүх цех" }, ...data.byDepartment.map((d) => ({ value: d.name, label: d.name }))]} />
            <FilterSelect icon={Boxes} label="Материал" value={material} onChange={setMaterial} options={[{ value: ALL, label: "Бүх материал" }, ...data.byMaterial.map((m) => ({ value: m.key, label: m.name }))]} />
          </>
        )
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
            <KpiCard featured spark={spark} label="Нийт зарцуулалт" value={money(dept ? total : data.totals.amount)} icon={Wallet} tone="accent" />
            <KpiCard label="Шаардах хуудас" value={formatNumber(dept ? documents.length : data.totals.documents, 0)} icon={FileText} />
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
                  <GranularChart data={daily} keys={["amount", "count"]} today={isCurrent ? todayUb() : undefined} countKey="count" countLabel="Баримт" series={[{ key: "amount", label: "Зарцуулалт", color: "rgb(var(--color-accent))" }]} />
                ) : (
                  <Skeleton className="h-56" />
                )}
              </CardBody>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="min-w-0 lg:col-span-3">
              {data ? (
                <DataTable
                  heading={
                    <>
                      <Boxes className="size-4 text-[#ffd56b]" />
                      Материалаар
                    </>
                  }
                  phoneLayout="scroll"
                  data={materials}
                  columns={materialCols}
                  getRowId={(r) => r.key}
                  searchPlaceholder="Материал хайх..."
                />
              ) : (
                <SkeletonTable rows={6} cols={4} />
              )}
            </Card>
            <Card className="min-w-0 lg:col-span-2">
              {data ? (
                <DataTable
                  heading={
                    <>
                      <Factory className="size-4 text-[#ffd56b]" />
                      Хэлтэс, цехээр
                    </>
                  }
                  phoneLayout="scroll"
                  data={data.byDepartment}
                  columns={deptCols}
                  getRowId={(r) => r.name}
                  searchPlaceholder="Хэлтэс хайх..."
                />
              ) : (
                <SkeletonTable rows={5} cols={3} />
              )}
            </Card>
          </div>

          <Card>
            {data ? (
              <DataTable
                heading={
                  <>
                    <ListChecks className="size-4 text-[#ffd56b]" />
                    Шаардах хуудасны жагсаалт
                  </>
                }
                phoneLayout="scroll"
                data={documents}
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
