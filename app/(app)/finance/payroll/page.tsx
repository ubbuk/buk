"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Building2, CalendarDays, FileText, HandCoins, Landmark, Receipt, ShieldCheck, Users } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, NUM, money } from "@/components/finance/FinanceShell";
import { FinanceKpi as KpiCard, SegmentedTabs } from "@/components/finance/NgParts";
import { useYm } from "@/components/finance/useYm";
import type { OdataMeta } from "@/components/finance/useOdataData";
import type { PayrollDepartment, PayrollDepartments, PayrollEmployee, PayrollEmployeeMonth, PayrollEmployees } from "@/lib/onec/payroll";
import { UNATTRIBUTED } from "@/lib/onec/payroll-labels";
import { formatNumber } from "@/lib/utils";

// «Цалин» таб (зөвхөн canViewPayroll). Сарын нийт дүн Postgres-оос (sync), хэлтэс, ажилтан нь нээх бүрд 1С-ээс шууд (хадгалагдахгүй).
// Хүний түвшний мэдээлэл «Ажилтнаар» таб сонгоход л татагдана; тэр бүрд хандалт бүртгэгдэнэ.

interface MonthRow {
  month: string;
  synced: boolean;
  accrualPosted: boolean;
  accrued?: number;
  employerNdsh?: number;
  employeeNdsh?: number;
  hhoat?: number;
  paidBank?: number;
  paidCash?: number;
  closingPayable?: number;
}
interface SummaryResponse {
  year: string;
  months: MonthRow[];
  lastSyncedAt: string | null;
}

type Section = "months" | "departments" | "employees";
const SECTIONS = [
  { value: "months", label: "Сар бүрээр", shortLabel: "Сар", icon: CalendarDays },
  { value: "departments", label: "Хэлтсээр", shortLabel: "Хэлтэс", icon: Building2 },
  { value: "employees", label: "Ажилтнаар", shortLabel: "Ажилтан", icon: Users },
] as const;

/** Энгийн татагч (url өөрчлөгдөх бүрд дахин татна; enabled=false бол татахгүй) */
function useFetch<T>(url: string, enabled = true) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: enabled });
  const load = useCallback(
    (signal?: AbortSignal) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      fetch(url, { signal })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? `Алдаа ${res.status}`);
          setState({ data: body as T, error: null, loading: false });
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : "Өгөгдөл татаж чадсангүй", loading: false }));
        });
    },
    [url]
  );
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [enabled, load]);
  return state;
}

const dash = (v: number | undefined) => (v === undefined ? "—" : money(v));
const monthName = (ym: string) => `${Number(ym.slice(5, 7))}-р сар`;

const monthColumns: DataTableColumn<MonthRow>[] = [
  { key: "month", header: "Сар", sortable: true, accessor: (r) => r.month, render: (r) => <span className="ng-num">{r.month}</span> },
  { key: "accrued", header: "Бодсон", sortable: true, accessor: (r) => r.accrued ?? 0, className: NUM, render: (r) => dash(r.accrued) },
  { key: "employerNdsh", header: "Ажил олгогчийн НДШ", sortable: true, accessor: (r) => r.employerNdsh ?? 0, className: NUM, render: (r) => dash(r.employerNdsh) },
  { key: "employeeNdsh", header: "Суутгасан НДШ", sortable: true, accessor: (r) => r.employeeNdsh ?? 0, className: NUM, render: (r) => dash(r.employeeNdsh) },
  { key: "hhoat", header: "ХХОАТ", sortable: true, accessor: (r) => r.hhoat ?? 0, className: NUM, render: (r) => dash(r.hhoat) },
  { key: "paid", header: "Олгосон", sortable: true, accessor: (r) => (r.paidBank ?? 0) + (r.paidCash ?? 0), className: NUM, render: (r) => (r.synced ? money((r.paidBank ?? 0) + (r.paidCash ?? 0)) : "—") },
  { key: "closing", header: "Сарын эцсийн өглөг", sortable: true, accessor: (r) => r.closingPayable ?? 0, className: NUM, render: (r) => (r.closingPayable === undefined ? "—" : <span className={r.closingPayable < 0 ? "text-warning" : "text-text"}>{money(r.closingPayable)}</span>) },
  { key: "status", header: "Төлөв", accessor: (r) => (r.synced ? (r.accrualPosted ? "" : "Бодолт хараахан бүртгэгдээгүй") : "Хараахан татаагүй"), render: (r) => (!r.synced ? <span className="text-xs text-text-muted">Хараахан татаагүй</span> : r.accrualPosted ? null : <span className="text-xs text-warning">Бодолт хараахан бүртгэгдээгүй</span>) },
];

const employeeColumns: DataTableColumn<PayrollEmployee>[] = [
  { key: "name", header: "Ажилтан", sortable: true, accessor: (r) => r.name, render: (r) => <span className={r.key ? "text-text" : "text-text-muted italic"}>{r.name}</span> },
  { key: "paid", header: "Олгосон", sortable: true, accessor: (r) => r.paid, className: NUM, render: (r) => money(r.paid) },
  { key: "credited", header: "Кт орсон", sortable: true, accessor: (r) => r.credited, className: NUM, render: (r) => money(r.credited) },
  { key: "otherDebits", header: "Бусад суутгал", sortable: true, accessor: (r) => r.otherDebits, className: NUM, render: (r) => money(r.otherDebits) },
  { key: "closing", header: "Үлдэгдэл (өглөг)", sortable: true, accessor: (r) => r.closing, className: NUM, render: (r) => <span className={r.closing < 0 ? "text-warning" : "text-text"}>{money(r.closing)}</span> },
];

const employeeMonthColumns: DataTableColumn<PayrollEmployeeMonth>[] = [
  { key: "month", header: "Сар", accessor: (r) => r.month, render: (r) => <span className="ng-num">{r.month}</span> },
  { key: "paid", header: "Олгосон", accessor: (r) => r.paid, className: NUM, render: (r) => money(r.paid) },
  { key: "credited", header: "Кт орсон", accessor: (r) => r.credited, className: NUM, render: (r) => money(r.credited) },
  { key: "otherDebits", header: "Бусад суутгал", accessor: (r) => r.otherDebits, className: NUM, render: (r) => money(r.otherDebits) },
  { key: "closing", header: "Сарын эцсийн үлдэгдэл", accessor: (r) => r.closing, className: NUM, render: (r) => <span className={r.closing < 0 ? "text-warning" : "text-text"}>{money(r.closing)}</span> },
];

export default function PayrollPage() {
  const { ym, year } = useYm();
  const [section, setSection] = useState<Section>("months");
  const [picked, setPicked] = useState<string | null>(null);
  const y = String(year);
  const summary = useFetch<SummaryResponse>(`/api/payroll/summary?year=${y}`);
  const departments = useFetch<PayrollDepartments & { meta: OdataMeta }>(`/api/payroll/departments?year=${y}`, section === "departments");
  // Хүний түвшин: зөвхөн «Ажилтнаар» таб сонгоход татна (тэр бүрд сервер хандалтыг бүртгэнэ)
  const employees = useFetch<PayrollEmployees & { meta: OdataMeta }>(`/api/payroll/employees?year=${y}`, section === "employees");

  const forbidden = [summary, departments, employees].some((s) => s.error === "Энэ мэдээллийг үзэх эрхгүй");
  const row = summary.data?.months.find((m) => m.month === ym);
  const chart = useMemo(() => (summary.data?.months ?? []).filter((m) => m.synced).map((m) => ({ date: m.month, accrued: m.accrued ?? 0, paid: (m.paidBank ?? 0) + (m.paidCash ?? 0) })), [summary.data]);
  const deptRows = departments.data?.departments ?? [];
  const deptColumns = useMemo<DataTableColumn<PayrollDepartment>[]>(
    () => [
      { key: "name", header: "Хэлтэс", sortable: true, accessor: (r) => r.name, render: (r) => <span className="text-text">{r.name}</span> },
      { key: "month", header: `${monthName(ym)} (бодсон)`, sortable: true, accessor: (r) => r.byMonth[ym] ?? 0, className: NUM, render: (r) => (r.byMonth[ym] ? money(r.byMonth[ym]) : "—") },
      { key: "total", header: `${y} оны нийт (бодсон)`, sortable: true, accessor: (r) => r.total, className: NUM, render: (r) => <span className="text-text">{money(r.total)}</span> },
      { key: "share", header: "Хувь", sortable: true, accessor: (r) => r.total, className: NUM, render: (r) => { const t = Object.values(departments.data?.totals ?? {}).reduce((s, v) => s + v, 0); return t ? `${formatNumber((r.total / t) * 100, 1)}%` : "—"; } },
    ],
    [ym, y, departments.data]
  );
  const person = employees.data?.employees.find((e) => e.key === picked) ?? null;

  if (forbidden) {
    return (
      <FinanceShell title="Цалин" subtitle="Цалингийн мэдээлэл" icon={Banknote}>
        <Card>
          <EmptyState title="Энэ мэдээллийг үзэх эрхгүй" description="Цалингийн мэдээллийг зөвхөн цалингийн эрх олгогдсон хэрэглэгч харна. Админд хандана уу." />
        </Card>
      </FinanceShell>
    );
  }

  return (
    <FinanceShell
      title="Цалин"
      subtitle="1С-ийн нягтлан бодох бүртгэлийн цалингийн дансууд (3342, 3450, 3462) · байгууллагын нийт дүн"
      icon={Banknote}
      lastSyncedAt={summary.data?.lastSyncedAt}
      connection={summary.error ? "offline" : summary.data ? "ok" : null}
      trailing={<SegmentedTabs label="Цалингийн харагдац" value={section} onChange={setSection} tabs={SECTIONS} />}
    >
      {summary.error && <ErrorNote message={summary.error} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {summary.loading && !summary.data ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : row?.synced ? (
          <>
            <KpiCard featured label="Бодсон" value={money(row.accrued)} icon={FileText} tone="accent" hint={row.accrualPosted ? undefined : "Бодолт хараахан бүртгэгдээгүй"} />
            <KpiCard label="Ажил олгогчийн НДШ" value={money(row.employerNdsh)} icon={ShieldCheck} />
            <KpiCard label="Суутгасан НДШ" value={money(row.employeeNdsh)} icon={ShieldCheck} />
            <KpiCard label="ХХОАТ" value={money(row.hhoat)} icon={Receipt} />
            <KpiCard label="Олгосон" value={money((row.paidBank ?? 0) + (row.paidCash ?? 0))} icon={HandCoins} tone="success" hint={`Банк ${money(row.paidBank)} · Касс ${money(row.paidCash)}`} />
            <KpiCard label="Сарын эцсийн өглөг" value={money(row.closingPayable)} icon={Landmark} tone={(row.closingPayable ?? 0) < 0 ? "danger" : undefined} hint={(row.closingPayable ?? 0) < 0 ? "Сөрөг: урьдчилж олгосон" : undefined} />
          </>
        ) : summary.data ? (
          <div className="col-span-full rounded-2xl border border-border bg-surface px-5 py-6 text-sm text-text-muted">{monthName(ym)}: хараахан татаагүй (1С-тэй тулгах sync дараагийн удаад орно).</div>
        ) : null}
      </div>

      {section === "months" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Сар бүрийн бодсон ба олгосон цалин</CardTitle>
            </CardHeader>
            <CardBody>
              {summary.data ? (
                chart.length ? (
                  <DailyBarChart
                    data={chart}
                    unit="сараар"
                    label={(d) => d.slice(5)}
                    tooltipTitle={(d) => `${d.slice(0, 4)} оны ${Number(d.slice(5))}-р сар`}
                    series={[
                      { key: "accrued", label: "Бодсон", color: "rgb(var(--color-accent))" },
                      { key: "paid", label: "Олгосон", color: "rgb(var(--color-success))" },
                    ]}
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-text-muted">Татагдсан сар алга.</p>
                )
              ) : (
                <Skeleton className="h-56" />
              )}
            </CardBody>
          </Card>
          <Card>
            {summary.data ? (
              <DataTable
                heading={
                  <>
                    <CalendarDays className="size-4 text-[#ffd56b]" />
                    {y} оны сар бүрийн нэгтгэл
                  </>
                }
                data={summary.data.months}
                columns={monthColumns}
                getRowId={(r) => r.month}
                searchPlaceholder="Сар хайх..."
              />
            ) : (
              <SkeletonTable rows={6} cols={8} />
            )}
          </Card>
        </>
      )}

      {section === "departments" && (
        <Card>
          {departments.error && <ErrorNote message={departments.error} />}
          {departments.data ? (
            <DataTable
              heading={
                <>
                  <Building2 className="size-4 text-[#ffd56b]" />
                  Хэлтсээр бодсон цалин
                  <span className="text-xs font-normal text-text-muted">1С-ээс шууд уншсан, хадгалагдаагүй</span>
                </>
              }
              data={deptRows}
              columns={deptColumns}
              getRowId={(r) => r.key || "none"}
              searchPlaceholder="Хэлтэс хайх..."
            />
          ) : (
            <SkeletonTable rows={6} cols={4} />
          )}
        </Card>
      )}

      {section === "employees" && (
        <>
          <div className="rounded-2xl border border-[rgba(255,213,107,0.35)] bg-[rgba(245,181,35,0.06)] px-5 py-3 text-xs leading-relaxed text-text-muted">
            <p>
              <span className="text-text">Бодсон цалинг ажилтнаар 1С-д бүртгэдэггүй:</span> бодолтын бичилт хэлтсээр нэгтгэгдсэн байдаг тул энд зөвхөн ажилтан бүрт олгосон цалин ба 3342 дансны үлдэгдэл харагдана. Ажилтанд холбогдоогүй бичилтүүд «{UNATTRIBUTED}» мөрөнд.
            </p>
            <p className="mt-1">Хүний түвшний мэдээлэл ERP-д хадгалагдахгүй, нээх бүрд 1С-ээс шууд уншигдана. Энэ хуудсыг нээсэн нь (хэн, хэзээ, аль он) бүртгэгдэнэ.</p>
          </div>
          {employees.error && <ErrorNote message={employees.error} />}
          <Card>
            {employees.data ? (
              <DataTable
                heading={
                  <>
                    <Users className="size-4 text-[#ffd56b]" />
                    Ажилтнаар олгосон ба үлдэгдэл
                    <span className={Math.abs(employees.data.check.difference) < 1 ? "text-xs font-normal text-success" : "text-xs font-normal text-warning"}>
                      {Math.abs(employees.data.check.difference) < 1 ? `Нийлбэр 1С-ийн үлдэгдэлтэй таарсан (${employees.data.asOf})` : `1С-ийн үлдэгдэлтэй ${money(employees.data.check.difference)} зөрүүтэй`}
                    </span>
                  </>
                }
                data={employees.data.employees}
                columns={employeeColumns}
                getRowId={(r) => r.key || "none"}
                onRowClick={(r) => setPicked(r.key === picked ? null : r.key)}
                searchPlaceholder="Ажилтан хайх..."
              />
            ) : (
              <SkeletonTable rows={8} cols={5} />
            )}
          </Card>
          {person && (
            <Card>
              <DataTable
                heading={
                  <>
                    <CalendarDays className="size-4 text-[#ffd56b]" />
                    {person.name}: сар бүрийн задаргаа
                    <button type="button" className="focus-ring ml-2 rounded-lg border border-border px-2 py-0.5 text-xs text-text-muted hover:text-text" onClick={() => setPicked(null)}>
                      Хаах
                    </button>
                  </>
                }
                data={person.months}
                columns={employeeMonthColumns}
                getRowId={(r) => r.month}
              />
            </Card>
          )}
        </>
      )}
    </FinanceShell>
  );
}
