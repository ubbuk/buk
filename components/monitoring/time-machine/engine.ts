// Timeline + mechanical state for the Time Machine instrument.
//
// Two interchangeable implementations of one contract:
//   - WASM: native/timeline-engine/timeline_engine.cpp (C++20, Emscripten)
//   - JS:   createJsEngine() below, a line-for-line port used as the fallback
// loadEngine() prefers WASM, cross-checks it against the JS port, and falls back
// to JS on any failure (file missing, instantiate error, disagreement).

export interface TimelineEngine {
  init(rangeDays: number, nowEpochSeconds: number, utcOffsetSeconds: number): void;
  setDirection(direction: -1 | 1): void;
  setSpeed(daysPerSecond: number): void;
  setPlaying(playing: boolean): void;
  setPosition(position: number): void;
  setIdle(idle: boolean): void;
  tick(dtSeconds: number): void;
  value(id: number): number;
}

// Keep in sync with enum Value in timeline_engine.cpp.
export const V = {
  position: 0,
  direction: 1,
  speed: 2,
  playing: 3,
  atStart: 4,
  atEnd: 5,
  ring0: 6, // 6..9
  gear0: 10, // 10..15
  hourHand: 16,
  minuteHand: 17,
  secondHand: 18,
  momentEpoch: 19,
  steps: 20,
} as const;
export const RING_COUNT = 4;
export const GEAR_COUNT = 6;

const TWO_PI = 2 * Math.PI;
const STEP = 1 / 120;
const MAX_FRAME = 0.1;
const SECONDS_PER_DAY = 86400;
const RING_RATIO = [0.35, -0.55, 0.8, -1.2];
const RING_IDLE = [0.05, -0.035, 0.07, -0.045];
const TEETH = [24, 12, 18, 12, 24, 16];
const MESH = [1, -1, -1, -1, 1, -1];
const GEAR_BASE = 1.6;
const GEAR_IDLE = 0.06;

const wrap = (a: number) => {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
};

export function createJsEngine(): TimelineEngine {
  let rangeDays = 30;
  let nowEpoch = 0;
  let utcOffset = 0;
  let position = 1;
  let direction: -1 | 1 = -1;
  let speed = 1;
  let playing = false;
  let idle = true;
  let acc = 0;
  let alpha = 0;
  let steps = 0;
  const ringAngle = new Array<number>(RING_COUNT).fill(0);
  const ringVel = new Array<number>(RING_COUNT).fill(0);
  const gearAngle = new Array<number>(GEAR_COUNT).fill(0);
  const gearVel = new Array<number>(GEAR_COUNT).fill(0);

  const momentEpoch = () => nowEpoch - (1 - position) * rangeDays * SECONDS_PER_DAY;
  const dayFraction = (period: number) => {
    let r = (momentEpoch() + utcOffset) % period;
    if (r < 0) r += period;
    return r / period;
  };

  const step = () => {
    const v = playing ? direction * speed : 0;
    if (playing) {
      position += (v * STEP) / rangeDays;
      if (position <= 0) {
        position = 0;
        playing = false;
      } else if (position >= 1) {
        position = 1;
        playing = false;
      }
    }
    for (let i = 0; i < RING_COUNT; i++) {
      const target = v * RING_RATIO[i] + (idle ? RING_IDLE[i] : 0);
      ringVel[i] += (target - ringVel[i]) * alpha;
      ringAngle[i] = wrap(ringAngle[i] + ringVel[i] * STEP);
    }
    for (let i = 0; i < GEAR_COUNT; i++) {
      const ratio = (24 / TEETH[i]) * MESH[i];
      const target = (v * GEAR_BASE + (idle ? GEAR_IDLE : 0)) * ratio;
      gearVel[i] += (target - gearVel[i]) * alpha;
      gearAngle[i] = wrap(gearAngle[i] + gearVel[i] * STEP);
    }
    steps++;
  };

  return {
    init(range, now, offset) {
      rangeDays = range > 0 ? range : 30;
      nowEpoch = now;
      utcOffset = offset;
      position = 1;
      direction = -1;
      speed = 1;
      playing = false;
      idle = true;
      acc = 0;
      steps = 0;
      ringAngle.fill(0);
      ringVel.fill(0);
      gearAngle.fill(0);
      gearVel.fill(0);
      alpha = 1 - Math.exp(-STEP * 3);
    },
    setDirection(d) {
      direction = d >= 0 ? 1 : -1;
    },
    setSpeed(s) {
      speed = Math.min(64, Math.max(0, s));
    },
    setPlaying(p) {
      if (!p) {
        playing = false;
        return;
      }
      playing = !((direction < 0 && position <= 0) || (direction > 0 && position >= 1));
    },
    setPosition(p) {
      position = Math.min(1, Math.max(0, p));
    },
    setIdle(i) {
      idle = i;
    },
    tick(dt) {
      if (!(dt > 0)) return;
      acc += Math.min(dt, MAX_FRAME);
      while (acc >= STEP) {
        step();
        acc -= STEP;
      }
    },
    value(id) {
      switch (id) {
        case V.position:
          return position;
        case V.direction:
          return direction;
        case V.speed:
          return speed;
        case V.playing:
          return playing ? 1 : 0;
        case V.atStart:
          return position <= 0 ? 1 : 0;
        case V.atEnd:
          return position >= 1 ? 1 : 0;
        case V.hourHand:
          return dayFraction(43200) * TWO_PI;
        case V.minuteHand:
          return dayFraction(3600) * TWO_PI;
        case V.secondHand:
          return dayFraction(60) * TWO_PI;
        case V.momentEpoch:
          return momentEpoch();
        case V.steps:
          return steps;
        default:
          if (id >= V.ring0 && id < V.ring0 + RING_COUNT) return ringAngle[id - V.ring0];
          if (id >= V.gear0 && id < V.gear0 + GEAR_COUNT) return gearAngle[id - V.gear0];
          return 0;
      }
    },
  };
}

interface WasmExports {
  memory?: WebAssembly.Memory;
  _initialize?: () => void;
  tm_init: (a: number, b: number, c: number) => void;
  tm_set_direction: (d: number) => void;
  tm_set_speed: (s: number) => void;
  tm_set_playing: (p: number) => void;
  tm_set_position: (p: number) => void;
  tm_set_idle: (i: number) => void;
  tm_tick: (dt: number) => void;
  tm_value: (id: number) => number;
}

const WASM_URL = "/wasm/timeline_engine.wasm";

function wrapWasm(x: WasmExports): TimelineEngine {
  return {
    init: (r, n, o) => x.tm_init(r, n, o),
    setDirection: (d) => x.tm_set_direction(d),
    setSpeed: (s) => x.tm_set_speed(s),
    setPlaying: (p) => x.tm_set_playing(p ? 1 : 0),
    setPosition: (p) => x.tm_set_position(p),
    setIdle: (i) => x.tm_set_idle(i ? 1 : 0),
    tick: (dt) => x.tm_tick(dt),
    value: (id) => x.tm_value(id),
  };
}

// Same scripted run on both engines; every probed value must agree.
function agrees(a: TimelineEngine, b: TimelineEngine): boolean {
  for (const e of [a, b]) {
    e.init(30, 1_700_000_000, 8 * 3600);
    e.setIdle(true);
    e.setDirection(-1);
    e.setSpeed(4);
    e.setPlaying(true);
    for (let i = 0; i < 40; i++) e.tick(1 / 60);
    e.setDirection(1);
    for (let i = 0; i < 25; i++) e.tick(1 / 30);
  }
  const probe = [V.position, V.steps, V.ring0, V.ring0 + 3, V.gear0, V.gear0 + 5, V.hourHand, V.minuteHand, V.secondHand, V.momentEpoch];
  return probe.every((id) => Math.abs(a.value(id) - b.value(id)) < 1e-6);
}

export interface LoadedEngine {
  engine: TimelineEngine;
  kind: "wasm" | "js";
  /** Why WASM was not used (shown to the operator); undefined when it was. */
  note?: string;
}

export async function loadEngine(): Promise<LoadedEngine> {
  const js = createJsEngine();
  try {
    if (typeof WebAssembly === "undefined") throw new Error("WebAssembly дэмжигдэхгүй");
    const res = await fetch(WASM_URL, { cache: "force-cache" });
    if (!res.ok) throw new Error(`timeline_engine.wasm олдсонгүй (${res.status})`);
    const compiled = await WebAssembly.compile(await res.arrayBuffer());

    // A standalone module may import tiny runtime hooks (e.g. memory growth
    // notifications); none are needed by this engine, so stub them as no-ops.
    const imports: WebAssembly.Imports = {};
    for (const imp of WebAssembly.Module.imports(compiled)) {
      if (imp.kind !== "function") throw new Error(`Дэмжигдээгүй WASM import: ${imp.module}.${imp.name}`);
      (imports[imp.module] ??= {})[imp.name] = () => 0;
    }
    const instance = await WebAssembly.instantiate(compiled, imports);
    const x = instance.exports as unknown as WasmExports;
    x._initialize?.();
    if (typeof x.tm_init !== "function" || typeof x.tm_value !== "function") throw new Error("WASM экспорт дутуу");

    const wasm = wrapWasm(x);
    if (!agrees(wasm, js)) throw new Error("WASM болон JS тооцоолол зөрсөн");
    return { engine: wasm, kind: "wasm" };
  } catch (e) {
    return { engine: js, kind: "js", note: e instanceof Error ? e.message : "WASM ачаалж чадсангүй" };
  }
}
