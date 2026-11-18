"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, Boxes, Factory, Package, Search, UserRound, Warehouse, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DocumentList } from "@/components/finance/docs/DocumentList";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, connectionFrom, money } from "@/components/finance/FinanceShell";
import { FilterSelect, FinanceKpi as KpiCard, ViewToggle, type ViewMode } from "@/components/finance/NgParts";
import { StockTree } from "@/components/finance/StockTree";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { useUrlFilters } from "@/components/finance/useUrlFilters";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton, StockRefreshNote, useStockRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { asOfDate, monthRange } from "@/lib/onec/dates";
import { MOVEMENT_KINDS } from "@/lib/onec/doc-kinds";
import { canViewTab } from "@/lib/onec/roles";
import { UNKNOWN_WAREHOUSE_KEY, type KeeperRef, type StockGroupNode } from "@/lib/onec/stock-tree";
import type { WipResult } from "@/lib/onec/wip";
import { formatNumber } from "@/lib/utils";

interface StockResponse {
  date: string | null;
  totals: { items: number; warehouses: number; amount: number; negative_rows: number } | null;
  groups: StockGroupNode[];
  /** шүүлтийн сонголтууд: идэвхтэй шүүлтээс хамаарахгүй */
  filters: { keepers: KeeperRef[]; hasUnassigned: boolean; warehouses: { code: string; name: string; group: string }[]; hasUnknown: boolean };
  truncated: boolean;
  lastSyncedAt: string | null;
}

/**
 * «Дуусаагүй үйлдвэрлэл» (142x): бараатай холихгүй тусдаа KPI. Эдгээр нь агуулахын бараа биш, үйлдвэрлэлд хуримтлагдсан зардал тул
 * агуулахын нийт дүнд ордоггүй. 1С-ийн OData Balance (сарын эцэс), хуудсыг хүлээлгүй тусад нь ачаална; зөвхөн удирдлагад.
 */
function WipCard({ month }: { month: string }) {
  const { data, error } = useOdataData<WipResult & { meta: OdataMeta }>(`/api/dashboard/wip?month=${month}`);
  if (!data) {
    return error ? <KpiCard label="Дуусаагүй үйлдвэрлэл" value="—" icon={Factory} hint="1С холбогдохгүй байна" /> : <Skeleton className="h-24 rounded-xl" />;
  }
  return (
    <KpiCard
      label="Дуусаагүй үйлдвэрлэл"
      value={money(data.total)}
      icon={Factory}
      hint={`${data.asOf}-ны байдлаар · ${data.accounts.map((a) => a.code.replace(/\..*$/, "")).join(", ")} · барааны дүнд ороогүй`}
    />
  );
}

const UNKNOWN_WAREHOUSE = "Агуулах тодорхойгүй";
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
  const isAdmin = useIsAdmin();
  const showWip = canViewTab(useSession().data?.user?.role, "sales"); // нярав харахгүй (нягтлан бодох бүртгэлийн дүн)
  const f = useStockFilters();
  const [mode, setMode] = useState<ViewMode>("chart");
  const params = new URLSearchParams();
  if (!isCurrent) params.set("date", monthRange(ym).to);
  if (f.q) params.set("q", f.q);
  if (f.keeper) params.set("keeper", f.keeper);
  if (f.wh) params.set("warehouse", f.wh);
  const { data, error, loading, reload } = useFinanceData<StockResponse>(`/api/dashboard/stock?${params}`);
  // Хуудас нээгдэх бүрд 1С-ээс шууд татна (сервер 1 минутад ганц удаа). Хуудас эхлээд Postgres-ийн өгөгдлөөр нээгдэнэ.
  const refresh = useStockRefresh(reload, ym);
  const canRefresh = isCurrent || isAdmin; // өнгөрсөн сарын эцсийн үлдэгдлийг зөвхөн админ татна
  const noData = data && !f.active && (data.date === null || (data.totals?.items ?? 0) === 0);
  const filters = data?.filters;
  // склад бүрийн дүн (мод дахь дүнгээр), хамгийн их 14
  const warehouseBars = (data?.groups ?? [])
    .flatMap((g) => g.warehouses)
    .filter((w) => w.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 14)
    .map((w) => ({ date: w.name, amount: w.amount }));

  return (
    <FinanceShell
      title="Агуулах"
      subtitle={`1С-ээс татсан агуулахын үлдэгдэл · ${asOfDate(ym)}-ны байдлаар`}
      icon={Package}
      connection={connectionFrom(data?.lastSyncedAt, refresh.phase === "offline")}
      lastSyncedAt={data?.lastSyncedAt}
      notice={<StockRefreshNote phase={refresh.phase} lastSyncedAt={refresh.lastSyncedAt ?? data?.lastSyncedAt ?? null} />}
      refresh={canRefresh ? <RefreshButton busy={refresh.phase === "refreshing"} retryAt={refresh.retryAt} onClick={refresh.refresh} /> : undefined}
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
              ...(filters?.hasUnknown ? [{ value: UNKNOWN_WAREHOUSE_KEY, label: UNKNOWN_WAREHOUSE }] : []),
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
      trailing={<ViewToggle value={mode} onChange={setMode} />}
    >
      {error && <ErrorNote message={error} />}

      {noData ? (
        <MissingMonth busy={refresh.phase === "refreshing"} onLoad={refresh.refresh} />
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-3 ${showWip ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            {loading && !data ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
            ) : data?.totals ? (
              <>
                <KpiCard featured label={f.active ? "Шүүсэн үлдэгдлийн дүн" : "Нийт үлдэгдлийн дүн"} value={money(data.totals.amount)} icon={Boxes} tone="accent" hint={data.date ? `${data.date}-ны байдлаар` : undefined} />
                <KpiCard label="Барааны тоо" value={formatNumber(data.totals.items, 0)} icon={Package} />
                <KpiCard label="Агуулахын тоо" value={data.totals.warehouses ? formatNumber(data.totals.warehouses, 0) : UNKNOWN_WAREHOUSE} icon={Warehouse} />
                <KpiCard label="Хасах үлдэгдэлтэй мөр" value={formatNumber(data.totals.negative_rows, 0)} icon={AlertTriangle} tone={data.totals.negative_rows ? "danger" : "success"} />
              </>
            ) : null}
            {showWip && <WipCard month={ym} />}
          </div>

          {mode === "chart" && warehouseBars.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Агуулах бүрийн үлдэгдлийн дүн</CardTitle>
              </CardHeader>
              <CardBody>
                <DailyBarChart
                  data={warehouseBars}
                  series={[{ key: "amount", label: "Үлдэгдлийн дүн", color: "rgb(var(--color-accent))" }]}
                  label={(d) => (d.length > 9 ? `${d.slice(0, 8)}…` : d)}
                  unit="агуулахаар"
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Boxes className="size-4 text-[#ffd56b]" />
                Бараа материалын үлдэгдэл
              </CardTitle>
              {data?.truncated && <span className="text-xs text-warning">Мөр хэт олон тул зөвхөн хамгийн их дүнтэйг харуулав: шүүлт хэрэглэнэ үү</span>}
            </CardHeader>
            {!data ? (
              <SkeletonTable rows={8} cols={5} />
            ) : data.groups.length === 0 ? (
              <EmptyState title="Хайлтад тохирох бараа олдсонгүй" description="Шүүлтээ өөрчилнө үү." />
            ) : (
              <StockTree groups={data.groups} expandAll={Boolean(f.q)} />
            )}
          </Card>

          {/* Хөдөлгөөн: орлого, зарлага (шаардах хуудас, хасалт, борлуулалт), шилжүүлэг. Дээрх «Склад» шүүлтийг дагана; баримт дарвал drawer */}
          <DocumentList
            key={ym}
            url={`/api/dashboard/documents?from=${monthRange(ym).from}&to=${monthRange(ym).to}&kinds=${MOVEMENT_KINDS.join(",")}`}
            title="Хөдөлгөөн: орлого, зарлага, шилжүүлэг"
            icon={<ArrowLeftRight className="size-4 text-[#ffd56b]" />}
            warehouseCode={f.wh && f.wh !== UNKNOWN_WAREHOUSE_KEY ? f.wh : undefined}
            emptyDescription="Энэ сард (сонгосон агуулахад) агуулахын баримт олдсонгүй."
          />
        </>
      )}
    </FinanceShell>
  );
}
