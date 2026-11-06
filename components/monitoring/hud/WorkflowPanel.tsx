"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import type { OverviewData, PendingData } from "@/lib/monitoring/types";
import { cn } from "@/lib/utils";
import { formatDuration, statusLabel, waitTone } from "../format";
import { useLiveData } from "../useLiveData";
import { AnimatedNumber } from "./AnimatedNumber";
import { buildStageViews, STAGES, type SceneApi, type StageView } from "./stages";

const API = "/api/admin/monitoring";

// three.js + R3F load only when this panel mounts, never with the page shell.
const WorkflowScene = dynamic(() => import("./WorkflowScene"), {
  ssr: false,
  loading: () => <div className="mh-scene-loading">3D ачаалж байна…</div>,
});

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Lightweight 2D rendition of the same pipeline: the WebGL fallback and the
// keyboard/touch-friendly legend under the 3D view.
function StageChips({ stages, selected, onSelect, large }: { stages: StageView[]; selected: string | null; onSelect: (k: string | null) => void; large?: boolean }) {
  return (
    <ol className={cn("mh-chips", large && "mh-chips--large")}>
      {stages.map((s, i) => (
        <li key={s.key}>
          <button
            type="button"
            onClick={() => onSelect(selected === s.key ? null : s.key)}
            aria-pressed={selected === s.key}
            data-tone={s.tone}
            className="mh-chip focus-ring"
          >
            <span className="mh-chip-idx">{i + 1}</span>
            <span className="mh-chip-name">{s.label}</span>
            <b className="mh-chip-count">
              <AnimatedNumber value={s.count} />
            </b>
            {s.returned > 0 && <i className="mh-chip-ret" title="Буцаагдсан">↩ {s.returned}</i>}
          </button>
        </li>
      ))}
    </ol>
  );
}

function StageOrders({ statuses, tick }: { statuses: string[]; tick: number }) {
  const s = useLiveData<PendingData>(`${API}/pending?page=1&pageSize=100`, tick);
  const rows = (s.data?.list.rows ?? []).filter((r) => statuses.includes(r.status));
  if (s.loading) return <p className="text-[11px] text-text-muted">Захиалгууд ачаалж байна…</p>;
  if (!s.data) return <p className="text-[11px] text-danger">{s.error ?? "Ачаалж чадсангүй"}</p>;
  if (rows.length === 0) return <p className="text-[11px] text-text-muted">Энэ шатанд хүлээгдэж буй захиалга алга</p>;
  return (
    <ul className="space-y-1">
      {rows.slice(0, 6).map((r) => (
        <li key={r.id}>
          <Link href={`/requests/${r.id}`} className="mh-order focus-ring">
            <span className="font-medium">№{r.requestNumber}</span>
            <span className="truncate max-sm:whitespace-normal max-sm:break-words text-text-muted">{r.department}</span>
            <span className={cn("ml-auto shrink-0 tabular-nums", waitTone(r.waitingSeconds))}>{formatDuration(r.waitingSeconds)}</span>
          </Link>
        </li>
      ))}
      {rows.length > 6 && <li className="text-[11px] text-text-muted">…бусад {rows.length - 6} захиалга</li>}
      {s.data.list.total > 100 && <li className="text-[11px] text-warning">Хамгийн удаан хүлээж буй эхний 100-аас харуулав</li>}
    </ul>
  );
}

function StageDetail({
  stage,
  overview,
  pending,
  tick,
  onClose,
}: {
  stage: StageView;
  overview: OverviewData;
  pending: PendingData | null;
  tick: number;
  onClose: () => void;
}) {
  const def = STAGES.find((s) => s.key === stage.key)!;
  const isPending = def.statuses.some((s) => s.startsWith("PENDING"));
  const waits = pending?.stages.filter((s) => def.statuses.includes(s.status as never)) ?? [];
  const wait = waits[0];
  return (
    <aside className="mh-detail" aria-label={`${stage.label} шатны дэлгэрэнгүй`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Шат {STAGES.indexOf(def) + 1}</p>
          <h4 className="text-sm font-semibold text-text">{stage.label}</h4>
        </div>
        <button type="button" onClick={onClose} className="focus-ring rounded p-1 text-text-muted hover:text-text" aria-label="Хаах">
          <X className="size-4" />
        </button>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {[...def.statuses, ...def.returned].map((st) => (
          <li key={st} className="flex justify-between gap-3">
            <span className="text-text-muted">{statusLabel(st)}</span>
            <span className="font-medium tabular-nums text-text">{overview.byStatus[st] ?? 0}</span>
          </li>
        ))}
      </ul>
      {isPending && wait && (
        <p className="mt-2 border-t border-border pt-2 text-[11px] text-text-muted">
          Дундаж хүлээлт <span className={waitTone(wait.avgSeconds)}>{formatDuration(wait.avgSeconds)}</span> · хамгийн удаан{" "}
          <span className={waitTone(wait.maxSeconds)}>{formatDuration(wait.maxSeconds)}</span>
        </p>
      )}
      <div className="mt-2 border-t border-border pt-2">
        {isPending ? (
          <StageOrders statuses={def.statuses} tick={tick} />
        ) : (
          <Link href={def.href} className="text-xs font-medium text-accent hover:underline">
            Захиалгуудыг харах →
          </Link>
        )}
      </div>
    </aside>
  );
}

export function WorkflowPanel({ overview, pending, tick }: { overview: OverviewData; pending: PendingData | null; tick: number }) {
  const stages = useMemo(() => buildStageViews(overview.byStatus), [overview.byStatus]);
  const [selected, setSelected] = useState<string | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);

  useEffect(() => setWebgl(hasWebGL()), []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Pause rendering while scrolled out of view or in a background tab.
  useEffect(() => {
    const el = box.current;
    const io = el ? new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.02 }) : null;
    if (el && io) io.observe(el);
    const onVis = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Ctrl/Cmd + wheel zooms the scene; a plain wheel keeps scrolling the page.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !apiRef.current) return;
      e.preventDefault();
      apiRef.current.zoomBy(e.deltaY < 0 ? 1 / 1.12 : 1.12);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const frameloop = !inView || !tabVisible ? "never" : reduced ? "demand" : "always";
  const selectedStage = stages.find((s) => s.key === selected) ?? null;
  const fallback = <StageChips stages={stages} selected={selected} onSelect={setSelected} large />;

  return (
    <div className="flex h-full flex-col">
      <div ref={box} className="mh-scene">
        {webgl === false ? (
          <div className="p-4">{fallback}</div>
        ) : webgl ? (
          <SceneBoundary fallback={<div className="p-4">{fallback}</div>}>
            <WorkflowScene stages={stages} selected={selected} onSelect={setSelected} frameloop={frameloop} reduced={reduced} apiRef={apiRef} />
            <div className="mh-zoom">
              <button type="button" className="focus-ring" onClick={() => apiRef.current?.zoomBy(1 / 1.2)} aria-label="Томруулах">
                <Plus className="size-3.5" />
              </button>
              <button type="button" className="focus-ring" onClick={() => apiRef.current?.zoomBy(1.2)} aria-label="Жижигрүүлэх">
                <Minus className="size-3.5" />
              </button>
              <button type="button" className="focus-ring" onClick={() => apiRef.current?.reset()} aria-label="Дүрслэлийг сэргээх">
                <RotateCcw className="size-3.5" />
              </button>
            </div>
            <p className="mh-hint">Чирж эргүүлнэ · Ctrl + гүйлгэж томруулна · шат дээр дарж захиалгыг үзнэ</p>
          </SceneBoundary>
        ) : (
          <div className="mh-scene-loading">3D ачаалж байна…</div>
        )}
        {selectedStage && <StageDetail stage={selectedStage} overview={overview} pending={pending} tick={tick} onClose={() => setSelected(null)} />}
      </div>
      {webgl && <StageChips stages={stages} selected={selected} onSelect={setSelected} />}
    </div>
  );
}
