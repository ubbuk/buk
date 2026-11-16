"use client";

import { useState } from "react";
import { AlertTriangle, Boxes, Factory, Package, Warehouse } from "lucide-react";
import { useSession } from "next-auth/react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell, NUM, connectionFrom, money } from "@/components/finance/FinanceShell";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { FilterSelect, FinanceKpi as KpiCard, ViewToggle, type ViewMode } from "@/components/finance/NgParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton, StockRefreshNote, useStockRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { asOfDate, monthRange } from "@/lib/onec/dates";
import { canViewTab } from "@/lib/onec/roles";
import type { WipResult } from "@/lib/onec/wip";
import { formatNumber } from "@/lib/utils";

interface StockItem {
  id: string;
  warehouse_code: string;
  warehouse: string;
  item_code: string;
  item: string;
  unit: string;
  account: string;
  qty: number;
  amount: number;
  unit_cost: number | null;
}

interface StockResponse {
  date: string | null;
  totals: { items: number; warehouses: number; amount: number; negative_rows: number } | null;
  warehouses: { warehouse_code: string; warehouse: string; items: number; amount: number }[];
  items: StockItem[];
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

const LIMIT = 5000;
const UNKNOWN_WAREHOUSE = "Агуулах тодорхойгүй";
// API-д агуулахгүй (код хоосон) мөрүүдийг "none" гэж шүүнэ
const NONE = "none";

const warehouseLabel = (w: { warehouse: string; warehouse_code: string }) => w.warehouse || w.warehouse_code || UNKNOWN_WAREHOUSE;

const columns: DataTableColumn<StockItem>[] = [
  { key: "item", header: "Бараа", sortable: true, accessor: (r) => `${r.item} ${r.item_code}`, render: (r) => (
      <div>
        <p className="text-text">{r.item || "—"}</p>
        <p className="text-[11px] text-text-muted">{r.item_code}</p>
      </div>
    ) },
  { key: "warehouse", header: "Агуулах", sortable: true, accessor: (r) => warehouseLabel(r), render: (r) => <span className={r.warehouse || r.warehouse_code ? "" : "text-text-muted"}>{warehouseLabel(r)}</span> },
  { key: "qty", header: "Үлдэгдэл", sortable: true, accessor: (r) => r.qty, className: NUM, render: (r) => (
      <span className={r.qty < 0 ? "text-danger" : undefined}>
        {formatNumber(r.qty, 2)} {r.unit}
      </span>
    ) },
  { key: "unit_cost", header: "Нэгжийн өртөг", sortable: true, accessor: (r) => r.unit_cost, className: NUM, render: (r) => money(r.unit_cost) },
  { key: "amount", header: "Дүн", sortable: true, accessor: (r) => r.amount, className: NUM, render: (r) => money(r.amount) },
];

export default function StockPage() {
  // Сонгосон сарын эцсийн өдрийн үлдэгдэл; одоогийн сар бол хамгийн сүүлийн (өнөөдрийн) агшин зураг
  const { ym, isCurrent } = useYm();
  const isAdmin = useIsAdmin();
  const showWip = canViewTab(useSession().data?.user?.role, "sales"); // нярав харахгүй (нягтлан бодох бүртгэлийн дүн)
  const [warehouse, setWarehouse] = useState("");
  const [mode, setMode] = useState<ViewMode>("chart");
  const params = new URLSearchParams({ limit: String(LIMIT) });
  if (!isCurrent) params.set("date", monthRange(ym).to);
  if (warehouse) params.set("warehouse", warehouse);
  const { data, error, loading, reload } = useFinanceData<StockResponse>(`/api/dashboard/stock?${params}`);
  // Хуудас нээгдэх бүрд 1С-ээс шууд татна (сервер 1 минутад ганц удаа). Хуудас эхлээд Postgres-ийн өгөгдлөөр нээгдэнэ.
  const refresh = useStockRefresh(reload, ym);
  const canRefresh = isCurrent || isAdmin; // өнгөрсөн сарын эцсийн үлдэгдлийг зөвхөн админ татна
  const noData = data && (data.date === null || (data.totals?.items ?? 0) === 0);
  const warehouseOptions = data?.warehouses ?? [];

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
        <FilterSelect
          icon={Warehouse}
          label="Агуулах"
          value={warehouse}
          onChange={setWarehouse}
          options={[{ value: "", label: "Бүх агуулах" }, ...warehouseOptions.map((w) => ({ value: w.warehouse_code || NONE, label: warehouseLabel(w) }))]}
        />
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
                <KpiCard featured label="Нийт үлдэгдлийн дүн" value={money(data.totals.amount)} icon={Boxes} tone="accent" hint={data.date ? `${data.date}-ны байдлаар` : undefined} />
                <KpiCard label="Барааны тоо" value={formatNumber(data.totals.items, 0)} icon={Package} />
                <KpiCard label="Агуулахын тоо" value={data.totals.warehouses ? formatNumber(data.totals.warehouses, 0) : UNKNOWN_WAREHOUSE} icon={Warehouse} />
                <KpiCard label="Хасах үлдэгдэлтэй мөр" value={formatNumber(data.totals.negative_rows, 0)} icon={AlertTriangle} tone={data.totals.negative_rows ? "danger" : "success"} />
              </>
            ) : null}
            {showWip && <WipCard month={ym} />}
          </div>

          {mode === "chart" && data && data.warehouses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Агуулах бүрийн үлдэгдлийн дүн</CardTitle>
              </CardHeader>
              <CardBody>
                <DailyBarChart
                  data={data.warehouses.slice(0, 14).map((w) => ({ date: warehouseLabel(w), amount: w.amount }))}
                  series={[{ key: "amount", label: "Үлдэгдлийн дүн", color: "rgb(var(--color-accent))" }]}
                  label={(d) => (d.length > 9 ? `${d.slice(0, 8)}…` : d)}
                  unit="агуулахаар"
                />
              </CardBody>
            </Card>
          )}

          <Card>
            {data ? (
              <DataTable
                heading={
                  <>
                    <Boxes className="size-4 text-[#ffd56b]" />
                    Бараа материалын үлдэгдэл
                    {data.items.length >= LIMIT && <span className="text-xs font-normal text-warning">Эхний {LIMIT} мөр: агуулахаар шүүнэ үү</span>}
                  </>
                }
                phoneLayout="scroll"
                data={data.items}
                columns={columns}
                getRowId={(r) => r.id}
                searchPlaceholder="Нэр эсвэл кодоор хайх..."
                emptyTitle="Хайлтад тохирох бараа олдсонгүй"
              />
            ) : (
              <SkeletonTable rows={8} cols={5} />
            )}
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
