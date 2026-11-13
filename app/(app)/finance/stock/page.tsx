"use client";

import { useState } from "react";
import { AlertTriangle, Boxes, Package, Warehouse } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell, NUM, inputClass, money } from "@/components/finance/FinanceShell";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { RefreshButton, StockRefreshNote, useStockRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { asOfDate, monthRange } from "@/lib/onec/dates";
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
  const [warehouse, setWarehouse] = useState("");
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
      title={`Агуулахын үлдэгдэл · ${asOfDate(ym)}`}
      lastSyncedAt={data?.lastSyncedAt}
      notice={<StockRefreshNote phase={refresh.phase} lastSyncedAt={refresh.lastSyncedAt ?? data?.lastSyncedAt ?? null} />}
      refresh={canRefresh ? <RefreshButton busy={refresh.phase === "refreshing"} retryAt={refresh.retryAt} onClick={refresh.refresh} /> : undefined}
      controls={
        <>
          <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} aria-label="Агуулах" className={inputClass}>
            <option value="">Бүх агуулах</option>
            {warehouseOptions.map((w) => (
              <option key={w.warehouse_code || NONE} value={w.warehouse_code || NONE}>
                {warehouseLabel(w)}
              </option>
            ))}
          </select>
        </>
      }
    >
      {error && <ErrorNote message={error} />}

      {noData ? (
        <MissingMonth busy={refresh.phase === "refreshing"} onLoad={refresh.refresh} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {loading && !data ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            ) : data?.totals ? (
              <>
                <KpiCard label="Нийт үлдэгдлийн дүн" value={money(data.totals.amount)} icon={Boxes} tone="accent" hint={data.date ? `${data.date}-ны байдлаар` : undefined} />
                <KpiCard label="Барааны тоо" value={formatNumber(data.totals.items, 0)} icon={Package} />
                <KpiCard label="Агуулахын тоо" value={data.totals.warehouses ? formatNumber(data.totals.warehouses, 0) : UNKNOWN_WAREHOUSE} icon={Warehouse} />
                <KpiCard label="Хасах үлдэгдэлтэй мөр" value={formatNumber(data.totals.negative_rows, 0)} icon={AlertTriangle} tone={data.totals.negative_rows ? "danger" : "success"} />
              </>
            ) : null}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Бараа материалын үлдэгдэл</CardTitle>
              {data && data.items.length >= LIMIT && <span className="text-xs text-warning">Эхний {LIMIT} мөр харагдаж байна: агуулахаар шүүнэ үү</span>}
            </CardHeader>
            {data ? <DataTable data={data.items} columns={columns} getRowId={(r) => r.id} searchPlaceholder="Нэр эсвэл кодоор хайх..." emptyTitle="Хайлтад тохирох бараа олдсонгүй" /> : <SkeletonTable rows={8} cols={5} />}
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
