"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ManagerRef, ProcurementKind, ProcurementListRow, ProcurementMode, ProcurementTab, PurchaseStatus } from "@/lib/procurement";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { cn, formatDate, formatNumber } from "@/lib/utils";

interface ListResponse {
  rows: ProcurementListRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { classify: number; awaiting: number; inProgress: number; completed: number; actionable: number };
  mode: ProcurementMode;
  managers: { domestic: ManagerRef | null; international: ManagerRef | null };
  scope: "mine" | "all";
  viewer: { isInternational: boolean; isDomestic: boolean; isAdmin: boolean };
}

const KIND_LABEL: Record<ProcurementKind, string> = { DOMESTIC: "Дотоод", INTERNATIONAL: "Олон улс" };
const KIND_TONE: Record<ProcurementKind, string> = { DOMESTIC: "bg-accent/15 text-accent", INTERNATIONAL: "bg-warning/15 text-warning" };

const TABS: { key: ProcurementTab; label: string; countKey?: keyof ListResponse["counts"] }[] = [
  { key: "classify", label: "Ангилах шаардлагатай", countKey: "classify" },
  { key: "awaiting", label: "Худалдан авалт хүлээж буй", countKey: "awaiting" },
  { key: "in_progress", label: "Хэсэгчлэн авсан", countKey: "inProgress" },
  { key: "completed", label: "Дууссан / Бүртгэлд шилжсэн", countKey: "completed" },
  { key: "all", label: "Бүгд" },
];

const STATUS_LABEL: Record<PurchaseStatus, string> = { NOT_STARTED: "Аваагүй", PARTIAL: "Хэсэгчлэн", COMPLETE: "Бүгдийг авсан" };
const STATUS_TONE: Record<PurchaseStatus, string> = {
  NOT_STARTED: "bg-text-muted/15 text-text-muted",
  PARTIAL: "bg-warning/15 text-warning",
  COMPLETE: "bg-success/15 text-success",
};
const PAGE_SIZE = 20;
const inputClass = "focus-ring h-9 w-full rounded-lg border border-border bg-bg-surface px-3 text-sm text-text placeholder:text-text-muted";

export default function ProcurementPage() {
  const { data: session, status } = useSession();
  const [tab, setTab] = useState<ProcurementTab>("awaiting");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ itemStatus: "", kind: "", dateFrom: "", dateTo: "", qtyMin: "", qtyMax: "", priceMin: "", priceMax: "" });
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [actionable, setActionable] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role;
  const allowed = role === "MANAGER" || role === "ADMIN";

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ tab, scope, page: String(page), pageSize: String(PAGE_SIZE) });
    if (actionable) params.set("actionable", "1");
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    try {
      const res = await fetch(`/api/procurement?${params}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Серверийн алдаа (${res.status})`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ачаалж чадсангүй");
    } finally {
      setLoading(false);
    }
  }, [tab, scope, actionable, page, debouncedQ, filters]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  useLiveRefresh(() => {
    if (allowed) void load();
  });

  if (status === "authenticated" && !allowed) {
    return <EmptyState title="Эрхгүй" description="Худалдан авалтын хуудсыг зөвхөн Менежер (болон админ) харна" />;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const assigned = data?.mode === "ASSIGNED";
  // the "to classify" queue only exists once the responsible managers are configured, and belongs to the International manager (and ADMIN)
  const visibleTabs = TABS.filter((t) => t.key !== "classify" || (assigned && (data?.viewer.isInternational || data?.viewer.isAdmin)));
  const roleLabel = data?.viewer.isInternational ? "Олон улсын худалдан авалтын менежер" : data?.viewer.isDomestic ? "Дотоодын худалдан авалтын менежер" : data?.viewer.isAdmin ? "Админ (хяналт)" : null;
  const setFilter = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text">Худалдан авалт</h2>
        <p className="text-sm text-text-muted">Гүйцэтгэх захирал баталсан захиалгын дутуу материалыг худалдан авч, материал бүрээр хянана.</p>
      </div>

      {assigned && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg-surface px-3 py-2 text-xs text-text-muted">
          <span>
            {roleLabel ? <strong className="text-text">{roleLabel}</strong> : "Хариуцсан менежер биш"} · Дотоод: {data?.managers.domestic?.name ?? "тохируулаагүй"} · Олон улс: {data?.managers.international?.name ?? "тохируулаагүй"}
          </span>
          {!data?.viewer.isAdmin && (
            <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Хамрах хүрээ">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => {
                    setScope(s);
                    setPage(1);
                  }}
                  className={cn("focus-ring px-3 py-1 text-xs", scope === s ? "bg-accent/15 text-accent" : "hover:bg-bg-elevated")}
                >
                  {s === "mine" ? "Миний хариуцсан" : "Бүгд (мэдээлэл)"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {data && (
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg-surface px-3 py-2 text-xs text-text-muted">
          <input
            type="checkbox"
            className="size-4"
            checked={actionable}
            onChange={(e) => {
              setActionable(e.target.checked);
              setPage(1);
            }}
          />
          Зөвхөн миний үйлдэл шаардсан захиалга (цэсийн тоотой ижил): <strong className="text-text">{data.counts.actionable}</strong>
        </label>
      )}
      {data && !assigned && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Дотоод болон олон улсын худалдан авалтын хариуцагч Админ хуудаснаас тохируулагдаагүй байна. Тохируулах хүртэл бүх менежер өмнөх шигээ худалдан авалт бүртгэнэ.
        </p>
      )}

      <div className={cn("grid grid-cols-2 gap-3", visibleTabs.length > 4 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={cn(
              "focus-ring rounded-xl border p-3 text-left transition-colors",
              tab === t.key ? "border-accent bg-accent/10" : "border-border bg-bg-surface hover:border-accent/50"
            )}
          >
            <p className="text-xs text-text-muted">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold text-text">{t.countKey && data ? data.counts[t.countKey] : "—"}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Захиалгын дугаар, материал, цех, тоо хэмжээ, үнэ…"
                aria-label="Хайх"
                className={cn(inputClass, "pl-9")}
              />
            </div>
            <Button variant="secondary" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
              <SlidersHorizontal className="size-4" /> Шүүлтүүр
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            Тоо бичвэл яг таарахыг хайна: захиалсан/авсан тоо хэмжээ, нэгж үнэ, нийт дүн (жишээ: 12, 1250.5). Хүрээгээр хайхдаа шүүлтүүрийг ашиглана.
          </p>

          {showFilters && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-xs text-text-muted">
                Материалын төлөв
                <select value={filters.itemStatus} onChange={(e) => setFilter("itemStatus", e.target.value)} className={inputClass}>
                  <option value="">Бүгд</option>
                  <option value="NOT_STARTED">Аваагүй</option>
                  <option value="PARTIAL">Хэсэгчлэн авсан</option>
                  <option value="COMPLETE">Бүгдийг авсан</option>
                </select>
              </label>
              <label className="space-y-1 text-xs text-text-muted">
                Ангилал
                <select value={filters.kind} onChange={(e) => setFilter("kind", e.target.value)} className={inputClass}>
                  <option value="">Бүгд</option>
                  <option value="DOMESTIC">Дотоод</option>
                  <option value="INTERNATIONAL">Олон улс</option>
                </select>
              </label>
              <label className="space-y-1 text-xs text-text-muted">
                Захиалсан огнооноос
                <input type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} className={inputClass} />
              </label>
              <label className="space-y-1 text-xs text-text-muted">
                Захиалсан огноо хүртэл
                <input type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} className={inputClass} />
              </label>
              <label className="space-y-1 text-xs text-text-muted">
                Захиалсан тоо (доод)
                <input inputMode="decimal" value={filters.qtyMin} onChange={(e) => setFilter("qtyMin", e.target.value)} className={inputClass} />
              </label>
              <label className="space-y-1 text-xs text-text-muted">
                Захиалсан тоо (дээд)
                <input inputMode="decimal" value={filters.qtyMax} onChange={(e) => setFilter("qtyMax", e.target.value)} className={inputClass} />
              </label>
              <label className="space-y-1 text-xs text-text-muted">
                Нэгж үнэ ₮ (доод)
                <input inputMode="decimal" value={filters.priceMin} onChange={(e) => setFilter("priceMin", e.target.value)} className={inputClass} />
              </label>
              <label className="space-y-1 text-xs text-text-muted">
                Нэгж үнэ ₮ (дээд)
                <input inputMode="decimal" value={filters.priceMax} onChange={(e) => setFilter("priceMax", e.target.value)} className={inputClass} />
              </label>
            </div>
          )}
        </CardBody>
      </Card>

      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : !data || data.rows.length === 0 ? (
        <Card>
          <EmptyState title="Захиалга олдсонгүй" description="Энэ жагсаалтад хүсэлт алга эсвэл хайлтад таарсангүй" />
        </Card>
      ) : (
        <ul className="space-y-3">
          {data.rows.map((r) => {
            const pct = r.requiredItemCount ? Math.round((r.completedItemCount / r.requiredItemCount) * 100) : 100;
            return (
              <li key={r.requestId}>
                <Link href={`/procurement/${r.requestId}`} className="focus-ring block rounded-xl border border-border bg-bg-surface p-4 transition-colors hover:border-accent/60">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-text">№{r.requestNumber}</p>
                      <p className="text-xs text-text-muted">
                        {r.department} · {r.requestedBy} · Захиалсан {formatDate(r.createdAt)}
                        {r.approvedAt && ` · Баталсан ${formatDate(r.approvedAt)}`}
                        {r.completedAt && ` · Худалдан авалт дууссан ${formatDate(r.completedAt)}`}
                      </p>
                    </div>
                    <div className="text-right text-xs text-text-muted">
                      {assigned && !r.classified && r.requestStatus === "PENDING_PROCUREMENT" && <p className="mb-1 rounded bg-warning/15 px-1.5 py-0.5 text-warning">Ангилаагүй</p>}
                      <span className="text-sm font-semibold text-text">
                        {r.completedItemCount}/{r.requiredItemCount}
                      </span>{" "}
                      материал
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-elevated" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className={cn("h-full rounded-full", pct === 100 ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} />
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {r.items.map((i) => (
                      <li
                        key={i.itemId}
                        className={cn("rounded-md px-2 py-1 text-xs", STATUS_TONE[i.status], i.mine && "ring-1 ring-accent")}
                        title={`${STATUS_LABEL[i.status]}${i.managerName ? ` · ${i.managerName}` : ""}`}
                      >
                        {i.kind && <span className={cn("mr-1 rounded px-1 text-[10px] font-medium", KIND_TONE[i.kind])}>{KIND_LABEL[i.kind]}</span>}
                        {i.materialName}: {formatNumber(i.purchasedQuantity, 3)}/{formatNumber(i.requiredQuantity, 3)} {i.unit}
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm text-text-muted">
          <span>
            Нийт {data.total} · {page}/{totalPages} хуудас
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-4" /> Өмнөх
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Дараах <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
