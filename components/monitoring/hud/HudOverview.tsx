"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Hourglass,
  Layers,
  LineChart,
  PieChart,
  Undo2,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { ActivityRow, DepartmentRow, OverviewData, Paged, PendingData } from "@/lib/monitoring/types";
import { MONITORING_TZ } from "@/lib/monitoring/time";
import { cn } from "@/lib/utils";
import { ACTION_LABEL, formatDuration, formatUB, formatUBTime, statusLabel, waitTone } from "../format";
import { Panel, TileSkeleton } from "../Panel";
import { useLiveData } from "../useLiveData";
import { AnimatedNumber } from "./AnimatedNumber";
import { ColumnChart, Donut, Legend, MechRing } from "./charts";
import { WorkflowPanel } from "./WorkflowPanel";
import "./monitoring-hud.css";

const API = "/api/admin/monitoring";
const dayFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: MONITORING_TZ });

type Live<T> = ReturnType<typeof useLiveData<T>>;

const COLOR = {
  success: "rgb(var(--color-success))",
  accent: "rgb(var(--color-accent))",
  danger: "rgb(var(--color-danger))",
  muted: "rgb(var(--color-text-muted) / 0.55)",
};

// One clock isolated in its own component: ticking every second re-renders
// only this span, never the dashboard.
export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-right leading-tight">
      <p className="text-xl font-semibold tabular-nums text-text">{now ? formatUBTime(now) : "--:--:--"}</p>
      <p className="text-[11px] text-text-muted">{now ? dayFmt.format(now) : ""}</p>
    </div>
  );
}

function HudCard({
  title,
  icon: Icon,
  right,
  tone,
  className,
  children,
}: {
  title: string;
  icon: LucideIcon;
  right?: ReactNode;
  tone?: "danger";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("mh-card", tone === "danger" && "mh-card--danger", className)}>
      <header className="mh-card-head">
        <Icon className="size-4 shrink-0 text-accent" strokeWidth={1.9} aria-hidden />
        <h3>{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </header>
      {children}
    </section>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: LucideIcon; label: string; value: number; sub?: string; tone?: string }) {
  return (
    <div className="mh-kpi">
      <span className="mh-kpi-icon" data-tone={tone}>
        <Icon className="size-5" strokeWidth={1.7} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate max-sm:whitespace-normal max-sm:break-words text-[11px] text-text-muted">{label}</p>
        <p className="text-2xl font-semibold leading-tight tabular-nums text-text">
          <AnimatedNumber value={value} />
        </p>
        {sub && <p className="truncate max-sm:whitespace-normal max-sm:break-words text-[10px] text-text-muted">{sub}</p>}
      </div>
    </div>
  );
}

function lastDays(asOf: string, n: number, daily: OverviewData["daily"]) {
  const byDay = new Map(daily.map((d) => [d.day, d.count]));
  const end = new Date(asOf).getTime();
  return Array.from({ length: n }, (_, i) => {
    const day = dayFmt.format(new Date(end - (n - 1 - i) * 86_400_000));
    return { day, count: byDay.get(day) ?? 0 };
  });
}

const dotTone = (action: string) =>
  action === "APPROVE" || action === "ACCOUNTING_RECORD"
    ? COLOR.success
    : action === "RETURN" || action === "REJECT" || action === "CANCEL" || action === "MONITORING_ACCESS_DENIED"
      ? COLOR.danger
      : action === "SUBMIT" || action === "RESUBMIT"
        ? COLOR.accent
        : COLOR.muted;

// Segmented, dimensional progress bar: 12 cells, each filled by its exact share.
const CELLS = 12;
function SegBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="mh-seg" role="presentation">
      {Array.from({ length: CELLS }, (_, i) => {
        const fill = Math.min(1, Math.max(0, (pct / 100) * CELLS - i));
        return (
          <span key={i} className="mh-seg-cell">
            <span style={{ transform: `scaleX(${fill})`, background: color }} />
          </span>
        );
      })}
    </div>
  );
}

// Same 24 h / 48 h thresholds the pending table already uses (format.ts waitTone).
type Severity = "ok" | "warn" | "alert";
const severityOf = (seconds: number): Severity => (seconds >= 48 * 3600 ? "alert" : seconds >= 24 * 3600 ? "warn" : "ok");
const SEVERITY_LABEL: Record<Severity, string> = { ok: "Хэвийн", warn: "Анхаар", alert: "Гацсан" };

export function HudOverview({
  overview,
  pending,
  range,
  tick,
  refresh,
}: {
  overview: Live<OverviewData>;
  pending: PendingData | null;
  range: string;
  tick: number;
  refresh: () => void;
}) {
  const d = overview.data;
  const departments = useLiveData<Paged<DepartmentRow>>(`${API}/departments?range=${range}&page=1&pageSize=100`, tick);
  const activity = useLiveData<Paged<ActivityRow>>(`${API}/activity?range=${range}&page=1&pageSize=6`, tick);

  const [selDept, setSelDept] = useState<string | null>(null);
  const [selDay, setSelDay] = useState<string | null>(null);

  const week = useMemo(() => (d ? lastDays(d.asOf, 7, d.daily) : []), [d]);
  const today = week.length ? week[week.length - 1].day : null;
  const activeDay = selDay && week.some((w) => w.day === selDay) ? selDay : today;
  const activeCount = week.find((w) => w.day === activeDay)?.count ?? 0;

  if (overview.loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <TileSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (!d) {
    return (
      <Panel
        title="Ерөнхий тойм"
        state={{ loading: false, fetching: overview.fetching, error: overview.error, hasData: false, updatedAt: overview.updatedAt }}
        onRetry={refresh}
      >
        {null}
      </Panel>
    );
  }

  const r = d.requests;
  const deptRows = (departments.data?.rows ?? []).filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  const donutDepts = (() => {
    const top = deptRows.slice(0, 3);
    const rest = deptRows.slice(3).reduce((n, x) => n + x.total, 0);
    const shades = ["rgb(var(--color-accent))", "rgb(var(--color-accent) / 0.62)", "rgb(var(--color-text-muted) / 0.7)", "rgb(var(--color-text-muted) / 0.38)"];
    const segs = top.map((x, i) => ({ label: x.name, value: x.total, color: shades[i] }));
    if (rest > 0) segs.push({ label: "Бусад", value: rest, color: shades[3] });
    return segs;
  })();
  const donutTotal = donutDepts.reduce((n, s) => n + s.value, 0);
  const completionPct = r.total > 0 ? Math.round((r.completed / r.total) * 100) : null;
  const worst = pending?.stages.slice(0, 3) ?? [];
  const sevs = worst.map((st) => severityOf(Math.max(st.avgSeconds, st.maxSeconds)));
  const alertCount = sevs.filter((v) => v === "alert").length;
  const warnCount = sevs.filter((v) => v === "warn").length;
  const chosenDept = deptRows.find((x) => x.id === selDept) ?? null;

  return (
    <div className="space-y-3">
      {overview.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">
          {overview.error} — өмнөх мэдээллийг харуулж байна{" "}
          <button type="button" className="underline" onClick={refresh}>
            Дахин оролдох
          </button>
        </p>
      )}

      <div className={cn("grid grid-cols-2 gap-3 transition-opacity md:grid-cols-4 xl:grid-cols-7", overview.fetching && "opacity-80")}>
        <Kpi icon={Layers} label="Идэвхтэй хэрэглэгч" value={d.users.active} sub={`нийт ${d.users.total}`} />
        <Kpi icon={Clock} label="24 цагт нэвтэрсэн" value={d.users.loggedIn24h} />
        <Kpi icon={Activity} label="24 цагт үйлдэл хийсэн" value={d.users.acted24h} />
        <Kpi icon={Users} label="Нийт захиалга" value={r.total} sub={`${d.departments} хэлтэс`} />
        <Kpi icon={Hourglass} label="Хүлээгдэж буй" value={r.pending} tone="amber" />
        <Kpi icon={Undo2} label="Буцаагдсан" value={r.returned} tone={r.returned ? "red" : undefined} />
        <Kpi icon={CheckCircle2} label="Дууссан" value={r.completed} tone="green" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,2.3fr)_minmax(0,0.95fr)]">
        <div className="flex flex-col gap-3 xl:order-1">
          <HudCard title="Хэлтсийн гүйцэтгэл" icon={BarChart3} className="flex-1">
            {deptRows.length === 0 ? (
              <p className="mh-empty">{departments.loading ? "Ачаалж байна…" : "Захиалгатай хэлтэс алга"}</p>
            ) : (
              <ul className="space-y-1 p-2.5">
                {deptRows.slice(0, 5).map((x) => {
                  const pct = Math.round((x.completed / x.total) * 100);
                  const on = selDept === x.id;
                  return (
                    <li key={x.id}>
                      <button
                        type="button"
                        onClick={() => setSelDept(on ? null : x.id)}
                        aria-pressed={on}
                        title={`${x.completed} / ${x.total} дууссан`}
                        className="mh-deptrow focus-ring"
                      >
                        <span className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                          <span className="truncate max-sm:whitespace-normal max-sm:break-words text-text">{x.name}</span>
                          <span className="tabular-nums text-text-muted">{pct}%</span>
                        </span>
                        <SegBar pct={pct} color={pct >= 80 ? COLOR.success : COLOR.accent} />
                      </button>
                    </li>
                  );
                })}
                {chosenDept ? (
                  <li className="mh-deptdetail" aria-live="polite">
                    <span>Нийт <b>{chosenDept.total}</b></span>
                    <span>Дууссан <b className="text-success">{chosenDept.completed}</b></span>
                    <span>Хүлээгдэж буй <b className="text-accent">{chosenDept.pending}</b></span>
                    <span>Буцаагдсан <b className={chosenDept.returned ? "text-danger" : undefined}>{chosenDept.returned}</b></span>
                  </li>
                ) : (
                  <li className="px-1 pt-1 text-[10px] text-text-muted">Дууссан ÷ нийт захиалга · хэлтсийг дарж задлан харна</li>
                )}
              </ul>
            )}
          </HudCard>
          <HudCard
            title="Захиалгын төлөв (7 хоног)"
            icon={LineChart}
            right={
              activeDay && (
                <span className="text-[11px] tabular-nums text-text-muted">
                  {activeDay.slice(5).replace("-", "/")} · <b className="text-text">{activeCount}</b>
                </span>
              )
            }
          >
            <div className="p-3">{activeDay && <ColumnChart days={week} selected={activeDay} onSelect={setSelDay} />}</div>
          </HudCard>
        </div>

        <HudCard title="Захиалгын батлалцуулалтын урсгал" icon={Workflow} className="mh-card--scene xl:order-2">
          <WorkflowPanel overview={d} pending={pending} tick={tick} />
        </HudCard>

        <div className="flex flex-col gap-3 xl:order-3">
          <HudCard title="Нийт гүйцэтгэл" icon={PieChart} className="flex-1">
            <div className="flex items-center gap-4 p-3.5 xl:flex-col xl:items-stretch">
              <MechRing
                label="Нийт гүйцэтгэл"
                segments={[
                  { label: "Дууссан", value: r.completed, color: COLOR.success },
                  { label: "Хүлээгдэж буй", value: r.pending, color: COLOR.accent },
                  { label: "Буцаагдсан", value: r.returned, color: COLOR.danger },
                ]}
                center={
                  <>
                    <span className="text-2xl font-semibold tabular-nums text-text">{completionPct === null ? "—" : `${completionPct}%`}</span>
                    <span className="text-[10px] text-text-muted">Дууссан</span>
                  </>
                }
              />
              <div className="min-w-0 flex-1">
                <Legend
                  items={[
                    { label: "Дууссан", value: r.completed, color: COLOR.success },
                    { label: "Хүлээгдэж буй", value: r.pending, color: COLOR.accent },
                    { label: "Буцаагдсан", value: r.returned, color: COLOR.danger },
                  ]}
                />
              </div>
            </div>
          </HudCard>
          <HudCard
            title="Гацсан / Анхаарах"
            icon={AlertTriangle}
            tone={alertCount > 0 ? "danger" : undefined}
            right={
              worst.length > 0 && (
                <span className={cn("mh-sev", alertCount > 0 ? "mh-sev--alert" : warnCount > 0 ? "mh-sev--warn" : "mh-sev--ok")}>
                  {alertCount > 0 ? `${alertCount} гацсан` : warnCount > 0 ? `${warnCount} анхаарах` : "Хэвийн"}
                </span>
              )
            }
          >
            {worst.length === 0 ? (
              <p className="mh-empty">
                <CheckCircle2 className="mx-auto mb-1.5 size-5 text-success" aria-hidden />
                Анхаарах асуудал алга
              </p>
            ) : (
              <ul className="space-y-1.5 p-3 text-xs">
                {worst.map((st, i) => {
                  const sev = sevs[i];
                  const SevIcon = sev === "ok" ? CheckCircle2 : AlertTriangle;
                  return (
                    <li key={st.status} className="mh-bn" data-sev={sev}>
                      <SevIcon className="mh-bn-icon size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate max-sm:whitespace-normal max-sm:break-words font-medium text-text">{statusLabel(st.status)}</span>
                        <span className="block text-[10px] text-text-muted">
                          {st.count} захиалга · дундаж {formatDuration(st.avgSeconds)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="mh-bn-tag">{SEVERITY_LABEL[sev]}</span>
                        <span className={cn("mt-0.5 block text-[10px] tabular-nums", waitTone(st.maxSeconds))}>{formatDuration(st.maxSeconds)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </HudCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <HudCard
          title="Өдрөөр үүссэн захиалга"
          icon={Clock}
          right={
            <Link href="/admin/monitoring/time-machine" className="text-[11px] text-text-muted hover:text-accent">
              Time Machine →
            </Link>
          }
        >
          <div className="p-3.5">
            <ol className="mh-track" aria-label="Өдрөөр үүссэн захиалга">
              {week.map((x) => (
                <li key={x.day}>
                  <button
                    type="button"
                    onClick={() => setSelDay(x.day)}
                    aria-pressed={x.day === activeDay}
                    title={`${x.day}: ${x.count} захиалга`}
                    className="mh-key focus-ring"
                    data-today={x.day === today || undefined}
                  >
                    <span className="text-[10px] text-text-muted">{x.day.slice(5).replace("-", "/")}</span>
                    <b className="text-lg tabular-nums">{x.count}</b>
                  </button>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-text-muted" aria-live="polite">
              {activeDay} · <b className="text-text">{activeCount}</b> захиалга үүссэн
            </p>
          </div>
        </HudCard>

        <HudCard title="Хэлтсээр захиалгын тоо" icon={PieChart}>
          {donutDepts.length === 0 ? (
            <p className="mh-empty">{departments.loading ? "Ачаалж байна…" : "Захиалга алга"}</p>
          ) : (
            <div className="flex items-center gap-4 p-3.5">
              <div className="w-[34%] min-w-[96px]">
                <Donut
                  label="Хэлтсээр захиалгын тоо"
                  segments={donutDepts}
                  center={
                    <>
                      <span className="text-[10px] text-text-muted">Нийт</span>
                      <span className="text-xl font-semibold tabular-nums text-text">{donutTotal}</span>
                    </>
                  }
                />
              </div>
              <div className="min-w-0 flex-1">
                <Legend items={donutDepts.map((s) => ({ label: s.label, value: `${s.value} (${Math.round((s.value / donutTotal) * 100)}%)`, color: s.color }))} />
              </div>
            </div>
          )}
        </HudCard>

        <HudCard title="Сүүлийн үйлдлүүд" icon={Activity}>
          {(activity.data?.rows.length ?? 0) === 0 ? (
            <p className="mh-empty">{activity.loading ? "Ачаалж байна…" : "Үйл ажиллагаа алга"}</p>
          ) : (
            <ol className="mh-timeline">
              {activity.data!.rows.map((a, i) => (
                <li key={a.id} className="mh-ev" style={{ animationDelay: `${i * 60}ms` }}>
                  <span className="mh-ev-dot" style={{ background: dotTone(a.action) }} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate max-sm:whitespace-normal max-sm:break-words font-medium text-text">{ACTION_LABEL[a.action] ?? a.action}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-text-muted">{formatUB(a.createdAt).slice(5)}</span>
                    </p>
                    <p className="truncate max-sm:whitespace-normal max-sm:break-words text-[11px] text-text-muted">
                      {a.actorName}
                      {a.entityLabel ? ` · ${a.entityLabel}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </HudCard>
      </div>
    </div>
  );
}
