"use client";

import { CalendarRange, Download, TrendingUp } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBarChart } from "./DailyBarChart";
import { ErrorNote, NUM, money } from "./FinanceShell";
import { useFinanceData } from "./useFinanceData";
import { useIsAdmin } from "./useYm";
import { cn, formatNumber } from "@/lib/utils";

interface YearResponse {
  tab: "sales" | "expenses";
  year: number;
  months: { month: string; amount: number; hasData: boolean; prevAmount: number | null }[];
  total: number;
  hasData: boolean;
  hasPrev: boolean;
  comparedMonths: number;
  changePct: number | null;
}
type MonthRow = YearResponse["months"][number];

const monthName = (m: string) => `${Number(m.slice(5))}-р сар`;

/** «Бүтэн жил»: 12 сарын баганан график, сар бүрийн дүн, өмнөх онтой харьцуулалт (өмнөх онд өгөгдөл байвал) */
export function YearSection({ tab, year, label }: { tab: "sales" | "expenses"; year: number; label: string }) {
  const { data, error, loading } = useFinanceData<YearResponse>(`/api/dashboard/year?tab=${tab}&year=${year}`);
  const columns: DataTableColumn<MonthRow>[] = [
    { key: "month", header: "Сар", sortable: true, accessor: (r) => r.month, render: (r) => <span className="text-text">{monthName(r.month)}</span> },
    { key: "amount", header: String(year), sortable: true, accessor: (r) => (r.hasData ? r.amount : null), className: NUM, render: (r) => (r.hasData ? money(r.amount) : "—") },
    ...(data?.hasPrev
      ? [
          { key: "prev", header: String(year - 1), sortable: true, accessor: (r: MonthRow) => r.prevAmount, className: NUM, render: (r: MonthRow) => money(r.prevAmount) } satisfies DataTableColumn<MonthRow>,
          {
            key: "change",
            header: "Өөрчлөлт",
            sortable: true,
            accessor: (r: MonthRow) => pct(r),
            className: NUM,
            render: (r: MonthRow) => <PctCell value={pct(r)} costLike={tab === "expenses"} />,
          } satisfies DataTableColumn<MonthRow>,
        ]
      : []),
  ];

  if (error) return <ErrorNote message={error} />;
  if (data && !data.hasData) {
    return (
      <Card>
        <EmptyState title={`${year} оны өгөгдөл хараахан татагдаагүй`} description="Сар сонгоод, админ «1С-ээс татах» товчоор сар бүрийг татна." />
      </Card>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading && !data ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : data ? (
          <>
            <KpiCard label={`${year} оны ${label}`} value={money(data.total)} icon={CalendarRange} tone="accent" />
            <KpiCard
              label={`${year - 1} онтой харьцуулахад`}
              value={data.changePct === null ? "—" : `${data.changePct > 0 ? "+" : ""}${formatNumber(data.changePct, 1)}%`}
              icon={TrendingUp}
              hint={data.comparedMonths ? `${formatNumber(data.comparedMonths, 0)} сарыг харьцуулав` : "Өмнөх оны өгөгдөл алга"}
              tone={data.changePct === null || data.changePct === 0 ? undefined : (data.changePct > 0) === (tab === "sales") ? "success" : "danger"}
            />
          </>
        ) : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{year} оны сар бүрийн {label}</CardTitle>
        </CardHeader>
        <CardBody>
          {data ? (
            <DailyBarChart
              data={data.months.map((m) => ({ date: m.month, cur: m.amount, prev: m.prevAmount ?? 0 }))}
              series={[
                { key: "cur", label: String(year), color: "rgb(var(--color-accent))" },
                ...(data.hasPrev ? [{ key: "prev", label: String(year - 1), color: "rgb(var(--color-text-muted))" }] : []),
              ]}
              label={(d) => String(Number(d.slice(5)))}
              unit="сараар"
            />
          ) : (
            <Skeleton className="h-56" />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Сараар</CardTitle>
        </CardHeader>
        {data ? <DataTable data={data.months} columns={columns} getRowId={(r) => r.month} searchPlaceholder="Сар хайх..." /> : <Skeleton className="h-40" />}
      </Card>
    </>
  );
}

/** Өмнөх онтой харьцуулсан %: хоёр талд өгөгдөл байвал л */
function pct(r: MonthRow): number | null {
  if (!r.hasData || r.prevAmount === null || r.prevAmount === 0) return null;
  return Math.round(((r.amount - r.prevAmount) / Math.abs(r.prevAmount)) * 1000) / 10;
}

/** Зардлын өсөлт улаан, борлуулалтын өсөлт ногоон */
function PctCell({ value, costLike }: { value: number | null; costLike: boolean }) {
  if (value === null) return <span className="text-text-muted">—</span>;
  const good = costLike ? value < 0 : value > 0;
  return (
    <span className={cn(value === 0 ? "text-text-muted" : good ? "text-success" : "text-danger")}>
      {value > 0 ? "+" : ""}
      {formatNumber(value, 1)}%
    </span>
  );
}

/** «Энэ сарын өгөгдөл хараахан татагдаагүй»: Postgres-д тухайн сар байхгүй. ADMIN-д 1С-ээс татах товч (ар талд, 1 сар, onec_sync_lock-оор) */
export function MissingMonth({ busy, onLoad, subject }: { busy: boolean; onLoad: () => void; subject?: string }) {
  const isAdmin = useIsAdmin();
  return (
    <Card>
      <EmptyState
        title={subject ?? "Энэ сарын өгөгдөл хараахан татагдаагүй"}
        description={isAdmin ? undefined : "Админ 1С-ээс татсны дараа харагдана."}
        action={
          isAdmin ? (
            <button
              type="button"
              onClick={onLoad}
              disabled={busy}
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-bg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="size-4" />
              {busy ? "Татаж байна…" : "1С-ээс татах"}
            </button>
          ) : undefined
        }
      />
    </Card>
  );
}
