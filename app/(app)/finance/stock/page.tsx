"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Boxes, Factory, Package, Search, Warehouse, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell, inputClass, money } from "@/components/finance/FinanceShell";
import { StockTree } from "@/components/finance/StockTree";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton, StockRefreshNote, useStockRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { asOfDate, monthRange } from "@/lib/onec/dates";
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
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Шүүлтүүд (хайлт, нярав, склад) URL-д хадгалагдана: ?q=&keeper=&wh= (сарын ?ym=-тэй хамт). Хайлтын талбар 300 мс-ийн дараа URL-д бичигдэнэ.
 */
function useStockFilters() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const q = sp.get("q") ?? "";
  const keeper = sp.get("keeper") ?? "";
  const wh = sp.get("wh") ?? "";

  // Хугацаатай (debounce) дуудлага хуучирсан searchParams-аар буцаан бичихгүйн тулд үргэлж хамгийн сүүлийн утгыг ашиглана
  const latest = useRef({ sp, q });
  latest.current = { sp, q };

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(latest.current.sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const [qInput, setQInput] = useState(q);
  const pushed = useRef(q);
  // URL-аас (буцах товч, цэвэрлэх) ирсэн өөрчлөлтийг талбарт тусгана
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q;
      setQInput(q);
    }
  }, [q]);
  useEffect(() => {
    const value = qInput.trim();
    if (value === q) return;
    const t = setTimeout(() => {
      if (value === latest.current.q) return; // энэ хооронд URL аль хэдийн тэр утгатай болсон (жишээ нь «Шүүлт арилгах»)
      pushed.current = value;
      set({ q: value });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  return {
    q,
    keeper,
    wh,
    qInput,
    setQInput,
    setKeeper: (v: string) => set({ keeper: v }),
    setWh: (v: string) => set({ wh: v }),
    clear: () => {
      pushed.current = "";
      setQInput("");
      set({ q: "", keeper: "", wh: "" });
    },
    active: Boolean(q || keeper || wh),
  };
}

/** Складын сонголтыг нярвын бүлгээр (optgroup) нэгтгэнэ; жагсаалтын дараалал хадгалагдана */
function groupedWarehouseOptions(list: { code: string; name: string; group: string }[]): [string, { code: string; name: string }[]][] {
  const map = new Map<string, { code: string; name: string }[]>();
  for (const w of list) map.set(w.group, [...(map.get(w.group) ?? []), { code: w.code, name: w.name }]);
  return [...map.entries()];
}

export default function StockPage() {
  // Сонгосон сарын эцсийн өдрийн үлдэгдэл; одоогийн сар бол хамгийн сүүлийн (өнөөдрийн) агшин зураг
  const { ym, isCurrent } = useYm();
  const isAdmin = useIsAdmin();
  const showWip = canViewTab(useSession().data?.user?.role, "sales"); // нярав харахгүй (нягтлан бодох бүртгэлийн дүн)
  const f = useStockFilters();
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

  return (
    <FinanceShell
      title={`Агуулахын үлдэгдэл · ${asOfDate(ym)}`}
      lastSyncedAt={data?.lastSyncedAt}
      notice={<StockRefreshNote phase={refresh.phase} lastSyncedAt={refresh.lastSyncedAt ?? data?.lastSyncedAt ?? null} />}
      refresh={canRefresh ? <RefreshButton busy={refresh.phase === "refreshing"} retryAt={refresh.retryAt} onClick={refresh.refresh} /> : undefined}
      controls={
        <>
          <label className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <input
              type="search"
              value={f.qInput}
              onChange={(e) => f.setQInput(e.target.value)}
              placeholder="Барааны нэр эсвэл кодоор хайх..."
              aria-label="Барааны нэр эсвэл кодоор хайх"
              className={`${inputClass} w-full pl-9`}
            />
          </label>
          <select value={f.keeper} onChange={(e) => f.setKeeper(e.target.value)} aria-label="Нярав" className={inputClass}>
            <option value="">Бүх нярав</option>
            {filters?.keepers.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
            {filters?.hasUnassigned && <option value={NO_KEEPER}>Нярав оноогоогүй</option>}
          </select>
          <select value={f.wh} onChange={(e) => f.setWh(e.target.value)} aria-label="Склад" className={inputClass}>
            <option value="">Бүх склад</option>
            {groupedWarehouseOptions(filters?.warehouses ?? []).map(([group, list]) => (
              <optgroup key={group || "-"} label={group || "Бусад"}>
                {list.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.name}
                  </option>
                ))}
              </optgroup>
            ))}
            {filters?.hasUnknown && <option value={UNKNOWN_WAREHOUSE_KEY}>{UNKNOWN_WAREHOUSE}</option>}
          </select>
          {f.active && (
            <button type="button" onClick={f.clear} className="focus-ring inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-muted hover:bg-bg-elevated hover:text-text">
              <X className="size-4" aria-hidden />
              Шүүлт арилгах
            </button>
          )}
        </>
      }
    >
      {error && <ErrorNote message={error} />}

      {noData ? (
        <MissingMonth busy={refresh.phase === "refreshing"} onLoad={refresh.refresh} />
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-3 ${showWip ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            {loading && !data ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            ) : data?.totals ? (
              <>
                <KpiCard label={f.active ? "Шүүсэн үлдэгдлийн дүн" : "Нийт үлдэгдлийн дүн"} value={money(data.totals.amount)} icon={Boxes} tone="accent" hint={data.date ? `${data.date}-ны байдлаар` : undefined} />
                <KpiCard label="Барааны тоо" value={formatNumber(data.totals.items, 0)} icon={Package} />
                <KpiCard label="Агуулахын тоо" value={data.totals.warehouses ? formatNumber(data.totals.warehouses, 0) : UNKNOWN_WAREHOUSE} icon={Warehouse} />
                <KpiCard label="Хасах үлдэгдэлтэй мөр" value={formatNumber(data.totals.negative_rows, 0)} icon={AlertTriangle} tone={data.totals.negative_rows ? "danger" : "success"} />
              </>
            ) : null}
            {showWip && <WipCard month={ym} />}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Бараа материалын үлдэгдэл</CardTitle>
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
        </>
      )}
    </FinanceShell>
  );
}
