"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Boxes, Factory, Package, Search, UserRound, Warehouse, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DocumentList } from "@/components/finance/docs/DocumentList";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { FilterSelect, FinanceKpi as KpiCard, SegmentedTabs } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import { StockGroups, StockWarehouses, TopItems } from "@/components/finance/stock/StockViews";
import { useUrlFilters } from "@/components/finance/useUrlFilters";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton } from "@/components/finance/useOnecRefresh";
import { useYm } from "@/components/finance/useYm";
import { asOfDate, monthRange } from "@/lib/onec/dates";
import { MOVEMENT_KINDS } from "@/lib/onec/doc-kinds";
import { canViewTab } from "@/lib/onec/roles";
import { OFF_WAREHOUSE_KEY, OFF_WAREHOUSE_NAME, type KeeperRef, type StockGroupNode } from "@/lib/onec/stock-tree";
import type { StockView } from "@/lib/onec/stock-view";
import { formatMoneyFull, formatMoneyShort } from "@/lib/money-short";
import type { StockReconciliation } from "@/lib/onec/stock-live";
import type { WipResult } from "@/lib/onec/wip";
import { formatNumber } from "@/lib/utils";

interface StockResponse {
  date: string;
  totals: { items: number; warehouses: number; amount: number; negative_rows: number };
  groups: StockGroupNode[];
  /** удирдлагад: барааны бүлэг → бараа → агуулах, агуулах → бараа, хамгийн үнэтэй 10 */
  view: StockView;
  /** шүүлтийн сонголтууд: идэвхтэй шүүлтээс хамаарахгүй */
  filters: { keepers: KeeperRef[]; hasUnassigned: boolean; warehouses: { code: string; name: string; group: string }[]; hasOffWarehouse: boolean };
  /** хүснэгтийн нийт = 1С-ийн 14xx дансны Balance (142x-гүй) эсэх */
  reconciliation: StockReconciliation;
  lastSyncedAt: string | null;
  meta: OdataMeta;
}

/**
 * «Цехэд хийгдэж буй ажил» (142x): бараатай холихгүй тусдаа KPI. Эдгээр нь агуулахад байгаа бараа биш, цехэд бүтээгдэж буй бүтээгдэхүүнд
 * зарцуулсан материал, зардал тул агуулахын нийт дүнд ордоггүй. Хуудсыг хүлээлгүй тусад нь ачаална; зөвхөн удирдлагад.
 */
function WipCard({ month }: { month: string }) {
  const { data, error } = useOdataData<WipResult & { meta: OdataMeta }>(`/api/dashboard/wip?month=${month}`);
  if (!data) {
    return error ? <KpiCard label="Цехэд хийгдэж буй ажил" value="—" icon={Factory} hint="Одоогоор татаж чадсангүй" /> : <Skeleton className="h-24 rounded-xl" />;
  }
  return (
    <KpiCard
      label="Цехэд хийгдэж буй ажил"
      value={<Amount value={data.total} />}
      valueText={formatMoneyShort(data.total)}
      icon={Factory}
      hint="Цехэд бүтээгдэж буй бүтээгдэхүүнд зарцуулсан материал, зардал. Агуулахын дүнд ороогүй."
    />
  );
}

/** 12 сарын эцсийн нийт үлдэгдэл: хөнгөн хүсэлт тул тусдаа ачаална */
function useTrend(year: string) {
  const [state, setState] = useState<{ data: { months: { month: string; amount: number }[]; failed: string[] } | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/dashboard/stock/trend?year=${year}`, { signal: c.signal })
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

// «нярав оноогоогүй» шүүлтийн утга (API-тай ижил)
const NO_KEEPER = "none";

/** Шүүлтүүд (хайлт, нярав, склад) URL-д: ?q=&keeper=&wh= (components/finance/useUrlFilters.ts) */
function useStockFilters() {
  const f = useUrlFilters(["keeper", "wh"] as const);
  return { q: f.q, keeper: f.values.keeper, wh: f.values.wh, qInput: f.qInput, setQInput: f.setQInput, setKeeper: (v: string) => f.set("keeper", v), setWh: (v: string) => f.set("wh", v), clear: () => f.clear(), active: f.active };
}

export default function StockPage() {
  // Сонгосон сарын эцсийн өдрийн үлдэгдэл; одоогийн сар бол хамгийн сүүлийн (өнөөдрийн) агшин зураг
  const { ym, isCurrent } = useYm();
  const showWip = canViewTab(useSession().data?.user?.role, "sales"); // нярав харахгүй (нягтлан бодох бүртгэлийн дүн)
  const f = useStockFilters();
  const [mode, setMode] = useState<"groups" | "warehouses">("groups");
  const trend = useTrend(ym.slice(0, 4));
  const params = new URLSearchParams();
  if (!isCurrent) params.set("date", monthRange(ym).to);
  if (f.q) params.set("q", f.q);
  if (f.keeper) params.set("keeper", f.keeper);
  if (f.wh) params.set("warehouse", f.wh);
  // 1С-ийн 14xx дансны Balance-аас шууд (5 минутын cache); «Шинэчлэх» нь cache-ийг тойрно, гэхдээ 60 сек тутамд
  const { data, error, loading, retryAt, refresh } = useOdataData<StockResponse>(`/api/dashboard/stock?${params}`);
  const noData = data && !f.active && data.totals.items === 0;
  const filters = data?.filters;
  const selectedWarehouse = f.wh === OFF_WAREHOUSE_KEY ? OFF_WAREHOUSE_NAME : (filters?.warehouses.find((w) => w.code === f.wh)?.name ?? "");
  const diff = data ? Math.abs(data.reconciliation.difference) : 0;

  return (
    <FinanceShell
      title="Агуулах"
      subtitle={`Агуулахын үлдэгдэл · ${asOfDate(ym)}-ны байдлаар`}
      icon={Package}
      connection={error || data?.meta.stale ? "offline" : data ? "ok" : null}
      lastSyncedAt={data?.meta.fetchedAt}
      refresh={<RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />}
      controls={
        <>
          <label className="ng-panel relative flex h-10 min-w-0 flex-1 basis-56 items-center gap-2 rounded-xl px-3 text-sm text-text max-sm:basis-full">
            <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
            <input
              type="search"
              value={f.qInput}
              onChange={(e) => f.setQInput(e.target.value)}
              placeholder="Барааны нэр эсвэл кодоор хайх..."
              aria-label="Барааны нэр эсвэл кодоор хайх"
              className="focus-ring h-full min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
            />
          </label>
          <FilterSelect
            icon={UserRound}
            label="Нярав"
            value={f.keeper}
            onChange={f.setKeeper}
            options={[{ value: "", label: "Бүх нярав" }, ...(filters?.keepers ?? []).map((k) => ({ value: k.id, label: k.name })), ...(filters?.hasUnassigned ? [{ value: NO_KEEPER, label: "Нярав оноогоогүй" }] : [])]}
          />
          <FilterSelect
            icon={Warehouse}
            label="Склад"
            value={f.wh}
            onChange={f.setWh}
            options={[
              { value: "", label: "Бүх склад" },
              ...(filters?.warehouses ?? []).map((w) => ({ value: w.code, label: w.group ? `${w.group} · ${w.name}` : w.name })),
              ...(filters?.hasOffWarehouse ? [{ value: OFF_WAREHOUSE_KEY, label: OFF_WAREHOUSE_NAME }] : []),
            ]}
          />
          {f.active && (
            <button type="button" onClick={f.clear} className="focus-ring ng-panel inline-flex h-10 items-center gap-1 rounded-xl px-3 text-sm text-text-muted hover:text-text">
              <X className="size-4" aria-hidden />
              Шүүлт арилгах
            </button>
          )}
        </>
      }
    >
      {error && <ErrorNote message={data ? `${error}. Сүүлд татсан өгөгдлийг харуулж байна.` : error} />}
      {data?.meta.stale && <ErrorNote message="Мэдээлэл түр шинэчлэгдэхгүй байна. Сүүлд татсан өгөгдлийг харуулж байна." />}

      {noData ? (
        <Card>
          <EmptyState title="Энэ өдрийн агуулахын үлдэгдэл алга" description="Дээрээс өөр сар сонгоно уу." />
        </Card>
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-3 ${showWip ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            {loading && !data ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
            ) : data?.totals ? (
              <>
                <KpiCard
                  featured
                  label={f.active ? (selectedWarehouse ? `${selectedWarehouse}: үлдэгдлийн дүн` : "Шүүсэн үлдэгдлийн дүн") : "Нийт үлдэгдлийн дүн"}
                  value={<Amount value={data.totals.amount} />}
                  valueText={formatMoneyShort(data.totals.amount)}
                  icon={Boxes}
                  tone="accent"
                  hint={f.active ? `${data.date}-ны байдлаар` : diff < 0.5 ? `${data.date}-ны байдлаар · нягтлангийн дүнтэй таарсан` : `Нягтлангийн дүнтэй ${formatMoneyFull(data.reconciliation.difference)} зөрүүтэй`}
                />
                <KpiCard label="Барааны төрөл" value={formatNumber(data.totals.items, 0)} icon={Package} hint="өөр өөр бараа" />
                <KpiCard label="Агуулахын тоо" value={formatNumber(data.totals.warehouses, 0)} icon={Warehouse} />
                <KpiCard label="⚠ Хасах үлдэгдэлтэй мөр" value={formatNumber(data.totals.negative_rows, 0)} icon={AlertTriangle} tone={data.totals.negative_rows ? "danger" : "success"} hint={data.totals.negative_rows ? "Бүртгэлийн алдаа байж болно: нягтлангаар шалгуулна уу" : "Хасах үлдэгдэл байхгүй"} />
              </>
            ) : null}
            {showWip && <WipCard month={ym} />}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{ym.slice(0, 4)} оны сар бүрийн эцсийн нийт үлдэгдэл</CardTitle>
              {trend.data && trend.data.failed.length > 0 && <span className="text-xs text-warning">{trend.data.failed.map((m) => `${Number(m.slice(5))}-р сар`).join(", ")} татагдсангүй</span>}
            </CardHeader>
            <CardBody>
              {trend.data ? (
                <DailyBarChart
                  data={trend.data.months.map((m) => ({ date: m.month, amount: m.amount }))}
                  series={[{ key: "amount", label: "Нийт үлдэгдэл", color: "rgb(var(--color-accent))" }]}
                  label={(m) => `${Number(m.slice(5, 7))}`}
                  tooltipTitle={(m) => `${m.slice(0, 4)} оны ${Number(m.slice(5, 7))}-р сар`}
                  unit="сараар"
                />
              ) : trend.error ? (
                <p className="py-10 text-center text-sm text-text-muted">{trend.error}</p>
              ) : (
                <Skeleton className="h-56" />
              )}
            </CardBody>
          </Card>

          {data && data.view.top.length > 0 && !f.active && (
            <Card>
              <CardHeader>
                <CardTitle>Хамгийн үнэтэй 10 бараа</CardTitle>
              </CardHeader>
              <TopItems items={data.view.top} />
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Boxes className="size-4 text-[#ffd56b]" />
                Бараа материалын үлдэгдэл
              </CardTitle>
              <div className="flex flex-wrap items-center gap-3">
                {data && selectedWarehouse && (
                  <span className="text-xs text-text-muted">
                    {selectedWarehouse} · {formatNumber(data.totals.items, 0)} бараа · <Amount value={data.totals.amount} className="text-xs" />
                  </span>
                )}
                <SegmentedTabs
                  label="Харагдац"
                  value={mode}
                  onChange={setMode}
                  tabs={[
                    { value: "groups", label: "Барааны бүлгээр" },
                    { value: "warehouses", label: "Агуулахаар" },
                  ]}
                />
              </div>
            </CardHeader>
            {!data ? (
              <SkeletonTable rows={8} cols={5} />
            ) : data.view.groups.length === 0 ? (
              <EmptyState title="Хайлтад тохирох бараа олдсонгүй" description="Шүүлтээ өөрчилнө үү." />
            ) : mode === "groups" ? (
              <StockGroups groups={data.view.groups} expandAll={Boolean(f.q)} />
            ) : (
              <StockWarehouses warehouses={data.view.warehouses} expandAll={Boolean(f.q)} />
            )}
          </Card>

          {/* Хөдөлгөөн: орлого, зарлага (шаардах хуудас, хасалт, борлуулалт), шилжүүлэг. Дээрх «Склад» шүүлтийг дагана; баримт дарвал drawer */}
          <DocumentList
            key={ym}
            url={`/api/dashboard/documents?from=${monthRange(ym).from}&to=${monthRange(ym).to}&kinds=${MOVEMENT_KINDS.join(",")}`}
            title="Хөдөлгөөн: орлого, зарлага, шилжүүлэг"
            icon={<ArrowLeftRight className="size-4 text-[#ffd56b]" />}
            warehouseCode={f.wh && f.wh !== OFF_WAREHOUSE_KEY ? f.wh : undefined}
            emptyDescription="Энэ сард (сонгосон агуулахад) агуулахын баримт олдсонгүй."
          />
        </>
      )}
    </FinanceShell>
  );
}
