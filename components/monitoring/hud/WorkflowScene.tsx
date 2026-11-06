"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Html, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { AnimatedNumber } from "./AnimatedNumber";
import type { SceneApi, StageView } from "./stages";

// Real-time WebGL view of the approval pipeline. Platforms follow a snake
// (conveyor) layout: back row left->right, then front row right->left, so the
// order matches STAGES one to one. Animation state lives in refs and is driven
// by useFrame; React re-renders only when the data (stage counts) changes.

const COLS = 4;
const SPACING = 2.95;
const ROW_Z = 1.95;
const HALF = 0.95; // half the platform footprint
const FLOOR_Y = -0.27;
const AMBER = new THREE.Color("#ffa51f");
const GREEN = new THREE.Color("#3fd17a");
const GRAPHITE = new THREE.Color("#8a929c");

function layout(count: number): THREE.Vector3[] {
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const c = row % 2 === 0 ? col : COLS - 1 - col;
    return new THREE.Vector3((c - (COLS - 1) / 2) * SPACING, 0, row === 0 ? -ROW_Z : ROW_Z);
  });
}

const toneColor = (tone: StageView["tone"]) => (tone === "green" ? GREEN : tone === "amber" ? AMBER : GRAPHITE);

// Soft radial blob used as a cheap contact shadow under every platform.
function useBlobTexture() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, "rgba(0,0,0,0.75)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

interface Shared {
  hover: MutableRefObject<number>;
  reduced: boolean;
  blob: THREE.Texture;
}

const BOLTS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

function Platform({
  stage,
  index,
  position,
  selected,
  onSelect,
  shared,
}: {
  stage: StageView;
  index: number;
  position: THREE.Vector3;
  selected: boolean;
  onSelect: (key: string | null) => void;
  shared: Shared;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const lift = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const rim = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const cur = useRef({ y: 0, glow: 0.3 });
  const flash = useRef(0);
  const prevCount = useRef(stage.count);
  const color = toneColor(stage.tone);
  const active = stage.count > 0;

  // A status change flashes the platform once.
  useEffect(() => {
    if (prevCount.current !== stage.count) {
      flash.current = 1;
      prevCount.current = stage.count;
      invalidate();
    }
  }, [stage.count, invalidate]);

  useEffect(() => {
    invalidate();
  }, [selected, invalidate]);

  useFrame(({ clock }, delta) => {
    const hovered = shared.hover.current === index;
    const targetY = (hovered ? 0.2 : 0) + (selected ? 0.16 : 0);
    const baseGlow = active ? 0.9 : 0.3;
    const targetGlow = Math.max(baseGlow + (selected ? 0.9 : 0) + (hovered ? 0.5 : 0), flash.current * 2.4);
    const k = 1 - Math.exp(-delta * 9);
    cur.current.y += (targetY - cur.current.y) * k;
    cur.current.glow += (targetGlow - cur.current.glow) * k;
    flash.current = Math.max(0, flash.current - delta * 1.2);

    // Idle life on stages that hold orders: breathing light + slow spinner.
    const breathe = active && !shared.reduced ? 0.22 * Math.sin(clock.elapsedTime * 2 + index) : 0;
    if (lift.current) lift.current.position.y = cur.current.y;
    if (rim.current) rim.current.emissiveIntensity = cur.current.glow + breathe;
    if (ring.current) ring.current.emissiveIntensity = (cur.current.glow + breathe) * 1.3;
    if (spinner.current && active && !shared.reduced) spinner.current.rotation.y += delta * 0.9;

    const settled =
      Math.abs(targetY - cur.current.y) < 0.002 && Math.abs(targetGlow - cur.current.glow) < 0.01 && flash.current === 0;
    if (!settled) invalidate();
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    shared.hover.current = index;
    gl.domElement.style.cursor = "pointer";
    invalidate();
  };
  const out = () => {
    if (shared.hover.current === index) shared.hover.current = -1;
    gl.domElement.style.cursor = "";
    invalidate();
  };

  const W = HALF * 2;
  return (
    <group position={[position.x, 0, position.z]}>
      {/* contact shadow, stays on the floor while the platform lifts */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.004, 0.08]}>
        <planeGeometry args={[W * 2.05, W * 2.05]} />
        <meshBasicMaterial map={shared.blob} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <group
        ref={lift}
        onPointerOver={over}
        onPointerOut={out}
        onClick={(e) => {
          if (e.delta > 4) return; // a drag, not a click
          e.stopPropagation();
          onSelect(selected ? null : stage.key);
        }}
      >
        {/* plinth */}
        <RoundedBox args={[W + 0.34, 0.14, W + 0.34]} radius={0.05} smoothness={3} position={[0, FLOOR_Y + 0.07, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#20252b" metalness={0.8} roughness={0.5} envMapIntensity={0.8} />
        </RoundedBox>
        {/* body */}
        <RoundedBox args={[W, 0.6, W]} radius={0.09} smoothness={4} position={[0, 0.15, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#444b55" metalness={0.88} roughness={0.34} envMapIntensity={1.15} />
        </RoundedBox>
        {/* emissive rim band: the platform's state light */}
        <mesh position={[0, -0.02, 0]}>
          <boxGeometry args={[W + 0.03, 0.045, W + 0.03]} />
          <meshStandardMaterial ref={rim} color="#15181c" emissive={color} emissiveIntensity={0.3} toneMapped={false} />
        </mesh>
        {/* front vent slats */}
        {[0.06, 0.16, 0.26].map((y) => (
          <mesh key={y} position={[0, y, HALF + 0.004]}>
            <boxGeometry args={[W * 0.55, 0.035, 0.02]} />
            <meshStandardMaterial color="#14171b" metalness={0.6} roughness={0.6} />
          </mesh>
        ))}
        {/* top plate, recessed panel and corner bolts */}
        <RoundedBox args={[W - 0.2, 0.09, W - 0.2]} radius={0.04} smoothness={3} position={[0, 0.5, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#59616c" metalness={0.92} roughness={0.28} envMapIntensity={1.3} />
        </RoundedBox>
        <mesh position={[0, 0.552, 0]}>
          <boxGeometry args={[W - 0.7, 0.015, W - 0.7]} />
          <meshStandardMaterial color="#1b1f24" metalness={0.7} roughness={0.55} />
        </mesh>
        {BOLTS.map(([sx, sz]) => (
          <mesh key={`${sx}${sz}`} position={[sx * (HALF - 0.17), 0.555, sz * (HALF - 0.17)]}>
            <cylinderGeometry args={[0.05, 0.05, 0.035, 10]} />
            <meshStandardMaterial color="#8d95a0" metalness={0.95} roughness={0.25} />
          </mesh>
        ))}
        {/* state ring + spinner on the panel */}
        <mesh position={[0, 0.565, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.47, 48]} />
          <meshStandardMaterial ref={ring} color="#15181c" emissive={color} emissiveIntensity={0.4} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <group ref={spinner} position={[0, 0.58, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.3, 0.018, 8, 32, Math.PI * 1.1]} />
            <meshBasicMaterial color={active ? color : "#3a4048"} toneMapped={false} />
          </mesh>
        </group>
        {stage.returned > 0 && (
          <mesh position={[HALF - 0.12, 0.6, -HALF + 0.12]}>
            <cylinderGeometry args={[0.07, 0.07, 0.12, 16]} />
            <meshStandardMaterial color="#3a0f0c" emissive="#ef4b3f" emissiveIntensity={1.8} toneMapped={false} />
          </mesh>
        )}
        <Html position={[0, 1.15, 0]} center zIndexRange={[40, 10]} style={{ pointerEvents: "none" }}>
          <div className="mh-plabel" data-selected={selected || undefined} data-tone={stage.tone}>
            <span className="mh-plabel-idx">{index + 1}</span>
            <span className="mh-plabel-name">{stage.label}</span>
            <b className="mh-plabel-count">
              <AnimatedNumber value={stage.count} />
            </b>
            {stage.returned > 0 && <i className="mh-plabel-ret">↩ {stage.returned}</i>}
          </div>
        </Html>
      </group>
    </group>
  );
}

const PULSES = 3;

function Flow({ stages, positions, reduced }: { stages: StageView[]; positions: THREE.Vector3[]; reduced: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const core = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Topology comes straight from the stage order: segment i joins stage i -> i+1.
  const segments = useMemo(
    () =>
      positions.slice(0, -1).map((a, i) => {
        const b = positions[i + 1];
        const dir = new THREE.Vector3().subVectors(b, a).normalize();
        const start = a.clone().addScaledVector(dir, HALF + 0.1);
        const end = b.clone().addScaledVector(dir, -(HALF + 0.1));
        return { start, end, len: start.distanceTo(end), angle: Math.atan2(-dir.z, dir.x), mid: start.clone().lerp(end, 0.5) };
      }),
    [positions]
  );

  const writeFrame = (t: number) => {
    const c = core.current;
    const h = halo.current;
    if (!c || !h) return;
    let n = 0;
    segments.forEach((seg, i) => {
      // Upstream station holds orders -> the segment runs at full energy.
      const live = stages[i].count > 0;
      for (let j = 0; j < PULSES; j++) {
        const p = reduced ? (j + 0.5) / PULSES : (t * 0.35 + j / PULSES) % 1;
        const s = (live ? 1 : 0.4) * (0.35 + 0.65 * Math.sin(Math.PI * p));
        dummy.position.set(seg.start.x + (seg.end.x - seg.start.x) * p, 0.2, seg.start.z + (seg.end.z - seg.start.z) * p);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        c.setMatrixAt(n, dummy.matrix);
        dummy.scale.setScalar(s * 3.2);
        dummy.updateMatrix();
        h.setMatrixAt(n, dummy.matrix);
        n++;
      }
    });
    c.instanceMatrix.needsUpdate = true;
    h.instanceMatrix.needsUpdate = true;
  };

  useFrame(({ clock }) => {
    if (!reduced) writeFrame(clock.elapsedTime);
  });

  // Reduced motion: draw the static pulses once per data change.
  useLayoutEffect(() => {
    if (reduced) {
      writeFrame(0);
      invalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, stages, segments]);

  return (
    <>
      {segments.map((seg, i) => {
        const live = stages[i].count > 0;
        return (
          <group key={i} position={[seg.mid.x, 0, seg.mid.z]} rotation={[0, seg.angle, 0]}>
            {/* conveyor bed */}
            <mesh position={[0, FLOOR_Y + 0.035, 0]} receiveShadow>
              <boxGeometry args={[seg.len + 0.2, 0.07, 0.6]} />
              <meshStandardMaterial color="#1b1f24" metalness={0.7} roughness={0.55} />
            </mesh>
            {[-0.27, 0.27].map((z) => (
              <mesh key={z} position={[0, FLOOR_Y + 0.075, z]}>
                <boxGeometry args={[seg.len + 0.2, 0.02, 0.03]} />
                <meshStandardMaterial color="#101316" emissive={AMBER} emissiveIntensity={live ? 0.5 : 0.12} toneMapped={false} />
              </mesh>
            ))}
            {/* energy conduit */}
            <mesh position={[0, 0.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.065, 0.065, seg.len, 14]} />
              <meshStandardMaterial color="#262b31" emissive={AMBER} emissiveIntensity={live ? 0.55 : 0.12} metalness={0.7} roughness={0.4} toneMapped={false} />
            </mesh>
            {[-1, 1].map((e) => (
              <mesh key={e} position={[(e * seg.len) / 2, 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.1, 0.1, 0.07, 14]} />
                <meshStandardMaterial color="#59616c" metalness={0.9} roughness={0.3} />
              </mesh>
            ))}
          </group>
        );
      })}
      <instancedMesh ref={core} args={[undefined, undefined, segments.length * PULSES]} frustumCulled={false}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshBasicMaterial color="#ffc266" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={halo} args={[undefined, undefined, segments.length * PULSES]} frustumCulled={false}>
        <sphereGeometry args={[0.08, 10, 10]} />
        <meshBasicMaterial color="#ff9a1f" transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

const FOCUS_ZOOM = 0.66;

function Rig({
  apiRef,
  reduced,
  focus,
}: {
  apiRef: MutableRefObject<SceneApi | null>;
  reduced: boolean;
  focus: THREE.Vector3 | null;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const fit = useRef(18);
  const zoom = useRef(1);
  const moving = useRef(false);
  const goalTarget = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const goalLen = () => fit.current * THREE.MathUtils.clamp(zoom.current * (focus ? FOCUS_ZOOM : 1), 0.4, 1.3);

  const applyLimits = () => {
    const c = controls.current;
    if (!c) return;
    c.minDistance = fit.current * 0.4;
    c.maxDistance = fit.current * 1.3;
  };

  // Fit the whole snake to the panel at any aspect (platform footprint about
  // 10.6 x 5.9 world units, plus labels above).
  useLayoutEffect(() => {
    const vFov = (camera.fov * Math.PI) / 180;
    const aspect = size.width / Math.max(1, size.height);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // The stage tags are fixed-pixel HTML, so on a narrow canvas they stick out past the platform:
    // leave ~44px of room per side there. Wide canvases keep the original fit.
    const labelPad = size.width < 720 ? 1 / (1 - 88 / Math.max(size.width, 140)) : 1;
    const byWidth = (11.4 * labelPad) / 2 / Math.tan(hFov / 2);
    const byHeight = 7.2 / 2 / Math.tan(vFov / 2);
    fit.current = Math.max(byWidth, byHeight);
    const c = controls.current;
    const target = c ? c.target : tmp.set(0, 0, 0);
    const offset = camera.position.clone().sub(target);
    if (offset.lengthSq() < 1e-6) offset.set(0, 0.66, 0.75);
    camera.position.copy(target).add(offset.setLength(goalLen()));
    camera.lookAt(target);
    applyLimits();
    c?.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  // New selection or zoom change: glide there instead of jumping.
  useEffect(() => {
    if (focus) goalTarget.set(focus.x * 0.85, 0.3, focus.z * 0.85);
    else goalTarget.set(0, 0, 0);
    if (reduced) {
      const c = controls.current;
      if (c) {
        const offset = camera.position.clone().sub(c.target).setLength(goalLen());
        c.target.copy(goalTarget);
        camera.position.copy(goalTarget).add(offset);
        c.update();
      }
    } else {
      moving.current = true;
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, reduced]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c || !moving.current) return;
    const k = 1 - Math.exp(-delta * 4.5);
    const offset = tmp.copy(camera.position).sub(c.target);
    const len = THREE.MathUtils.lerp(offset.length(), goalLen(), k);
    c.target.lerp(goalTarget, k);
    camera.position.copy(c.target).add(offset.setLength(len));
    c.update();
    if (c.target.distanceTo(goalTarget) < 0.01 && Math.abs(len - goalLen()) < 0.02) moving.current = false;
    invalidate();
  });

  useEffect(() => {
    apiRef.current = {
      zoomBy: (f) => {
        zoom.current = THREE.MathUtils.clamp(zoom.current * f, 0.55, 1.3);
        moving.current = true;
        invalidate();
      },
      reset: () => {
        zoom.current = 1;
        const c = controls.current;
        if (c) camera.position.copy(c.target).add(new THREE.Vector3(0, 0.66, 0.75).setLength(camera.position.distanceTo(c.target)));
        moving.current = true;
        invalidate();
      },
    };
    return () => {
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRef]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableZoom={false}
      enableDamping={!reduced}
      dampingFactor={0.08}
      rotateSpeed={0.55}
      minAzimuthAngle={-0.85}
      maxAzimuthAngle={0.85}
      minPolarAngle={0.5}
      maxPolarAngle={1.25}
    />
  );
}

// Gentle idle sway of the whole pipeline; off for reduced motion.
function IdleSway({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (reduced || !g.current) return;
    const t = clock.elapsedTime;
    g.current.rotation.y = Math.sin(t * 0.22) * 0.035;
    g.current.position.y = Math.sin(t * 0.5) * 0.025;
  });
  return <group ref={g}>{children}</group>;
}

export interface WorkflowSceneProps {
  stages: StageView[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  frameloop: "always" | "demand" | "never";
  reduced: boolean;
  apiRef: MutableRefObject<SceneApi | null>;
}

function Content({ stages, selected, onSelect, reduced, apiRef }: Omit<WorkflowSceneProps, "frameloop">) {
  const positions = useMemo(() => layout(stages.length), [stages.length]);
  const hover = useRef(-1);
  const blob = useBlobTexture();
  const shared: Shared = { hover, reduced, blob };
  const selIndex = stages.findIndex((s) => s.key === selected);
  const focus = selIndex >= 0 ? positions[selIndex] : null;

  return (
    <>
      <ambientLight intensity={0.6} />
      <hemisphereLight args={["#cfd8e3", "#1a1d22", 0.5]} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={2.6}
        color="#ffe9c9"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={34}
        shadow-bias={-0.0004}
      />
      <pointLight position={[-8, 3.5, 5]} intensity={22} color="#ff9a2e" distance={18} decay={2} />
      <pointLight position={[8, 4, -4]} intensity={10} color="#a9c2d8" distance={18} decay={2} />
      {/* procedural reflections, rendered once: no network HDR */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.6} position={[0, 7, 4]} scale={[16, 3, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.4} position={[-9, 2, -1]} scale={[2, 8, 1]} color="#ffb766" rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.0} position={[9, 2, -1]} scale={[2, 8, 1]} color="#9fb6c8" rotation-y={-Math.PI / 2} />
      </Environment>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <planeGeometry args={[60, 40]} />
        <meshStandardMaterial color="#1d2127" metalness={0.45} roughness={0.68} />
      </mesh>
      {/* sparse, dim floor grid */}
      <gridHelper args={[40, 16, "#262b32", "#1c2026"]} position={[0, FLOOR_Y + 0.002, 0]} />

      <IdleSway reduced={reduced}>
        {stages.map((s, i) => (
          <Platform key={s.key} stage={s} index={i} position={positions[i]} selected={selected === s.key} onSelect={onSelect} shared={shared} />
        ))}
        <Flow stages={stages} positions={positions} reduced={reduced} />
      </IdleSway>

      <Rig apiRef={apiRef} reduced={reduced} focus={focus} />
    </>
  );
}

export default function WorkflowScene({ frameloop, onSelect, ...rest }: WorkflowSceneProps) {
  return (
    <Canvas
      className="mh-canvas"
      frameloop={frameloop}
      dpr={[1, 1.5]}
      shadows="percentage"
      camera={{ fov: 30, position: [0, 9, 10.5], near: 0.5, far: 80 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onPointerMissed={() => onSelect(null)}
      aria-hidden
    >
      <color attach="background" args={["#14171b"]} />
      <fog attach="fog" args={["#14171b", 20, 42]} />
      <Content onSelect={onSelect} {...rest} />
    </Canvas>
  );
}
