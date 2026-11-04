"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FastForward, Minus, Pause, Plus, Rewind, RotateCcw } from "lucide-react";
import { MONITORING_TZ } from "@/lib/monitoring/time";
import { cn } from "@/lib/utils";
import { loadEngine, V, type LoadedEngine } from "./engine";
import { useSceneEnv } from "./sceneKit";
import type { MachineApi, MachineReadout } from "./TimeMachineScene";
import "./time-machine.css";

const RANGE_DAYS = 30;
const UB_OFFSET_SECONDS = 8 * 3600;
const SPEEDS = [1, 4, 16] as const;

const momentFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: MONITORING_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const TimeMachineScene = dynamic(() => import("./TimeMachineScene"), {
  ssr: false,
  loading: () => <div className="tm-loading">3D ачаалж байна…</div>,
});

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type Mode = "idle" | "history" | "simulation";

// <input type="datetime-local"> value for an instant, in Ulaanbaatar time.
const toPickerValue = (ms: number) => momentFmt.format(new Date(ms)).slice(0, 16).replace(" ", "T");

export interface TimeMachinePanelProps {
  /** The selected moment (epoch ms, whole seconds): reported when playback stops, on Today, or when a time is typed in. */
  onMomentChange: (epochMs: number) => void;
  /** A backend operation is running; the machine glows while it does. */
  busy?: boolean;
  /** Real actions that depend on the selected moment (reconstruct, snapshot). */
  actions?: ReactNode;
}

export function TimeMachinePanel({ onMomentChange, busy = false, actions }: TimeMachinePanelProps) {
  const box = useRef<HTMLDivElement>(null);
  const { webgl, reduced, active } = useSceneEnv(box);
  const [loaded, setLoaded] = useState<LoadedEngine | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [speedIdx, setSpeedIdx] = useState(0);
  const [edge, setEdge] = useState<"start" | "end" | null>("end");
  const [picker, setPicker] = useState("");
  const anchorMs = useRef(0); // the instant position 1.0 refers to (page load)
  const apiRef = useRef<MachineApi | null>(null);
  const momentEl = useRef<HTMLSpanElement>(null);
  const offsetEl = useRef<HTMLSpanElement>(null);
  const modeRef = useRef<Mode>("idle");
  modeRef.current = mode;

  useEffect(() => {
    let alive = true;
    loadEngine().then((l) => {
      if (!alive) return;
      anchorMs.current = Date.now();
      l.engine.init(RANGE_DAYS, anchorMs.current / 1000, UB_OFFSET_SECONDS);
      l.engine.setSpeed(SPEEDS[0]);
      setLoaded(l);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    loaded?.engine.setIdle(!reduced);
  }, [loaded, reduced]);

  // Readout is written to the DOM directly: the 3D loop never re-renders React.
  const writeReadout = useCallback((r: MachineReadout) => {
    if (momentEl.current) momentEl.current.textContent = momentFmt.format(new Date(r.moment * 1000));
    if (offsetEl.current) {
      const days = (1 - r.position) * RANGE_DAYS;
      offsetEl.current.textContent = days < 0.005 ? "Одоо" : `${days.toFixed(1)} өдрийн өмнө`;
    }
    const e = r.position <= 0 ? "start" : r.position >= 1 ? "end" : null;
    setEdge((prev) => (prev === e ? prev : e));
    if (!r.playing && modeRef.current !== "idle") setMode("idle");
  }, []);

  // Initial readout once the engine exists.
  useEffect(() => {
    if (!loaded) return;
    const e = loaded.engine;
    writeReadout({ moment: e.value(V.momentEpoch), position: e.value(V.position), playing: false });
  }, [loaded, writeReadout]);

  // Tell the workspace which moment is selected whenever the machine is at rest.
  const announce = useCallback(
    (e: { value: (id: number) => number }) => {
      const ms = Math.round(e.value(V.momentEpoch)) * 1000;
      setPicker(toPickerValue(ms));
      onMomentChange(ms);
    },
    [onMomentChange]
  );
  useEffect(() => {
    if (loaded && mode === "idle") announce(loaded.engine);
  }, [loaded, mode, announce]);

  // Exact date and time (Ulaanbaatar), within the machine's window.
  const applyPicker = (value: string) => {
    const e = loaded?.engine;
    const target = Date.parse(`${value}:00+08:00`);
    if (!e || Number.isNaN(target)) return;
    const windowMs = RANGE_DAYS * 86_400_000;
    const clamped = Math.min(anchorMs.current, Math.max(anchorMs.current - windowMs, target));
    e.setPlaying(false);
    e.setPosition(1 - (anchorMs.current - clamped) / windowMs);
    setMode("idle");
    writeReadout({ moment: e.value(V.momentEpoch), position: e.value(V.position), playing: false });
    announce(e);
  };

  // No WebGL: tick the engine ourselves while it plays so the readout still works.
  useEffect(() => {
    if (!loaded || webgl !== false || mode === "idle" || !active) return;
    const e = loaded.engine;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      e.tick((t - last) / 1000);
      last = t;
      writeReadout({ moment: e.value(V.momentEpoch), position: e.value(V.position), playing: e.value(V.playing) === 1 });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [loaded, webgl, mode, active, writeReadout]);

  // Ctrl/Cmd + wheel zooms the instrument; a plain wheel scrolls the page.
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

  const play = (target: "history" | "simulation") => {
    const e = loaded?.engine;
    if (!e) return;
    if (mode === target) {
      e.setPlaying(false);
      setMode("idle");
      return;
    }
    e.setDirection(target === "history" ? -1 : 1);
    e.setPlaying(true);
    setMode(e.value(V.playing) === 1 ? target : "idle");
  };

  const setSpeed = (i: number) => {
    setSpeedIdx(i);
    loaded?.engine.setSpeed(SPEEDS[i]);
  };

  const goNow = () => {
    const e = loaded?.engine;
    if (!e) return;
    e.setPlaying(false);
    e.setPosition(1);
    setMode("idle");
    writeReadout({ moment: e.value(V.momentEpoch), position: 1, playing: false });
    announce(e);
    apiRef.current?.reset();
  };

  const frameloop = !active ? "never" : reduced ? "demand" : "always";
  const controls = (
    <>
      <button
        type="button"
        className="tm-lever tm-lever--left focus-ring"
        onClick={() => play("history")}
        disabled={!loaded || (edge === "start" && mode !== "history")}
        aria-pressed={mode === "history"}
      >
        {mode === "history" ? <Pause className="size-5" /> : <Rewind className="size-5" />}
        <span>History</span>
        <small>Өнгөрсөн рүү</small>
      </button>
      <button
        type="button"
        className="tm-lever tm-lever--right focus-ring"
        onClick={() => play("simulation")}
        disabled={!loaded || (edge === "end" && mode !== "simulation")}
        aria-pressed={mode === "simulation"}
      >
        {mode === "simulation" ? <Pause className="size-5" /> : <FastForward className="size-5" />}
        <span>Simulation</span>
        <small>Одоо руу</small>
      </button>
    </>
  );

  return (
    <section className="tm-card" aria-label="Time Machine">
      <header className="tm-head">
        <h3>Time Machine</h3>
        <span className="tm-badge" data-kind={loaded?.kind ?? "loading"} title={loaded?.note}>
          {loaded ? (loaded.kind === "wasm" ? "C++ / WASM" : "JS fallback") : "ачаалж байна"}
        </span>
      </header>

      <div ref={box} className="tm-stage">
        {!loaded || webgl === null ? (
          <div className="tm-loading">Ачаалж байна…</div>
        ) : webgl ? (
          <SceneBoundary fallback={<FlatClock />}>
            <TimeMachineScene engine={loaded.engine} frameloop={frameloop} reduced={reduced} apiRef={apiRef} onReadout={writeReadout} busy={busy} />
            <div className="tm-zoom">
              <button type="button" className="focus-ring" onClick={() => apiRef.current?.zoomBy(1 / 1.2)} aria-label="Томруулах">
                <Plus className="size-3.5" />
              </button>
              <button type="button" className="focus-ring" onClick={() => apiRef.current?.zoomBy(1.2)} aria-label="Жижигрүүлэх">
                <Minus className="size-3.5" />
              </button>
              <button type="button" className="focus-ring" onClick={() => apiRef.current?.reset()} aria-label="Камерыг сэргээх">
                <RotateCcw className="size-3.5" />
              </button>
            </div>
          </SceneBoundary>
        ) : (
          <FlatClock />
        )}
        {controls}
      </div>

      <footer className="tm-foot">
        <div className="tm-speeds" role="group" aria-label="Хурд">
          {SPEEDS.map((s, i) => (
            <button key={s} type="button" className={cn("focus-ring", speedIdx === i && "is-on")} aria-pressed={speedIdx === i} onClick={() => setSpeed(i)}>
              ×{s}
            </button>
          ))}
        </div>
        <button type="button" className="tm-now focus-ring" onClick={goNow} disabled={!loaded}>
          Одоо
        </button>
        <div className="tm-readout">
          <span ref={momentEl} className="tm-moment tabular-nums">--</span>
          <span ref={offsetEl} className="tm-offset">Одоо</span>
        </div>
        <div className="tm-picker">
          <label className="tm-picker-field">
            <span>Тодорхой огноо, цаг (УБ)</span>
            <input
              type="datetime-local"
              value={picker}
              min={anchorMs.current ? toPickerValue(anchorMs.current - RANGE_DAYS * 86_400_000) : undefined}
              max={anchorMs.current ? toPickerValue(anchorMs.current) : undefined}
              disabled={!loaded}
              onChange={(e) => e.target.value && applyPicker(e.target.value)}
              className="focus-ring"
            />
          </label>
          <div className="tm-actions">{actions}</div>
        </div>
        <p className="tm-note">
          Машин сүүлийн {RANGE_DAYS} хоногийн цагийг сонгоно. «Сэргээх» нь тэр мөчийн захиалгын төлвийг audit log-оос сэргээнэ. Бүрэн бус байж болох ба хэзээ ч таамаглахгүй.
          {loaded?.kind === "js" && loaded.note ? ` (WASM: ${loaded.note})` : ""}
        </p>
      </footer>
    </section>
  );
}

// WebGL unavailable: the readout and controls above still drive the engine.
function FlatClock() {
  return (
    <div className="tm-loading">
      <div>
        <p className="text-sm text-text">3D дэмжигдэхгүй байна</p>
        <p className="mt-1 text-xs text-text-muted">Доорх цагийн заалт болон удирдлага ажиллана.</p>
      </div>
    </div>
  );
}
