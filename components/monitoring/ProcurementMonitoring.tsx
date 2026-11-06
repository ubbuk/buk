"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { THRESHOLD_HOURS } from "@/lib/monitoring/procurement-calc";
import type {
  ManagerLoad,
  ProcurementFilter,
  ProcurementList,
  ProcurementOverview,
  ProcurementRow,
  ProcurementScope,
} from "@/lib/monitoring/procurement-types";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { formatDuration, waitTone } from "./format";
import { DataGrid, Pager, Panel, Td, Th, TileSkeleton } from "./Panel";
import { ProcurementDetailModal } from "./ProcurementDetailModal";
import { ItemsTable } from "./ProcurementItemsTable";
import { KIND_LABEL, KIND_TONE, qty, STAGE_LABEL, STAGE_TONE } from "./procurement-ui";
import { useLiveData } from "./useLiveData";

// "Худалдан авалтын хяналт" -- the procurement section of the existing Monitoring
// page. It shares the page's refresh tick (30 s timer + the app's single SSE
// stream re-dispatched as a window event), so there is no extra connection and no
// extra polling. Strictly read-only: nothing here can change a purchase,
// classification, approval or handover.

const API = "/api/admin/monitoring";
const PAGE_SIZE = 10;

const SCOPES: { key: ProcurementScope; label: string }[] = [
  { key: "active", label: "Идэвхтэй" },
  { key: "accounting", label: "Нягтлан хүлээж буй" },
  { key: "completed", label: "Дууссан (сонгосон хугацаа)" },
];
const FILTERS: { key: ProcurementFilter; label: string }[] = [
  { key: "all", label: "Бүгд" },
  { key: "classification", label: "Ангилал хүлээж буй" },
  { key: "domestic", label: "Дотоод" },
  { key: "international", label: "Олон улс" },
  { key: "partial", label: "Хэсэгчлэн авсан" },
  { key: "ready", label: "Дуусгахад бэлэн" },
  { key: "delayed", label: "Саатсан (шүүлтүүр)" },
];


type Tone = "neutral" | "accent" | "warning" | "success" | "danger";
const TONE: Record<Tone, string> = {
  neutral: "text-text",
  accent: "text-accent",
  warning: "text-warning",
  success: "text-success",
  danger: "text-danger",
};

function Tile({ label, value, unit, sub, tone = "neutral" }: { label: string; value: ReactNode; unit: string; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-text-muted">{label}</p>
        <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">{unit}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-semibold leading-none", TONE[tone])}>{value}</p>
      {sub && <p className="mt-2 text-[11px] leading-snug text-text-muted">{sub}</p>}
    </div>
  );
}

const quantitiesText = (q: { unit: string; quantity: number }[]) => (q.length === 0 ? "—" : q.map((x) => `${qty(x.quantity)} ${x.unit}`).join(" · "));

export function ProcurementMonitoring({ range, tick, refresh }: { range: string; tick: number; refresh: () => void }) {
  const [thresholdHours, setThresholdHours] = useState<number>(72);
  const [scope, setScope] = useState<ProcurementScope>("active");
  const [filter, setFilter] = useState<ProcurementFilter>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [scope, filter, q, thresholdHours, range]);

  const overview = useLiveData<ProcurementOverview>(`${API}/procurement?range=${range}&thresholdHours=${thresholdHours}`, tick);
  const list = useLiveData<ProcurementList>(
    `${API}/procurement-requests?scope=${scope}&filter=${scope === "active" ? filter : "all"}&q=${encodeURIComponent(q)}&page=${page}&pageSize=${PAGE_SIZE}&thresholdHours=${thresholdHours}&range=${range}`,
    tick
  );
  const state = (s: { loading: boolean; fetching: boolean; error: string | null; data: unknown; updatedAt: number | null }) => ({
    loading: s.loading, fetching: s.fetching, error: s.error, hasData: s.data !== null, updatedAt: s.updatedAt,
  });
  const o = overview.data;

  return (
    <section aria-labelledby="proc-mon-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="proc-mon-title" className="text-lg font-semibold text-text">Худалдан авалтын хяналт</h2>
          <p className="text-xs text-text-muted">Бодит өгөгдөл · зөвхөн харах горим · хүсэлт, материал, тоо хэмжээг тусад нь тоолно</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Саатлын шүүлтүүр
          <select
            value={thresholdHours}
            onChange={(e) => setThresholdHours(Number(e.target.value))}
            className="focus-ring h-8 rounded-lg border border-border bg-bg-elevated px-2 text-xs text-text"
            aria-describedby="proc-threshold-note"
          >
            {THRESHOLD_HOURS.map((h) => (
              <option key={h} value={h}>
                {h >= 24 && h % 24 === 0 ? `${h / 24} өдөр` : `${h} цаг`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p id="proc-threshold-note" className="text-[11px] text-text-muted">
        Саатал нь албан ёсны SLA биш, зөвхөн хяналтын шүүлтүүр: сүүлчийн худалдан авалтын үйлдлээс хойш сонгосон хугацаа өнгөрсөн дуусаагүй захиалга.
      </p>

      {o?.mode === "LEGACY" && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Дотоод/олон улсын хариуцагч тохируулагдаагүй тул ангилал, хуваарилалт байхгүй: материал «Хуваарилаагүй» гэж харагдана.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy={overview.fetching}>
        {!o ? (
          Array.from({ length: 8 }).map((_, i) => <TileSkeleton key={i} />)
        ) : (
          <>
            <Tile label="Худалдан авалт хүлээж буй" value={o.requests.awaitingProcurement} unit="хүсэлт" tone="accent" sub={`Дуусгахад бэлэн: ${o.requests.readyToComplete} хүсэлт`} />
            <Tile label="Ангилал хүлээж буй" value={o.requests.awaitingClassification} unit="хүсэлт" tone={o.requests.awaitingClassification > 0 ? "warning" : "neutral"} sub={o.mode === "LEGACY" ? "Хариуцагч тохируулаагүй" : undefined} />
            <Tile label="Дотоод — дутуу" value={o.items.domesticOutstanding} unit="материал" sub={<>{o.domestic.requests} хүсэлт · үлдэгдэл: {quantitiesText(o.domestic.quantities)}</>} />
            <Tile label="Олон улс — дутуу" value={o.items.internationalOutstanding} unit="материал" sub={<>{o.international.requests} хүсэлт · үлдэгдэл: {quantitiesText(o.international.quantities)}</>} />
            <Tile label="Хэсэгчлэн авсан" value={o.items.partiallyPurchased} unit="материал" tone={o.items.partiallyPurchased > 0 ? "warning" : "neutral"} sub={`${o.partial.requests} хүсэлт`} />
            <Tile label="Худалдан авалт дууссан" value={o.requests.completedInRange} unit="хүсэлт" tone="success" sub={`Сонгосон хугацаанд · нягтлан хүлээж буй: ${o.requests.awaitingAccounting}`} />
            <Tile
              label={`Саатсан (≥ ${o.thresholdHours} цаг идэвхгүй)`}
              value={o.requests.idleOverThreshold}
              unit="хүсэлт"
              tone={o.requests.idleOverThreshold > 0 ? "danger" : "neutral"}
              sub="Хяналтын шүүлтүүр, SLA зөрчил биш"
            />
            <Tile
              label="Бодит худалдан авалтын зардал"
              value={formatCurrency(o.cost.inRange)}
              unit="₮"
              sub={`Сонгосон хугацаанд ${o.cost.purchasesInRange} бүртгэл · идэвхтэй захиалгад: ${formatCurrency(o.cost.openRequests)}`}
            />
          </>
        )}
      </div>

      {o && <Lifecycle o={o} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Саатал ба гацаа" state={state(overview)} onRetry={refresh}>
          {o && <Bottlenecks o={o} onOpen={setOpenId} />}
        </Panel>
        <Panel title="Хариуцсан менежерүүдийн ачаалал" state={state(overview)} onRetry={refresh}>
          {o && <Managers rows={o.managers} />}
        </Panel>
      </div>

      <Panel
        title="Худалдан авалтын захиалгууд"
        state={state(list)}
        onRetry={refresh}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Дугаар, хэлтэс, материал"
              aria-label="Худалдан авалтын захиалга хайх"
              className="focus-ring h-8 w-44 rounded-lg border border-border bg-bg-elevated pl-7 pr-2 text-xs text-text sm:w-56"
            />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div role="group" aria-label="Хамрах хүрээ" className="flex max-w-full overflow-hidden rounded-lg border border-border">
            {SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={scope === s.key}
                onClick={() => setScope(s.key)}
                className={cn("focus-ring min-w-0 px-3 py-1.5 text-xs max-md:min-h-11 max-sm:flex-1 max-sm:break-words", scope === s.key ? "bg-accent text-bg" : "bg-bg-surface text-text-muted hover:text-text")}
              >
                {s.label}
              </button>
            ))}
          </div>
          {scope === "active" && (
            <div role="group" aria-label="Шүүлтүүр" className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn("focus-ring rounded-full border px-2.5 py-1 text-[11px]", filter === f.key ? "border-accent bg-accent/15 text-accent" : "border-border text-text-muted hover:text-text")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {list.data && (
          <>
            <RequestTable rows={list.data.rows} expanded={expanded} setExpanded={setExpanded} onOpen={setOpenId} scope={scope} />
            <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>

      <ProcurementDetailModal id={openId} thresholdHours={thresholdHours} tick={tick} onClose={() => setOpenId(null)} />
    </section>
  );
}

// CEO approved -> awaiting classification -> two parallel tracks -> accounting. Every number is a request
// count taken from the real data; "partial" and the tracks are derived, not workflow states.
function Lifecycle({ o }: { o: ProcurementOverview }) {
  const Box = ({ title, n, tone, note }: { title: string; n: number; tone?: string; note?: string }) => (
    <div className={cn("min-w-[120px] flex-1 rounded-lg border border-border bg-bg-elevated/40 p-3", tone)}>
      <p className="text-[11px] text-text-muted">{title}</p>
      <p className="mt-1 text-xl font-semibold text-text">{n}</p>
      {note && <p className="mt-0.5 text-[10px] text-text-muted">{note}</p>}
    </div>
  );
  const Arrow = () => <ChevronRight className="hidden size-4 shrink-0 self-center text-text-muted xl:block" aria-hidden />;
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4" role="group" aria-label="Худалдан авалтын амьдралын мөчлөг">
      <div className="flex flex-col gap-2 md:grid md:grid-cols-3 xl:flex xl:flex-row">
        <Box title="Гүйцэтгэх захирал баталсан" n={o.requests.awaitingProcurement} note="одоо худалдан авалтын шатанд" />
        <Arrow />
        <Box title="Ангилал хүлээж буй" n={o.requests.awaitingClassification} tone={o.requests.awaitingClassification > 0 ? "border-warning/40" : undefined} />
        <Arrow />
        <div className="flex min-w-[150px] flex-1 flex-col gap-2" aria-label="Зэрэгцээ хоёр урсгал">
          <Box title="Дотоод урсгал" n={o.domestic.requests} note={`${o.items.domesticOutstanding} материал дутуу`} />
          <Box title="Олон улсын урсгал" n={o.international.requests} note={`${o.items.internationalOutstanding} материал дутуу`} />
        </div>
        <Arrow />
        <Box title="Хэсэгчлэн авсан (тооцоолсон)" n={o.partial.requests} note={`${o.partial.items} материал`} />
        <Arrow />
        <Box title="Дуусгахад бэлэн" n={o.requests.readyToComplete} />
        <Arrow />
        <Box title="Нягтлан хүлээж буй" n={o.requests.awaitingAccounting} />
      </div>
      <p className="mt-2 text-[11px] text-text-muted">
        Дотоод ба олон улсын урсгал нэгэн зэрэг явагдана: нэг захиалга хоёуланд тоологдож болно. «Хэсэгчлэн авсан» нь өгөгдлөөс тооцсон шинж, тусдаа төлөв биш.
      </p>
    </div>
  );
}

function Bottlenecks({ o, onOpen }: { o: ProcurementOverview; onOpen: (id: string) => void }) {
  const c = o.timing.classification;
  const dur = (s: number | null) => (s === null ? "—" : formatDuration(s));
  return (
    <div className="divide-y divide-border text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-3 text-xs">
        <dt className="text-text-muted">Ангилал хүлээж буй (хүсэлт)</dt>
        <dd className="text-right text-text">{c.waitingRequests}</dd>
        <dt className="text-text-muted">Ангилал хүлээсэн — дундаж / хамгийн удаан</dt>
        <dd className={cn("text-right", c.maxWaitingSeconds !== null && waitTone(c.maxWaitingSeconds))}>
          {dur(c.avgWaitingSeconds)} / {dur(c.maxWaitingSeconds)}
        </dd>
        <dt className="text-text-muted">Ангилагдсан хугацааны дундаж (сонгосон хугацаа, {c.classifiedInRange} хүсэлт)</dt>
        <dd className="text-right text-text">{dur(c.avgClassifiedSeconds)}</dd>
        <dt className="text-text-muted">Сүүлчийн үйлдлээс хойш хамгийн удаан</dt>
        <dd className={cn("text-right", o.timing.longestIdleSeconds !== null && waitTone(o.timing.longestIdleSeconds))}>{dur(o.timing.longestIdleSeconds)}</dd>
        <dt className="text-text-muted">CEO баталсан огноо тодорхойгүй</dt>
        <dd className="text-right text-text">{o.requests.missingTimestamps} хүсэлт</dd>
      </dl>
      <div className="px-5 py-3 text-xs">
        <p className="text-text-muted">Хамгийн эртний дуусаагүй худалдан авалт</p>
        {o.timing.oldest ? (
          <button type="button" onClick={() => onOpen(o.timing.oldest!.requestId)} className="focus-ring mt-1 text-left text-text hover:underline">
            №{o.timing.oldest.requestNumber} · баталсанаас {o.timing.oldest.ageSeconds === null ? "—" : formatDuration(o.timing.oldest.ageSeconds)}
            {o.timing.oldest.idleSeconds !== null && <span className="text-text-muted"> · сүүлийн үйлдлээс {formatDuration(o.timing.oldest.idleSeconds)}</span>}
          </button>
        ) : (
          <p className="mt-1 text-text-muted">Дуусаагүй худалдан авалт алга</p>
        )}
      </div>
    </div>
  );
}

function Managers({ rows }: { rows: ManagerLoad[] }) {
  return (
    <DataGrid
      head={
        <>
          <Th>Менежер</Th>
          <Th>Төрөл</Th>
          <Th className="text-right">Хүсэлт</Th>
          <Th className="text-right">Материал</Th>
          <Th className="text-right">Хамгийн эртний</Th>
          <Th className="text-right">Дундаж</Th>
        </>
      }
      empty={rows.length === 0 && "Хуваарилагдсан дуусаагүй материал алга"}
    >
      {rows.map((m) => (
        <tr key={`${m.userId}-${m.kind}`}>
          <Td>
            {m.name}
            {!m.isActive && <span className="ml-2 text-[11px] text-danger">идэвхгүй</span>}
          </Td>
          <Td>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", KIND_TONE[m.kind])}>{KIND_LABEL[m.kind]}</span>
          </Td>
          <Td className="text-right">{m.requests}</Td>
          <Td className="text-right">{m.items}</Td>
          <Td className={cn("whitespace-nowrap text-right", m.oldestSeconds !== null && waitTone(m.oldestSeconds))}>{m.oldestSeconds === null ? "—" : formatDuration(m.oldestSeconds)}</Td>
          <Td className="whitespace-nowrap text-right">{m.avgSeconds === null ? "—" : formatDuration(m.avgSeconds)}</Td>
        </tr>
      ))}
    </DataGrid>
  );
}

function TrackCell({ t }: { t: ProcurementRow["domestic"] }) {
  if (!t) return <span className="text-text-muted">—</span>;
  return (
    <span title={t.managers.join(", ")}>
      <span className={t.outstandingItems > 0 ? "text-text" : "text-success"}>
        {t.totalItems - t.outstandingItems}/{t.totalItems}
      </span>
      <span className="ml-1 text-[11px] text-text-muted">{t.managers.join(", ")}</span>
    </span>
  );
}

function RequestTable({
  rows,
  expanded,
  setExpanded,
  onOpen,
  scope,
}: {
  rows: ProcurementRow[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  onOpen: (id: string) => void;
  scope: ProcurementScope;
}) {
  return (
    <DataGrid
      head={
        <>
          <Th className="w-8">{""}</Th>
          <Th>Дугаар</Th>
          <Th>Хэлтэс</Th>
          <Th>Шат</Th>
          <Th>Явц</Th>
          <Th>Дотоод</Th>
          <Th>Олон улс</Th>
          <Th className="text-right">{scope === "active" ? "Сүүлийн үйлдлээс" : "Үргэлжилсэн"}</Th>
          <Th className="text-right">Бодит зардал</Th>
          <Th>{""}</Th>
        </>
      }
      empty={rows.length === 0 && "Энэ шүүлтүүрт тохирох захиалга алга"}
    >
      {rows.map((r) => {
        const open = expanded === r.requestId;
        const time = scope === "active" ? r.idleSeconds : r.ageSeconds;
        return (
          <Fragment key={r.requestId}>
            <tr className={cn(r.delayed && "bg-danger/5")}>
              <Td>
                <button type="button" onClick={() => setExpanded(open ? null : r.requestId)} aria-expanded={open} aria-label={`№${r.requestNumber} материалууд`} className="focus-ring rounded p-0.5 text-text-muted hover:text-text">
                  {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
              </Td>
              <Td className="whitespace-nowrap font-medium">№{r.requestNumber}</Td>
              <Td>{r.department}</Td>
              <Td>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", STAGE_TONE[r.stage])}>{STAGE_LABEL[r.stage]}</span>
                {r.partiallyPurchased && r.stage === "IN_PROCUREMENT" && <span className="ml-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">хэсэгчлэн</span>}
              </Td>
              <Td className="whitespace-nowrap" title={r.completionBasis === "value" ? "Материалын тооцоолсон үнэ цэнээр жигнэсэн" : r.completionBasis === "items" ? "Материалын тоогоор тэнцүү жигнэсэн (үнэ байхгүй)" : undefined}>
                {r.completionPercent === null ? <span className="text-text-muted">—</span> : `${formatNumber(r.completionPercent, 1)}%`}
                <span className="ml-1 text-[11px] text-text-muted">{r.completeItems}/{r.requiredItems} мат.</span>
              </Td>
              <Td><TrackCell t={r.domestic} /></Td>
              <Td><TrackCell t={r.international} /></Td>
              <Td className={cn("whitespace-nowrap text-right", scope === "active" && time !== null && waitTone(time))}>{time === null ? "—" : formatDuration(time)}</Td>
              <Td className="whitespace-nowrap text-right">{r.actualCost > 0 ? formatCurrency(r.actualCost) : "—"}</Td>
              <Td>
                <button type="button" onClick={() => onOpen(r.requestId)} className="focus-ring rounded px-2 py-1 text-xs text-accent hover:underline">
                  Дэлгэрэнгүй
                </button>
              </Td>
            </tr>
            {open && (
              <tr>
                <td colSpan={10} className="bg-bg-elevated/20 p-0">
                  <ItemsTable items={r.items} />
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </DataGrid>
  );
}
