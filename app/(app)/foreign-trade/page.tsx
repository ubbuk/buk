"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, Building2, Check, ChevronLeft, ChevronRight, Cog, Coins, Eye, Hourglass, Layers, PenLine, Plane, Plus, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { CURRENT, splitLabel, STEPS } from "@/components/foreign-trade/ApprovalTimeline";
import { ftApi, inputClass } from "@/components/foreign-trade/api";
import { HoloPanel } from "@/components/foreign-trade/holo/HoloPanel";
import h from "@/components/foreign-trade/holo/holo.module.css";
import s from "@/components/foreign-trade/holo/list.module.css";
import type { FtListRow } from "@/lib/foreign-trade";
import { FT_STATUS_LABEL, type FtStatus } from "@/lib/foreign-trade-rules";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { cn, formatDateTime } from "@/lib/utils";

const STATUS_OPTIONS = Object.keys(FT_STATUS_LABEL) as FtStatus[];

// Groups of statuses behind the KPI cards and the tabs. They do not overlap, so the four groups plus the drafts add up to the total.
const GROUPS = {
  research: ["PENDING_MANAGER"],
  pending: ["PENDING_TECHNICAL", "PENDING_FINANCE", "PENDING_EXECUTIVE"],
  approved: ["APPROVED"],
  returned: ["RETURNED_TO_MANAGER", "RETURNED_TO_BOSS"],
} as const satisfies Record<string, readonly FtStatus[]>;
type GroupKey = keyof typeof GROUPS;
type TabKey = "all" | GroupKey;

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "Бүгд" },
  { key: "research", label: "Үнийн судалгаа" },
  { key: "pending", label: "Батлах хүлээгдэж буй" },
  { key: "approved", label: "Батлагдсан" },
  { key: "returned", label: "Буцаагдсан" },
];

const STAGE_ICONS = [UserRound, Briefcase, Cog, Coins, PenLine, Building2] as const;
const PAGE_SIZES = [10, 20, 50];

const inGroup = (status: FtStatus, key: TabKey) => key === "all" || (GROUPS[key] as readonly FtStatus[]).includes(status);
const groupCount = (rows: FtListRow[], key: TabKey) => rows.filter((r) => inGroup(r.status, key)).length;

export default function ForeignTradePage() {
  const { data: session } = useSession();
  const [rows, setRows] = useState<FtListRow[] | null>(null);
  const [all, setAll] = useState<FtListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    if (status) params.set("status", status);
    if (waiting) params.set("waiting", "1");
    const filtered = params.toString() !== "";
    const [r, everything] = await Promise.all([ftApi<{ rows: FtListRow[] }>(`/api/foreign-trade?${params}`), filtered ? ftApi<{ rows: FtListRow[] }>("/api/foreign-trade") : null]);
    if (r.ok) {
      setRows(r.data.rows);
      // the KPI cards count everything the viewer may see, whatever the search / filters are
      setAll(filtered ? (everything?.ok ? everything.data.rows : r.data.rows) : r.data.rows);
      setError(null);
    } else setError(r.error);
  }, [debouncedQ, status, waiting]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, status, waiting, tab, pageSize]);

  const canCreate = session?.user?.role === "BOSS";
  const shown = useMemo(() => (rows ?? []).filter((r) => inGroup(r.status, tab)), [rows, tab]);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages);
  const pageRows = shown.slice((current - 1) * pageSize, current * pageSize);
  const kpi = all ?? [];

  return (
    <div className={h.root}>
      <div className="space-y-4">
        <header className={s.hero}>
          <div className={s.heroImg} aria-hidden="true" />
          <div className={s.heroBody}>
            <span className={s.heroTile} aria-hidden="true">
              <Plane className="size-9" />
            </span>
            <div className="min-w-0">
              <h2 className={s.heroTitle}>Гадаад худалдаа</h2>
              <p className={s.heroText}>Гадаад нийлүүлэгчээс худалдан авах захиалгууд: үнийн судалгаа, хэлэлцүүлэг, батлалт.</p>
            </div>
          </div>
        </header>

        <div className={s.kpis} aria-label="Захиалгын тоо">
          <Kpi label="Нийт захиалга" value={kpi.length} icon={<Layers className="size-7" />} ready={all !== null} />
          <Kpi label="Үнийн судалгаа" value={groupCount(kpi, "research")} icon={<Search className="size-7" />} tone="amber" ready={all !== null} />
          <Kpi label="Батлах хүлээгдэж буй" value={groupCount(kpi, "pending")} icon={<Hourglass className="size-7" />} ready={all !== null} />
          <Kpi label="Батлагдсан" value={groupCount(kpi, "approved")} icon={<Check className="size-8" strokeWidth={3} />} tone="green" ready={all !== null} />
          <Kpi label="Буцаагдсан" value={groupCount(kpi, "returned")} icon={<X className="size-8" strokeWidth={3} />} tone="red" ready={all !== null} />
        </div>

        <HoloPanel
          icon={<Layers className="size-6" />}
          title="Захиалгын жагсаалт"
          actions={
            canCreate && (
              <Link href="/foreign-trade/new">
                <Button>
                  <Plus className="size-4" /> Шинэ захиалга
                </Button>
              </Link>
            )
          }
        >
          <div className={s.tabs} role="tablist" aria-label="Төлөвийн бүлэг">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn(s.tab, tab === t.key && s.tabOn, "focus-ring")}>
                {t.label} <span className={s.count}>{rows ? groupCount(rows, t.key) : 0}</span>
              </button>
            ))}
          </div>

          <div className={s.toolbar}>
            <div className={s.search}>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Дугаар, барааны нэрээр хайх" aria-label="Хайх" className={cn(inputClass, "pl-9")} />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Төлөв" className={cn(inputClass, "w-auto")}>
              <option value="">Бүх төлөв</option>
              {STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {FT_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
            <label className={s.waiting}>
              <input type="checkbox" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} className="size-4 accent-[var(--accent,#f59e0b)]" />
              Миний шийдвэр хүлээж буй
            </label>
          </div>

          {error ? (
            <EmptyState title="Ачаалж чадсангүй" description={error} />
          ) : rows === null ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <EmptyState title="Захиалга алга" description={canCreate ? "Шинэ захиалга үүсгэж эхэлнэ үү" : "Таны харах эрхтэй гадаад худалдааны захиалга одоогоор алга"} />
          ) : (
            <>
              {/* desktop table */}
              <div className={cn(s.tableWrap, "hidden md:block")}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className="w-12">№</th>
                      <th>Дугаар</th>
                      <th>Бараа</th>
                      <th>Үүсгэсэн</th>
                      <th>Огноо</th>
                      <th>Одоогийн шат</th>
                      <th>Төлөв</th>
                      <th className="text-center">Үйлдэл</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, i) => (
                      <tr key={r.id} className={r.waitingOnMe ? s.rowMine : undefined}>
                        <td className="text-text-muted">{(current - 1) * pageSize + i + 1}</td>
                        <td>
                          <Link href={`/foreign-trade/${r.id}`} className={cn(s.num, "focus-ring hover:underline")}>
                            {r.orderNumber}
                          </Link>
                        </td>
                        <td className="font-medium text-white">
                          {r.firstItem}
                          {r.itemCount > 1 && <span className="text-text-muted"> +{r.itemCount - 1}</span>}
                        </td>
                        <td className="text-text-muted">{r.createdBy}</td>
                        <td className="whitespace-nowrap text-text-muted">{formatDateTime(r.createdAt)}</td>
                        <td>
                          <StageCell status={r.status} />
                        </td>
                        <td>
                          <StatusPill status={r.status} waiting={r.waitingOnMe} />
                        </td>
                        <td className="text-center">
                          <Link href={`/foreign-trade/${r.id}`} className={cn(s.eye, "focus-ring")} aria-label={`${r.orderNumber} харах`}>
                            <Eye className="size-4" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* phone cards */}
              <ul className={cn(s.cards, "md:hidden")}>
                {pageRows.map((r) => (
                  <li key={r.id}>
                    <Link href={`/foreign-trade/${r.id}`} className={cn(s.card, r.waitingOnMe && s.cardMine, "focus-ring space-y-2")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={s.num}>{r.orderNumber}</span>
                        <span className="text-xs text-text-muted">{formatDateTime(r.createdAt)}</span>
                      </div>
                      <p className="font-medium text-white">
                        {r.firstItem}
                        {r.itemCount > 1 && <span className="text-text-muted"> +{r.itemCount - 1}</span>}
                      </p>
                      <StageCell status={r.status} />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StatusPill status={r.status} waiting={r.waitingOnMe} />
                        <span className="text-xs text-text-muted">{r.createdBy}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className={s.pager}>
                <span className="flex flex-wrap items-center gap-2">
                  Нийт {shown.length} захиалга <span aria-hidden="true">·</span> Нэг хуудсанд
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Нэг хуудсанд" className={cn(inputClass, "!h-9 w-auto")}>
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </span>
                {pages > 1 && (
                  <nav className={s.pages} aria-label="Хуудаслалт">
                    <button type="button" className={cn(s.pageBtn, "focus-ring")} disabled={current === 1} onClick={() => setPage(current - 1)} aria-label="Өмнөх хуудас">
                      <ChevronLeft className="size-4" />
                    </button>
                    {Array.from({ length: pages }, (_, i) => i + 1)
                      .filter((n) => n === 1 || n === pages || Math.abs(n - current) <= 1)
                      .map((n, idx, arr) => (
                        <span key={n} className="flex gap-1.5">
                          {idx > 0 && n - arr[idx - 1] > 1 && <span className="grid place-items-center px-1 text-text-muted">…</span>}
                          <button type="button" className={cn(s.pageBtn, n === current && s.pageOn, "focus-ring")} aria-current={n === current ? "page" : undefined} onClick={() => setPage(n)}>
                            {n}
                          </button>
                        </span>
                      ))}
                    <button type="button" className={cn(s.pageBtn, "focus-ring")} disabled={current === pages} onClick={() => setPage(current + 1)} aria-label="Дараагийн хуудас">
                      <ChevronRight className="size-4" />
                    </button>
                  </nav>
                )}
              </div>
            </>
          )}
        </HoloPanel>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, tone, ready }: { label: string; value: number; icon: React.ReactNode; tone?: "amber" | "green" | "red"; ready: boolean }) {
  return (
    <div className={cn(s.kpi, tone === "amber" && s.kpiAmber, tone === "green" && s.kpiGreen, tone === "red" && s.kpiRed)}>
      <div className={s.kpiIn}>
        <span className={s.kpiIcon}>{icon}</span>
        <div className="min-w-0">
          <p className={s.kpiLabel}>{label}</p>
          <p className={s.kpiValue}>{ready ? value : "–"}</p>
        </div>
      </div>
    </div>
  );
}

/** Where the order is now, from the same stage list as the detail page's workflow. */
function StageCell({ status }: { status: FtStatus }) {
  const idx = Math.min(CURRENT[status], STEPS.length - 1);
  const [main, sub] = splitLabel(STEPS[idx]);
  const approved = status === "APPROVED";
  const returned = status === "RETURNED_TO_BOSS" || status === "RETURNED_TO_MANAGER";
  const tone = approved ? "52 211 153" : returned ? "252 129 129" : status === "PENDING_MANAGER" ? "255 190 60" : "53 230 255";
  const Icon = STAGE_ICONS[idx];
  return (
    <span className={s.stageCell}>
      <span className={s.stageIcon} style={{ "--t": tone } as React.CSSProperties}>
        {approved ? <Check className="size-5" strokeWidth={3} /> : <Icon className="size-5" />}
      </span>
      <span className="min-w-0">
        {main}
        {sub && <span className={s.stageSub}>{sub}</span>}
      </span>
    </span>
  );
}

function StatusPill({ status, waiting }: { status: FtStatus; waiting: boolean }) {
  const tone = status === "APPROVED" ? s.pillGreen : status === "RETURNED_TO_BOSS" || status === "RETURNED_TO_MANAGER" ? s.pillRed : status === "DRAFT" ? s.pillGray : status === "PENDING_MANAGER" ? s.pillAmber : undefined;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={cn(s.pill, tone)}>{FT_STATUS_LABEL[status]}</span>
      {waiting && <span className={s.mine}>Таны ээлж</span>}
    </span>
  );
}
