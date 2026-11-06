"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type {
  ActivityRow,
  DepartmentRow,
  EmployeeRow,
  OverviewData,
  Paged,
  PendingData,
  ReturnedRow,
} from "@/lib/monitoring/types";
import type { RequestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ACTION_LABEL,
  formatDuration,
  formatUB,
  ROLE_LABEL,
  statusLabel,
  waitTone,
} from "./format";
import { HudOverview, LiveClock } from "./hud/HudOverview";
import { DataGrid, Pager, Panel, Td, Th } from "./Panel";
import { ProcurementMonitoring } from "./ProcurementMonitoring";
import { REFRESH_INTERVAL_MS, useLiveData, useRefreshTick } from "./useLiveData";

const API = "/api/admin/monitoring";
const PAGE_SIZE = 10;

const RANGES = [
  { key: "7d", label: "7 хоног" },
  { key: "30d", label: "30 хоног" },
  { key: "90d", label: "90 хоног" },
  { key: "all", label: "Бүгд" },
] as const;

const FILTER_ACTIONS = ["SUBMIT", "APPROVE", "RETURN", "RESUBMIT", "RESERVE_STOCK", "ACCOUNTING_RECORD", "CREATE_USER", "UPDATE_USER", "VIEW_MONITORING", "MONITORING_ACCESS_DENIED"];

function stateOf<T>(s: ReturnType<typeof useLiveData<T>>) {
  return { loading: s.loading, fetching: s.fetching, error: s.error, hasData: s.data !== null, updatedAt: s.updatedAt };
}

export function MonitoringDashboard() {
  const { tick, refresh } = useRefreshTick();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30d");
  const [pendingPage, setPendingPage] = useState(1);
  // Fetched once here: the command center (3D scene, KPIs, bottleneck card) and
  // the detail tables below read the same responses.
  const overview = useLiveData<OverviewData>(`${API}/overview?range=${range}`, tick);
  const pending = useLiveData<PendingData>(`${API}/pending?page=${pendingPage}&pageSize=${PAGE_SIZE}`, tick);

  // Record one access entry per page load (not per 30 s refresh).
  useEffect(() => {
    fetch(`${API}/view`, { method: "POST" }).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="mh-live">LIVE</span>
          <p className="text-xs text-text-muted">
            Бодит өгөгдөл · Улаанбаатарын цаг (UTC+8) · {REFRESH_INTERVAL_MS / 1000} секунд тутам шинэчлэгдэнэ
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LiveClock />
          <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Хугацааны муж" className="flex overflow-hidden rounded-lg border border-border">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                aria-pressed={range === r.key}
                className={cn(
                  "focus-ring px-3 py-1.5 text-xs transition-colors",
                  range === r.key ? "bg-accent text-bg" : "bg-bg-surface text-text-muted hover:text-text"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={refresh}>
            <RefreshCw className="size-3.5" />
            Шинэчлэх
          </Button>
          </div>
        </div>
      </div>

      <HudOverview overview={overview} pending={pending.data} range={range} tick={tick} refresh={refresh} />
      <ProcurementMonitoring range={range} tick={tick} refresh={refresh} />
      <PendingSection s={pending} setPage={setPendingPage} refresh={refresh} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DepartmentsSection range={range} tick={tick} refresh={refresh} />
        <EmployeesSection range={range} tick={tick} refresh={refresh} />
      </div>
      <ReturnedSection range={range} tick={tick} refresh={refresh} />
      <ActivitySection range={range} tick={tick} refresh={refresh} />
    </div>
  );
}

interface SectionProps {
  tick: number;
  refresh: () => void;
}
type RangeProps = SectionProps & { range: string };

function PendingSection({
  s,
  setPage,
  refresh,
}: {
  s: ReturnType<typeof useLiveData<PendingData>>;
  setPage: (p: number) => void;
  refresh: () => void;
}) {
  const d = s.data;
  const worst = d?.stages[0];

  return (
    <Panel title="Батлалт хүлээж буй хугацаа ба гацаа (bottleneck)" state={stateOf(s)} onRetry={refresh}>
      {d && (
        <>
          {worst && (
            <p className="border-b border-border bg-warning/5 px-5 py-2.5 text-xs text-text-muted">
              Хамгийн их хүлээлт: <span className="font-medium text-text">{statusLabel(worst.status)}</span> — {worst.count} захиалга, дундаж{" "}
              {formatDuration(worst.avgSeconds)}, хамгийн удаан {formatDuration(worst.maxSeconds)}
            </p>
          )}
          {d.truncated && <p className="px-5 py-2 text-xs text-warning">Хүлээгдэж буй захиалга хэт олон тул эхний мөрүүдийг л тооцсон.</p>}

          <div className="grid grid-cols-1 xl:grid-cols-2">
            <DataGrid
              head={
                <>
                  <Th>Шат</Th>
                  <Th className="text-right">Тоо</Th>
                  <Th className="text-right">Дундаж</Th>
                  <Th className="text-right">Медиан</Th>
                  <Th className="text-right">Хамгийн удаан</Th>
                </>
              }
              empty={d.stages.length === 0 && "Батлалт хүлээж буй захиалга алга"}
            >
              {d.stages.map((st) => (
                <tr key={st.status}>
                  <Td>{statusLabel(st.status)}</Td>
                  <Td className="text-right">{st.count}</Td>
                  <Td className={cn("text-right", waitTone(st.avgSeconds))}>{formatDuration(st.avgSeconds)}</Td>
                  <Td className="text-right">{formatDuration(st.medianSeconds)}</Td>
                  <Td className={cn("text-right", waitTone(st.maxSeconds))}>{formatDuration(st.maxSeconds)}</Td>
                </tr>
              ))}
            </DataGrid>
            <DataGrid
              head={
                <>
                  <Th>Хариуцагч (одоогийн шат)</Th>
                  <Th className="text-right">Хүлээгдэж буй</Th>
                  <Th className="text-right">Дундаж</Th>
                  <Th className="text-right">Хамгийн удаан</Th>
                </>
              }
              empty={d.assignees.length === 0 && "Хариуцагч алга"}
            >
              {d.assignees.map((a) => (
                <tr key={a.userId ?? "unassigned"}>
                  <Td>{a.name}</Td>
                  <Td className="text-right">{a.count}</Td>
                  <Td className={cn("text-right", waitTone(a.avgSeconds))}>{formatDuration(a.avgSeconds)}</Td>
                  <Td className={cn("text-right", waitTone(a.maxSeconds))}>{formatDuration(a.maxSeconds)}</Td>
                </tr>
              ))}
            </DataGrid>
          </div>

          <div className="border-t border-border">
            <p className="px-5 pb-1 pt-3 text-xs font-medium text-text">Хамгийн удаан хүлээж буй захиалгууд</p>
            <DataGrid
              head={
                <>
                  <Th>Дугаар</Th>
                  <Th>Хэлтэс</Th>
                  <Th>Үүсгэсэн</Th>
                  <Th>Одоогийн шат</Th>
                  <Th>Хариуцагч</Th>
                  <Th>Хүлээлт эхэлсэн</Th>
                  <Th className="text-right">Хүлээсэн хугацаа</Th>
                </>
              }
              empty={d.list.rows.length === 0 && "Батлалт хүлээж буй захиалга алга"}
            >
              {d.list.rows.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">№{r.requestNumber}</Td>
                  <Td>{r.department}</Td>
                  <Td>{r.requestedBy}</Td>
                  <Td>
                    <StatusBadge status={r.status as RequestStatus} />
                  </Td>
                  <Td>{r.assignee ?? <span className="text-text-muted">—</span>}</Td>
                  <Td className="whitespace-nowrap text-text-muted">{formatUB(r.since)}</Td>
                  <Td className={cn("whitespace-nowrap text-right font-medium", waitTone(r.waitingSeconds))}>{formatDuration(r.waitingSeconds)}</Td>
                </tr>
              ))}
            </DataGrid>
            <Pager page={d.list.page} pageSize={d.list.pageSize} total={d.list.total} onPage={setPage} />
          </div>
        </>
      )}
    </Panel>
  );
}

function CountCells({ r }: { r: { total: number; pending: number; returned: number; completed: number } }) {
  return (
    <>
      <Td className="text-right font-medium">{r.total}</Td>
      <Td className="text-right">{r.pending}</Td>
      <Td className={cn("text-right", r.returned > 0 && "text-warning")}>{r.returned}</Td>
      <Td className="text-right">{r.completed}</Td>
    </>
  );
}
const countHeads = (
  <>
    <Th className="text-right">Нийт</Th>
    <Th className="text-right">Хүлээгдэж буй</Th>
    <Th className="text-right">Буцаагдсан</Th>
    <Th className="text-right">Дууссан</Th>
  </>
);

function DepartmentsSection({ range, tick, refresh }: RangeProps) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [range]);
  const s = useLiveData<Paged<DepartmentRow>>(`${API}/departments?range=${range}&page=${page}&pageSize=${PAGE_SIZE}`, tick);
  return (
    <Panel title="Хэлтсээр захиалгын тоо" state={stateOf(s)} onRetry={refresh}>
      {s.data && (
        <>
          <DataGrid
            head={
              <>
                <Th>Хэлтэс</Th>
                <Th className="text-right">Идэвхтэй ажилтан</Th>
                {countHeads}
              </>
            }
            empty={s.data.rows.length === 0 && "Хэлтэс алга"}
          >
            {s.data.rows.map((r) => (
              <tr key={r.id}>
                <Td>{r.name}</Td>
                <Td className="text-right">{r.activeMembers}</Td>
                <CountCells r={r} />
              </tr>
            ))}
          </DataGrid>
          <Pager page={s.data.page} pageSize={s.data.pageSize} total={s.data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

function EmployeesSection({ range, tick, refresh }: RangeProps) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [range]);
  const s = useLiveData<Paged<EmployeeRow>>(`${API}/employees?range=${range}&page=${page}&pageSize=${PAGE_SIZE}`, tick);
  return (
    <Panel title="Ажилтнаар захиалгын тоо" state={stateOf(s)} onRetry={refresh}>
      {s.data && (
        <>
          <DataGrid
            head={
              <>
                <Th>Ажилтан</Th>
                <Th>Хэлтэс</Th>
                {countHeads}
              </>
            }
            empty={s.data.rows.length === 0 && "Энэ хугацаанд захиалга үүсгэсэн ажилтан алга"}
          >
            {s.data.rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  {r.name}
                  <span className="ml-2 text-[11px] text-text-muted">{ROLE_LABEL[r.role] ?? r.role}</span>
                  {!r.isActive && <span className="ml-2 text-[11px] text-danger">идэвхгүй</span>}
                </Td>
                <Td className="text-text-muted">{r.department ?? "—"}</Td>
                <CountCells r={r} />
              </tr>
            ))}
          </DataGrid>
          <Pager page={s.data.page} pageSize={s.data.pageSize} total={s.data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

function ReturnedSection({ range, tick, refresh }: RangeProps) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [range]);
  const s = useLiveData<Paged<ReturnedRow>>(`${API}/returned?range=${range}&page=${page}&pageSize=${PAGE_SIZE}`, tick);
  return (
    <Panel title="Буцаагдсан захиалгууд" state={stateOf(s)} onRetry={refresh}>
      {s.data && (
        <>
          <DataGrid
            head={
              <>
                <Th>Дугаар</Th>
                <Th>Хэлтэс</Th>
                <Th>Үүсгэсэн</Th>
                <Th>Төлөв</Th>
                <Th>Буцаасан</Th>
                <Th>Шалтгаан</Th>
                <Th>Огноо</Th>
              </>
            }
            empty={s.data.rows.length === 0 && "Буцаагдсан захиалга алга"}
          >
            {s.data.rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">№{r.requestNumber}</Td>
                <Td>{r.department}</Td>
                <Td>{r.requestedBy}</Td>
                <Td>
                  <StatusBadge status={r.status as RequestStatus} />
                </Td>
                <Td>{r.returnedBy ?? "—"}</Td>
                <Td className="max-w-[260px] truncate" title={r.reason ?? undefined}>
                  {r.reason ?? "—"}
                </Td>
                <Td className="whitespace-nowrap text-text-muted">{r.returnedAt ? formatUB(r.returnedAt) : "—"}</Td>
              </tr>
            ))}
          </DataGrid>
          <Pager page={s.data.page} pageSize={s.data.pageSize} total={s.data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

function ActivitySection({ range, tick, refresh }: RangeProps) {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  useEffect(() => setPage(1), [range, action]);
  const s = useLiveData<Paged<ActivityRow>>(
    `${API}/activity?range=${range}&page=${page}&pageSize=${PAGE_SIZE}${action ? `&action=${action}` : ""}`,
    tick
  );
  return (
    <Panel
      title="Үйл ажиллагааны түүх"
      state={stateOf(s)}
      onRetry={refresh}
      actions={
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Үйлдлээр шүүх"
          className="focus-ring h-8 min-w-0 max-w-full rounded-lg border border-border bg-bg-elevated px-2 text-xs text-text max-md:h-11"
        >
          <option value="">Бүх үйлдэл</option>
          {FILTER_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a] ?? a}
            </option>
          ))}
        </select>
      }
    >
      {s.data && (
        <>
          <DataGrid
            head={
              <>
                <Th>Огноо (УБ)</Th>
                <Th>Хэн</Th>
                <Th>Үйлдэл</Th>
                <Th>Объект</Th>
              </>
            }
            empty={s.data.rows.length === 0 && "Үйл ажиллагаа алга"}
          >
            {s.data.rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-text-muted">{formatUB(r.createdAt)}</Td>
                <Td>{r.actorName}</Td>
                <Td>{ACTION_LABEL[r.action] ?? r.action}</Td>
                <Td className="text-text-muted">{r.entityLabel ?? r.entityType}</Td>
              </tr>
            ))}
          </DataGrid>
          <Pager page={s.data.page} pageSize={s.data.pageSize} total={s.data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}
