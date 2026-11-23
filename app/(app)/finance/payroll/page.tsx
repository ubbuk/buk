"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Building2, CalendarDays, FileText, HandCoins, LayoutDashboard, Receipt, Users } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, NUM } from "@/components/finance/FinanceShell";
import { FinanceKpi as KpiCard, SegmentedTabs } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import { DocumentList } from "@/components/finance/docs/DocumentList";
import { PART_COLOR, PayrollBreakdown, PayrollWentCard } from "@/components/finance/payroll/PayrollBreakdown";
import { useYm } from "@/components/finance/useYm";
import type { OdataMeta } from "@/components/finance/useOdataData";
import { formatMoneyShort } from "@/lib/money-short";
import type { PayrollDepartment, PayrollDepartments, PayrollEmployee, PayrollEmployeeMonth, PayrollEmployees } from "@/lib/onec/payroll";
import { UNATTRIBUTED } from "@/lib/onec/payroll-labels";
import { PAYROLL_PART_ACCOUNT, type PayrollPartView, type PayrollView } from "@/lib/onec/payroll-view";
import { cn, formatNumber } from "@/lib/utils";

// «Цалин» таб (зөвхөн canViewPayroll). Тойм нь Postgres-оос (sync), хэлтэс, ажилтан нь нээх бүрд 1С-ээс шууд (хадгалагдахгүй).
// Хүний түвшний мэдээлэл «Ажилтнаар» таб сонгоход л татагдана; тэр бүрд хандалт бүртгэгдэнэ.

type ReportResponse = PayrollView & { lastSyncedAt: string | null };

type Section = "overview" | "departments" | "employees";
const SECTIONS = [
  { value: "overview", label: "Тойм", shortLabel: "Тойм", icon: LayoutDashboard },
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

const monthName = (ym: string) => `${Number(ym.slice(5, 7))}-р сар`;
const MN_MONTH = (ym: string) => `${ym.slice(0, 4)} оны ${Number(ym.slice(5, 7))}-р сар`;

const employeeColumns: DataTableColumn<PayrollEmployee>[] = [
  { key: "name", header: "Ажилтан", sortable: true, accessor: (r) => r.name, render: (r) => <span className={r.key ? "text-text" : "text-text-muted italic"}>{r.name}</span> },
  { key: "paid", header: "Олгосон", sortable: true, accessor: (r) => r.paid, className: NUM, render: (r) => <Amount value={r.paid} /> },
  { key: "credited", header: "Нэмэгдсэн", sortable: true, accessor: (r) => r.credited, className: NUM, render: (r) => <Amount value={r.credited} /> },
  { key: "otherDebits", header: "Бусад суутгал", sortable: true, accessor: (r) => r.otherDebits, className: NUM, render: (r) => <Amount value={r.otherDebits} /> },
  { key: "closing", header: "Үлдэгдэл (өглөг)", sortable: true, accessor: (r) => r.closing, className: NUM, render: (r) => <Amount value={r.closing} className={r.closing < 0 ? "text-warning" : "text-text"} /> },
];

const employeeMonthColumns: DataTableColumn<PayrollEmployeeMonth>[] = [
  { key: "month", header: "Сар", accessor: (r) => r.month, render: (r) => <span className="ng-num">{r.month}</span> },
  { key: "paid", header: "Олгосон", accessor: (r) => r.paid, className: NUM, render: (r) => <Amount value={r.paid} /> },
  { key: "credited", header: "Нэмэгдсэн", accessor: (r) => r.credited, className: NUM, render: (r) => <Amount value={r.credited} /> },
  { key: "otherDebits", header: "Бусад суутгал", accessor: (r) => r.otherDebits, className: NUM, render: (r) => <Amount value={r.otherDebits} /> },
  { key: "closing", header: "Сарын эцсийн үлдэгдэл", accessor: (r) => r.closing, className: NUM, render: (r) => <Amount value={r.closing} className={r.closing < 0 ? "text-warning" : "text-text"} /> },
];

export default function PayrollPage() {
  const { ym, year } = useYm();
  const [section, setSection] = useState<Section>("overview");
  const [picked, setPicked] = useState<string | null>(null);
  // Графикт харуулах задаргаа (null = нийт зардал)
  const [series, setSeries] = useState<string | null>(null);
  // Хамгийн доод drill-down: задаргааны мөр -> нягтлангийн баримтууд
  const [docs, setDocs] = useState<PayrollPartView | null>(null);
  const y = String(year);
  const report = useFetch<ReportResponse>(`/api/payroll/report?month=${ym}`);
  const departments = useFetch<PayrollDepartments & { meta: OdataMeta }>(`/api/payroll/departments?year=${y}`, section === "departments");
  // Хүний түвшин: зөвхөн «Ажилтнаар» таб сонгоход татна (тэр бүрд сервер хандалтыг бүртгэнэ)
  const employees = useFetch<PayrollEmployees & { meta: OdataMeta }>(`/api/payroll/employees?year=${y}`, section === "employees");

  const forbidden = [report, departments, employees].some((s) => s.error === "Энэ мэдээллийг үзэх эрхгүй");
  const data = report.data;
  const part = data?.parts.find((p) => p.id === series) ?? null;
  const chart = useMemo(() => (data ? data.months.map((m, i) => ({ date: m.month, value: part ? part.series[i] : m.total })) : []), [data, part]);
  const missing = useMemo(() => (data ? data.months.filter((m) => !m.loaded).map((m) => monthName(m.month)) : []), [data]);
  const deptRows = departments.data?.departments ?? [];
  const deptColumns = useMemo<DataTableColumn<PayrollDepartment>[]>(
    () => [
      { key: "name", header: "Хэлтэс", sortable: true, accessor: (r) => r.name, render: (r) => <span className="text-text">{r.name}</span> },
      { key: "month", header: `${monthName(ym)} (бодсон)`, sortable: true, accessor: (r) => r.byMonth[ym] ?? 0, className: NUM, render: (r) => (r.byMonth[ym] ? <Amount value={r.byMonth[ym]} /> : "—") },
      { key: "total", header: `${y} оны нийт (бодсон)`, sortable: true, accessor: (r) => r.total, className: NUM, render: (r) => <Amount value={r.total} className="text-text" /> },
      {
        key: "share",
        header: "Хувь",
        sortable: true,
        accessor: (r) => r.total,
        className: NUM,
        render: (r) => {
          const t = Object.values(departments.data?.totals ?? {}).reduce((s, v) => s + v, 0);
          return t ? `${formatNumber((r.total / t) * 100, 1)}%` : "—";
        },
      },
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
      subtitle="Цалинд хэдийг зарцуулсан, хаашаа очсон бэ: өмнөх сартай харьцуулан"
      icon={Banknote}
      lastSyncedAt={data?.lastSyncedAt}
      connection={report.error ? "offline" : data ? "ok" : null}
      trailing={<SegmentedTabs label="Цалингийн харагдац" value={section} onChange={setSection} tabs={SECTIONS} />}
    >
      {report.error && <ErrorNote message={report.error} />}

      {section === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {!data ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
            ) : data.ready ? (
              <>
                <KpiCard
                  featured
                  spark={data.months.map((m) => m.total)}
                  label="Цалингийн нийт зардал"
                  value={<Amount value={data.total} />}
                  valueText={formatMoneyShort(data.total)}
                  icon={Receipt}
                  tone="accent"
                  delta={data.changePct}
                  deltaCostLike
                  hint={!data.posted ? "Бодолт хараахан бүртгэгдээгүй" : data.prevLoaded ? "Өмнөх сараас" : "Өмнөх сар татагдаагүй"}
                />
                <KpiCard
                  label={`Өмнөх сар (${Number(data.prevMonth.slice(5, 7))}-р сар)`}
                  value={data.prevLoaded ? <Amount value={data.prevTotal} /> : "татагдаагүй"}
                  valueText={data.prevLoaded ? formatMoneyShort(data.prevTotal) : "татагдаагүй"}
                  icon={Receipt}
                  hint={data.prevLoaded ? undefined : "Харьцуулах мэдээлэл алга"}
                />
                <KpiCard label="Ажилтанд бодсон" value={<Amount value={data.employeesGross} />} valueText={formatMoneyShort(data.employeesGross)} icon={FileText} hint="Ажил олгогчийн НДШ, ТУЗ-гүй" />
                <KpiCard
                  label="Гарт олгосон"
                  value={data.went ? <Amount value={data.went.paid} /> : "—"}
                  valueText={data.went ? formatMoneyShort(data.went.paid) : "—"}
                  icon={HandCoins}
                  tone="success"
                  hint={data.went ? "Банк, касс" : "Бодолт хараахан бүртгэгдээгүй"}
                />
              </>
            ) : (
              <div className="col-span-full rounded-2xl border border-border bg-surface px-5 py-6 text-sm text-text-muted">
                {data.pending ? `${monthName(ym)}: задаргаа шинэчлэгдэж байна (1С-тэй тулгах дараагийн sync-ээр бөглөгдөнө).` : `${monthName(ym)}: хараахан татаагүй (1С-тэй тулгах sync дараагийн удаад орно).`}
              </div>
            )}
          </div>

          {data?.ready && (
            <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
              <Card>
                <PayrollBreakdown
                  parts={data.parts}
                  onDocs={(p) => {
                    setDocs(p);
                    requestAnimationFrame(() => document.getElementById("payroll-documents")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                  }}
                />
              </Card>
              <Card>
                <PayrollWentCard went={data.went} />
              </Card>
            </div>
          )}

          {docs && (
            <div id="payroll-documents" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileText className="size-4 text-[#ffd56b]" aria-hidden />
                <span className="font-medium text-text">{docs.label}</span>
                <span className="text-text-muted">· Нягтланд: {PAYROLL_PART_ACCOUNT[docs.id]} данс</span>
                <button type="button" onClick={() => setDocs(null)} className="focus-ring min-h-9 rounded-lg px-2 text-xs text-text-muted hover:text-text">
                  Хаах
                </button>
              </div>
              <DocumentList
                key={`${PAYROLL_PART_ACCOUNT[docs.id]}:${ym}`}
                url={`/api/dashboard/documents/account?account=${PAYROLL_PART_ACCOUNT[docs.id]}&month=${ym}&side=credit`}
                title="Энэ дансны бичилттэй баримтууд"
                hideWarehouseFilter
                emptyDescription="Энэ сард энэ дансны кредит талд баримт олдсонгүй."
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Сүүлийн 12 сарын цалингийн зардал{part ? ` · ${part.label}` : ""}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {data ? (
                <>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Графикийн задаргаа">
                    {[{ id: null as string | null, label: "Бүгд" }, ...data.parts.map((p) => ({ id: p.id as string | null, label: p.label }))].map((c) => (
                      <button
                        key={c.id ?? "all"}
                        type="button"
                        aria-pressed={series === c.id}
                        onClick={() => setSeries(c.id)}
                        className={cn("focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs text-text-muted hover:text-text", series === c.id ? "border-[rgba(255,213,107,0.6)] bg-white/[0.05] text-text" : "border-border")}
                      >
                        {c.id && <i className="size-2 rounded-full" style={{ background: PART_COLOR[c.id as keyof typeof PART_COLOR] }} aria-hidden />}
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <DailyBarChart
                    data={chart}
                    series={[{ key: "value", label: part ? part.label : "Цалингийн нийт зардал", color: part ? PART_COLOR[part.id] : "rgb(var(--color-accent))" }]}
                    label={(m) => (m.slice(5, 7) === "01" ? `${m.slice(2, 4)}.${Number(m.slice(5, 7))}` : `${Number(m.slice(5, 7))}`)}
                    tooltipTitle={MN_MONTH}
                    unit="сараар"
                  />
                  {missing.length > 0 && <p className="text-[11px] text-text-muted">Татагдаагүй сар: {missing.join(", ")} (график дээр хоосон)</p>}
                </>
              ) : (
                <Skeleton className="h-56" />
              )}
            </CardBody>
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
              <span className="text-text">Бодсон цалинг ажилтнаар 1С-д бүртгэдэггүй:</span> бодолт хэлтсээр нэгтгэгдсэн байдаг тул энд зөвхөн ажилтан бүрт олгосон цалин ба одоогийн үлдэгдэл харагдана. Ажилтанд холбогдоогүй бичилтүүд «{UNATTRIBUTED}» мөрөнд.
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
                      {Math.abs(employees.data.check.difference) < 1 ? `Нийлбэр 1С-ийн үлдэгдэлтэй таарсан (${employees.data.asOf})` : `1С-ийн үлдэгдэлтэй ${formatMoneyShort(employees.data.check.difference)} зөрүүтэй`}
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
