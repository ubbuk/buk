"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Factory, FileText, Layers, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { FinanceKpi as KpiCard } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import { useDocDrawer } from "@/components/finance/docs/DocDrawer";
import { UsageLists, type UsageFocus } from "@/components/finance/usage/UsageLists";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton } from "@/components/finance/useOnecRefresh";
import { useYm } from "@/components/finance/useYm";
import { formatMoneyShort } from "@/lib/money-short";
import type { UsageDocument } from "@/lib/onec/usage";
import type { UsageComparison, UsageWarehouse } from "@/lib/onec/usage-compare";
import type { UsageView } from "@/lib/onec/usage-view";
import { formatNumber } from "@/lib/utils";

interface UsageResponse {
  month: string;
  totals: { amount: number; documents: number; materials: number };
  view: UsageView;
  byWarehouse: UsageWarehouse[];
  /** өмнөх сарын мөн үетэй харьцуулалт; өмнөх сарыг татаж чадаагүй бол null */
  comparison: UsageComparison | null;
  documents: UsageDocument[];
  meta: OdataMeta;
}

const MN_MONTH = (ym: string) => `${ym.slice(0, 4)} оны ${Number(ym.slice(5, 7))}-р сар`;
/** «Өмнөх сарын 1-12-той харьцуулахад» / «Өмнөх сартай харьцуулахад» */
const compareHint = (c: UsageComparison | null) => (c ? (c.throughDay ? `Өмнөх сарын 1–${c.throughDay}-той харьцуулахад` : "Өмнөх сартай харьцуулахад") : undefined);

/** 12 сарын нийт зарцуулалт: хөнгөн хүсэлт тул тусдаа ачаална */
function useTrend(year: string) {
  const [state, setState] = useState<{ data: { months: { month: string; amount: number }[]; failed: string[] } | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/dashboard/usage/trend?year=${year}`, { signal: c.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (c.signal.aborted) return;
        if (!res.ok || !body || !Array.isArray(body.months)) throw new Error(body?.error ?? `Алдаа ${res.status}`);
        setState({ data: body, error: null });
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : "12 сарын мэдээлэл татаж чадсангүй" }));
      });
    return () => c.abort();
  }, [year]);
  return state;
}

export default function UsagePage() {
  const { ym: month } = useYm();
  const { data, error, loading, retryAt, refresh } = useOdataData<UsageResponse>(`/api/dashboard/usage?month=${month}`);
  const trend = useTrend(month.slice(0, 4));
  const { openDoc } = useDocDrawer();
  const [focus, setFocus] = useState<UsageFocus | null>(null);
  // сар солигдоход баримтын шүүлт арилна
  useEffect(() => setFocus(null), [month]);

  const empty = data && data.documents.length === 0;
  const cmp = data?.comparison ?? null;
  const focusedDocs = useMemo(() => {
    if (!data || !focus) return [];
    return data.documents.filter((d) => (focus.kind === "dept" ? d.department === focus.key : focus.key.startsWith("name:") ? d.warehouse === focus.label : d.warehouseCode === focus.key));
  }, [data, focus]);

  return (
    <FinanceShell
      title="Зарцуулалт"
      subtitle={`Цех, хэлтсүүдэд олгосон материал · ${MN_MONTH(month)}`}
      icon={Factory}
      lastSyncedAt={data?.meta.fetchedAt}
      connection={error || data?.meta.stale ? "offline" : data ? "ok" : null}
      refresh={<RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />}
    >
      {error && <ErrorNote message={data ? `${error}. Сүүлд татсан өгөгдлийг харуулж байна.` : error} />}
      {data?.meta.stale && <ErrorNote message="Мэдээлэл түр шинэчлэгдэхгүй байна. Сүүлд татсан өгөгдлийг харуулж байна." />}

      {empty ? (
        <Card>
          <EmptyState title="Энэ сард материал олгосон баримт алга" description="Дээрээс өөр сар сонгоно уу." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {loading && !data ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
            ) : data ? (
              <>
                <KpiCard featured label="Нийт зарцуулалт" value={<Amount value={data.totals.amount} />} valueText={formatMoneyShort(data.totals.amount)} icon={Wallet} tone="accent" delta={cmp?.changePct} hint={compareHint(cmp)} />
                <KpiCard label="Цех, хэлтэс" value={formatNumber(data.view.departments.length, 0)} icon={Factory} hint="материал авсан" />
                <KpiCard label="Материалын төрөл" value={formatNumber(data.totals.materials, 0)} icon={Boxes} />
                <KpiCard label="Олголтын тоо" value={formatNumber(data.totals.documents, 0)} icon={Layers} delta={cmp?.documentsChangePct} hint={compareHint(cmp)} />
              </>
            ) : null}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{month.slice(0, 4)} оны сар бүрийн зарцуулалт</CardTitle>
              {trend.data && trend.data.failed.length > 0 && <span className="text-xs text-warning">{trend.data.failed.map((m) => `${Number(m.slice(5))}-р сар`).join(", ")} татагдсангүй</span>}
            </CardHeader>
            <CardBody>
              {trend.data ? (
                <DailyBarChart
                  data={trend.data.months.map((m) => ({ date: m.month, amount: m.amount }))}
                  series={[{ key: "amount", label: "Зарцуулалт", color: "rgb(var(--color-accent))" }]}
                  label={(m) => `${Number(m.slice(5, 7))}`}
                  tooltipTitle={MN_MONTH}
                  unit="сараар"
                />
              ) : trend.error ? (
                <p className="py-10 text-center text-sm text-text-muted">{trend.error}</p>
              ) : (
                <Skeleton className="h-56" />
              )}
            </CardBody>
          </Card>

          <Card>
            {data ? (
              <UsageLists departments={data.view.departments} materials={data.view.materials} warehouses={data.byWarehouse} total={data.totals.amount} onFocus={(f) => {
                setFocus(f);
                requestAnimationFrame(() => document.getElementById("usage-documents")?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }} />
            ) : (
              <Skeleton className="m-4 h-64" />
            )}
          </Card>

          {focus && (
            <div id="usage-documents" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileText className="size-4 text-[#ffd56b]" aria-hidden />
                <span className="font-medium text-text">{focus.label}</span>
                <span className="text-text-muted">· олголтын баримтууд ({focusedDocs.length})</span>
                <button type="button" onClick={() => setFocus(null)} className="focus-ring min-h-9 rounded-lg px-2 text-xs text-text-muted hover:text-text">
                  Хаах
                </button>
              </div>
              <Card>
                <ul className="divide-y divide-border">
                  {focusedDocs.map((d) => (
                    <li key={d.id}>
                      <button type="button" onClick={() => openDoc("ТребованиеНакладная", d.id)} className="focus-ring flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/[0.03]" title="Баримтыг нээх">
                        <span className="ng-num w-14 shrink-0 text-xs text-text-muted">{d.date.slice(5, 10)}</span>
                        <span className="ng-num w-24 shrink-0 text-xs text-text-muted">№ {d.number}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-text">{d.warehouse}</span>
                        <Amount value={d.amount} className="shrink-0 text-sm font-medium text-text" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
        </>
      )}
    </FinanceShell>
  );
}
