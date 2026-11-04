"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { GEAR_COUNT, V, type TimelineEngine } from "./engine";
import { ChamberEnvironment } from "./ChamberEnvironment";
import { ArmorRing, Channel, Strut } from "./reactorParts";
import { makeGearGeometry, makeHandGeometry, makeRingGeometry, makeSectorGeometry, useBrushedSteel, useDialTexture, useLabelTexture } from "./sceneKit";

// The temporal reactor. The silhouette is a massive circular machine, not a
// clock in a frame: a segmented-armour outer ring, a thick machined ring, a
// planetary gear belt, a toothed sun ring and a recessed cavity holding the
// clock, all stacked in depth on a heavy circular pedestal with hydraulic
// struts. Every motion is read from the timeline engine (WASM or JS): ring
// angles drive the rings, gear angles drive the planets and the pulse phase of
// the amber channels, so History / Simulation and the speed buttons visibly
// speed up, slow down and reverse the machine. React never re-renders for
// animation.

export interface MachineReadout {
  moment: number; // epoch seconds of the shown moment
  position: number;
  playing: boolean;
}

export interface MachineApi {
  zoomBy: (factor: number) => void;
  reset: () => void;
}

const AMBER = new THREE.Color("#ff9d22");
const CY = 0.55; // reactor centre height
const R_HOUSING = 3.5;
const PLANETS = 8;
const PLANET_R = 2.0;
const ARMOR_SECTORS = 18;

function Steel({ map, tone = "#8d949e", rough = 0.42, bump = 0.4, env = 1.3 }: { map: THREE.Texture; tone?: string; rough?: number; bump?: number; env?: number }) {
  return <meshStandardMaterial color={tone} metalness={0.92} roughness={rough} roughnessMap={map} bumpMap={map} bumpScale={bump} envMapIntensity={env} />;
}

type Phases = MutableRefObject<{ a: number; b: number; c: number; base: number }>;

function Machine({ engine, reduced, onReadout, phases, busy }: { engine: TimelineEngine; reduced: boolean; onReadout?: (r: MachineReadout) => void; phases: Phases; busy: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const steel = useBrushedSteel();
  const dial = useDialTexture();
  const plate = useLabelTexture("TIME MACHINE");

  const armor = useRef<THREE.Group>(null);
  const ringB = useRef<THREE.Group>(null);
  const carrier = useRef<THREE.Group>(null);
  const sun = useRef<THREE.Group>(null);
  const bezel = useRef<THREE.Group>(null);
  const planetMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const hourHand = useRef<THREE.Group>(null);
  const minuteHand = useRef<THREE.Group>(null);
  const secondHand = useRef<THREE.Group>(null);
  const ringBMat = useRef<THREE.MeshStandardMaterial>(null);
  const hover = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const glow = useRef(0);
  const settle = useRef(0);
  const lastReport = useRef(0);

  const geos = useMemo(() => {
    const step = (Math.PI * 2) / ARMOR_SECTORS;
    return {
      armorOuter: makeSectorGeometry(2.86, 3.42, step * 0.86, 1.1, 0.05),
      armorInner: makeSectorGeometry(2.86, 3.42, step * 0.86, 0.7, 0.045),
      ringB: makeRingGeometry(2.78, 2.3, 0.95, 0.05),
      band: makeRingGeometry(3.56, 3.44, 0.5, 0.02),
      planet: makeGearGeometry(18, 0.3, 0.255, 0.22, 0.085),
      sun: makeGearGeometry(64, 1.73, 1.66, 0.3, 1.5),
      bezel: makeRingGeometry(1.5, 1.3, 0.34, 0.03),
      belt: makeRingGeometry(2.32, 1.48, 0.1, 0.01),
      hour: makeHandGeometry(0.66, 0.065, 0.032, 0.2),
      minute: makeHandGeometry(1.02, 0.048, 0.022, 0.24),
      second: makeHandGeometry(1.12, 0.015, 0.009, 0.32),
    };
  }, []);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);

  // Instanced detail: bolts, bearing rollers, pedestal slots.
  const ringBolts = useRef<THREE.InstancedMesh>(null);
  const rollers = useRef<THREE.InstancedMesh>(null);
  const baseBolts = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    const around = (m: THREE.InstancedMesh | null, count: number, radius: number, z: number, rx: number) => {
      if (!m) return;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        o.position.set(Math.cos(a) * radius, Math.sin(a) * radius, z);
        o.rotation.set(rx, 0, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    };
    around(ringBolts.current, 24, 2.66, 0.5, Math.PI / 2);
    around(rollers.current, 36, 2.3, 0.2, Math.PI / 2);
    if (baseBolts.current) {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        o.position.set(Math.sin(a) * 4.35, -3.47, Math.cos(a) * 4.35);
        o.rotation.set(0, 0, 0);
        o.updateMatrix();
        baseBolts.current.setMatrixAt(i, o.matrix);
      }
      baseBolts.current.instanceMatrix.needsUpdate = true;
    }
  }, []);

  useFrame((_, delta) => {
    engine.tick(delta);
    const r0 = engine.value(V.ring0);
    const r1 = engine.value(V.ring0 + 1);
    const r2 = engine.value(V.ring0 + 2);
    const r3 = engine.value(V.ring0 + 3);
    // independent rotations: armour and ring B counter-rotate, the carrier and
    // sun ring turn at their own rates, the bezel follows the inner ring
    if (armor.current) armor.current.rotation.z = r0;
    if (ringB.current) ringB.current.rotation.z = r1;
    if (carrier.current) carrier.current.rotation.z = r2;
    if (sun.current) sun.current.rotation.z = r3;
    if (bezel.current) bezel.current.rotation.z = -r3 * 0.6;
    for (let i = 0; i < PLANETS; i++) {
      const m = planetMeshes.current[i];
      if (m) m.rotation.z = engine.value(V.gear0 + (i % GEAR_COUNT)) * (i % 2 ? -1.4 : 1.4);
    }
    phases.current.a = r0 * 2.2;
    phases.current.b = -r1 * 1.8;
    phases.current.c = r3 * 2.6;
    phases.current.base = r2 * 1.5;
    if (hourHand.current) hourHand.current.rotation.z = -engine.value(V.hourHand);
    if (minuteHand.current) minuteHand.current.rotation.z = -engine.value(V.minuteHand);
    if (secondHand.current) secondHand.current.rotation.z = -engine.value(V.secondHand);

    const k = 1 - Math.exp(-delta * 8);
    // Hover and backend work (reconstruction / snapshot) both light the machine.
    const target = hover.current || busyRef.current ? 0.55 : 0;
    glow.current += (target - glow.current) * k;
    if (ringBMat.current) ringBMat.current.emissiveIntensity = glow.current;

    const playing = engine.value(V.playing) === 1;
    if (playing || Math.abs(target - glow.current) > 0.01) settle.current = 1.5;
    else settle.current -= delta;
    if (reduced && settle.current > 0) invalidate();

    if (onReadout) {
      lastReport.current += delta;
      if (lastReport.current >= 0.12) {
        lastReport.current = 0;
        onReadout({ moment: engine.value(V.momentEpoch), position: engine.value(V.position), playing });
      }
    }
  });

  const dark = <meshStandardMaterial color="#14171b" metalness={0.6} roughness={0.55} />;
  const armorMat = (tone: string) => <Steel map={steel} tone={tone} rough={0.4} bump={0.5} />;

  return (
    <group>
      {/* ================= heavy circular pedestal ================= */}
      <mesh position={[0, -3.75, 0]}>
        <cylinderGeometry args={[4.55, 4.7, 0.5, 96]} />
        <Steel map={steel} tone="#3f454d" rough={0.55} env={0.6} />
      </mesh>
      <mesh position={[0, -3.3, 0]}>
        <cylinderGeometry args={[3.95, 4.15, 0.45, 96]} />
        <Steel map={steel} tone="#515862" rough={0.5} env={0.7} />
      </mesh>
      <mesh position={[0, -2.95, 0]}>
        <cylinderGeometry args={[3.55, 3.75, 0.35, 96]} />
        <Steel map={steel} tone="#5f666f" rough={0.45} env={0.8} />
      </mesh>
      {/* amber slots running around the middle tier */}
      <group position={[0, -3.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <Channel count={48} radius={4.1} size={[0.26, 0.07, 0.06]} getPhase={() => phases.current.base} base={0.35} boost={1.9} sharp={5} />
      </group>
      <instancedMesh ref={baseBolts} args={[undefined, undefined, 28]}>
        <cylinderGeometry args={[0.1, 0.1, 0.09, 6]} />
        <meshStandardMaterial color="#b4bbc4" metalness={0.95} roughness={0.28} />
      </instancedMesh>
      <mesh position={[0, -3.3, 4.12]}>
        <boxGeometry args={[2.7, 0.52, 0.1]} />
        <meshStandardMaterial map={plate} metalness={0.5} roughness={0.5} emissive="#ffffff" emissiveMap={plate} emissiveIntensity={0.35} />
      </mesh>

      {/* ================= support mechanisms ================= */}
      {[-1, 1].map((s) => (
        <group key={s}>
          {/* armoured cradle wedges holding the reactor */}
          <RoundedBox args={[1.5, 2.3, 2.2]} radius={0.12} smoothness={3} position={[s * 3.05, -1.95, 0]} rotation={[0, 0, -s * 0.62]}>
            <Steel map={steel} tone="#59606a" rough={0.45} />
          </RoundedBox>
          <RoundedBox args={[0.9, 0.5, 2.5]} radius={0.08} smoothness={2} position={[s * 3.0, -2.85, 0]}>
            <Steel map={steel} tone="#7b828d" />
          </RoundedBox>
          {/* hydraulic struts, front and back */}
          {[1.25, -1.1].map((z) => (
            <Strut key={z} from={[s * 4.1, -2.75, z]} to={[s * 3.62, 0.3, z * 0.7]} radius={0.22} material={<Steel map={steel} tone="#6c737d" />} />
          ))}
          {/* axle stub and nut on each side of the housing */}
          <mesh position={[s * 3.72, CY, -0.7]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.32, 0.32, 0.5, 6]} />
            <meshStandardMaterial color="#9aa1ab" metalness={0.95} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* ================= the reactor (axis = Z) ================= */}
      <group position={[0, CY, 0]}>
        {/* rear housing with machined ridges */}
        <mesh position={[0, 0, -1.3]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[R_HOUSING, R_HOUSING, 1.4, 96]} />
          <Steel map={steel} tone="#4f565f" rough={0.5} />
        </mesh>
        {[-1.85, -1.3, -0.75].map((z) => (
          <mesh key={z} position={[0, 0, z]}>
            <torusGeometry args={[R_HOUSING + 0.02, 0.1, 10, 128]} />
            <Steel map={steel} tone="#7b828d" />
          </mesh>
        ))}
        {/* recessed back plate behind the armour: amber channel shows in the gaps */}
        <mesh position={[0, 0, -0.4]}>
          <ringGeometry args={[2.7, 3.46, 96]} />
          {dark}
        </mesh>
        <group position={[0, 0, -0.36]}>
          <Channel count={108} radius={3.14} size={[0.2, 0.2, 0.05]} getPhase={() => phases.current.a} base={0.4} boost={2.4} sharp={9} />
        </group>

        {/* outer reactor ring: segmented armour, rotating */}
        <group ref={armor}>
          <ArmorRing geometry={geos.armorOuter} count={ARMOR_SECTORS} material={armorMat("#58606a")} />
          <group position={[0, 0, 0.45]}>
            <ArmorRing geometry={geos.armorInner} count={ARMOR_SECTORS} material={armorMat("#7a818c")} />
          </group>
          <mesh geometry={geos.band}>
            <Steel map={steel} tone="#8a919b" rough={0.34} />
          </mesh>
        </group>

        {/* thick machined ring B, counter-rotating, with an amber channel and bolts */}
        <group ref={ringB} position={[0, 0, -0.17]}>
          <mesh
            geometry={geos.ringB}
            onPointerOver={(e) => {
              e.stopPropagation();
              hover.current = true;
              gl.domElement.style.cursor = "pointer";
              invalidate();
            }}
            onPointerOut={() => {
              hover.current = false;
              gl.domElement.style.cursor = "";
              invalidate();
            }}
          >
            <meshStandardMaterial
              ref={ringBMat}
              color="#848b96"
              metalness={0.92}
              roughness={0.36}
              roughnessMap={steel}
              bumpMap={steel}
              bumpScale={0.5}
              emissive={AMBER}
              emissiveIntensity={0}
              envMapIntensity={1.3}
            />
          </mesh>
          <group position={[0, 0, 0.485]}>
            <Channel count={96} radius={2.54} size={[0.2, 0.07, 0.03]} getPhase={() => phases.current.b} base={0.4} boost={2.3} sharp={8} />
          </group>
          <instancedMesh ref={ringBolts} args={[undefined, undefined, 24]}>
            <cylinderGeometry args={[0.07, 0.07, 0.06, 6]} />
            <meshStandardMaterial color="#c3c9d1" metalness={0.95} roughness={0.28} />
          </instancedMesh>
        </group>

        {/* planetary gear belt: base plate, bearings and eight counter-rotating gears */}
        <mesh geometry={geos.belt} position={[0, 0, -0.3]}>
          <Steel map={steel} tone="#3b4048" rough={0.55} />
        </mesh>
        <group ref={carrier} position={[0, 0, -0.12]}>
          <instancedMesh ref={rollers} args={[undefined, undefined, 36]}>
            <cylinderGeometry args={[0.04, 0.04, 0.2, 10]} />
            <meshStandardMaterial color="#d0d5dc" metalness={0.98} roughness={0.2} />
          </instancedMesh>
          {Array.from({ length: PLANETS }, (_, i) => {
            const a = (i / PLANETS) * Math.PI * 2;
            return (
              <group key={i} position={[Math.cos(a) * PLANET_R, Math.sin(a) * PLANET_R, 0.1]}>
                <mesh ref={(m) => void (planetMeshes.current[i] = m)} geometry={geos.planet}>
                  <Steel map={steel} tone={i % 2 ? "#939aa4" : "#a8afb9"} rough={0.34} />
                </mesh>
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.1]}>
                  <cylinderGeometry args={[0.085, 0.085, 0.1, 14]} />
                  <meshStandardMaterial color="#d0d5dc" metalness={0.98} roughness={0.2} />
                </mesh>
              </group>
            );
          })}
        </group>
        <group ref={sun} position={[0, 0, -0.05]}>
          <mesh geometry={geos.sun}>
            <Steel map={steel} tone="#9aa1ab" rough={0.34} />
          </mesh>
        </group>

        {/* clock bezel: thick ring with an amber inlay, and the recessed cavity */}
        <group ref={bezel} position={[0, 0, 0.12]}>
          <mesh geometry={geos.bezel}>
            <Steel map={steel} tone="#6c737d" rough={0.38} />
          </mesh>
          <group position={[0, 0, 0.18]}>
            <Channel count={72} radius={1.4} size={[0.1, 0.045, 0.02]} getPhase={() => phases.current.c} base={0.45} boost={2.3} sharp={6} />
          </group>
        </group>
        <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.3, 1.3, 0.8, 72, 1, true]} />
          <meshStandardMaterial color="#202429" metalness={0.8} roughness={0.5} side={THREE.BackSide} />
        </mesh>
        <mesh position={[0, 0, -0.5]}>
          <circleGeometry args={[1.3, 72]} />
          {dark}
        </mesh>
        <mesh position={[0, 0, -0.4]}>
          <circleGeometry args={[1.22, 96]} />
          <meshStandardMaterial map={dial} metalness={0.35} roughness={0.55} />
        </mesh>
        <group ref={hourHand} position={[0, 0, -0.36]}>
          <mesh geometry={geos.hour}>
            <meshStandardMaterial color="#e4e8ed" metalness={0.9} roughness={0.28} />
          </mesh>
        </group>
        <group ref={minuteHand} position={[0, 0, -0.32]}>
          <mesh geometry={geos.minute}>
            <meshStandardMaterial color="#f0f3f6" metalness={0.9} roughness={0.25} />
          </mesh>
        </group>
        <group ref={secondHand} position={[0, 0, -0.28]}>
          <mesh geometry={geos.second}>
            <meshStandardMaterial color="#3a2a0e" emissive={AMBER} emissiveIntensity={0.9} toneMapped={false} />
          </mesh>
        </group>
        <mesh position={[0, 0, -0.26]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 0.1, 24]} />
          <meshStandardMaterial color="#c3c9d1" metalness={0.97} roughness={0.22} />
        </mesh>
        {/* warm light from inside the cavity */}
        <pointLight position={[0, 0, 0.2]} intensity={5} color="#ff9d2e" distance={5} decay={2} />
      </group>
    </group>
  );
}

// World-space box that must stay fully in view: pedestal, struts, plaque and
// the reactor's top (the chamber behind it is allowed to run off-screen).
const FIT_HALF_X = 4.75;
const FIT_Y: [number, number] = [-4.05, 4.15];
const FIT_Z: [number, number] = [-1.6, 4.3];
const DEFAULT_DIR = new THREE.Vector3(4.5, 1.8, 17.1).normalize();
const SIDE_RESERVE_PX = 190; // History / Simulation levers sit over the sides (capped on narrow panels)

function Rig({ apiRef, reduced }: { apiRef: MutableRefObject<MachineApi | null>; reduced: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const fit = useRef(17);
  const zoom = useRef(1);
  const target = useMemo(() => new THREE.Vector3(0, 0.05, 0), []);

  // Smallest camera distance (along the default view direction) at which every
  // corner of the fit box projects inside the usable part of the viewport.
  // Re-run whenever the stage is resized, so any panel shape shows the whole machine.
  const computeFit = () => {
    const cam = new THREE.PerspectiveCamera(camera.fov, size.width / Math.max(1, size.height), 0.5, 200);
    const reserve = Math.min(SIDE_RESERVE_PX, size.width * 0.22);
    const usableX = Math.min(0.97, Math.max(0.5, (size.width - reserve) / size.width));
    const limY = 0.96;
    const corners: THREE.Vector3[] = [];
    for (const x of [-FIT_HALF_X, FIT_HALF_X]) for (const y of FIT_Y) for (const z of FIT_Z) corners.push(new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    const fits = (d: number) => {
      cam.position.copy(target).addScaledVector(DEFAULT_DIR, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      return corners.every((c) => {
        v.copy(c).project(cam);
        return Math.abs(v.x) <= usableX && Math.abs(v.y) <= limY && v.z < 1;
      });
    };
    let lo = 8;
    let hi = 60;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  const place = () => {
    const c = controls.current;
    const off = camera.position.clone().sub(target);
    if (off.lengthSq() < 1e-6) off.copy(DEFAULT_DIR);
    off.setLength(fit.current * zoom.current);
    camera.position.copy(target).add(off);
    camera.lookAt(target);
    if (c) {
      c.target.copy(target);
      c.minDistance = fit.current * 0.5;
      c.maxDistance = fit.current * 1.5;
      c.update();
    }
    invalidate();
  };

  useLayoutEffect(() => {
    fit.current = computeFit();
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  useEffect(() => {
    apiRef.current = {
      zoomBy: (f) => {
        zoom.current = THREE.MathUtils.clamp(zoom.current * f, 0.5, 1.5);
        place();
      },
      reset: () => {
        zoom.current = 1;
        camera.position.copy(target).addScaledVector(DEFAULT_DIR, fit.current);
        place();
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
      target={[0, 0.05, 0]}
      enablePan={false}
      enableZoom={false}
      enableDamping={!reduced}
      dampingFactor={0.07}
      rotateSpeed={0.5}
      minAzimuthAngle={-0.8}
      maxAzimuthAngle={1.05}
      minPolarAngle={0.8}
      maxPolarAngle={1.75}
    />
  );
}

// Slow, small sway of the whole instrument; off for reduced motion.
function Sway({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (reduced || !g.current) return;
    g.current.rotation.y = Math.sin(clock.elapsedTime * 0.18) * 0.04;
  });
  return <group ref={g}>{children}</group>;
}

export interface TimeMachineSceneProps {
  engine: TimelineEngine;
  frameloop: "always" | "demand" | "never";
  reduced: boolean;
  apiRef: MutableRefObject<MachineApi | null>;
  onReadout?: (r: MachineReadout) => void;
  /** A backend operation is running; the machine glows while it does. */
  busy?: boolean;
}

export default function TimeMachineScene({ engine, frameloop, reduced, apiRef, onReadout, busy = false }: TimeMachineSceneProps) {
  const phases = useRef({ a: 0, b: 0, c: 0, base: 0 });
  return (
    <Canvas
      className="tm-canvas"
      frameloop={frameloop}
      dpr={[1, 1.5]}
      camera={{ fov: 32, position: [4.5, 1.8, 17.1], near: 0.5, far: 140 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      aria-hidden
    >
      <color attach="background" args={["#0e1013"]} />
      <fog attach="fog" args={["#14171b", 30, 78]} />
      {/* key (warm, upper left), fill (cool, right), rim (behind), floor bounce */}
      <ambientLight intensity={0.7} />
      <hemisphereLight args={["#d5dde8", "#23262c", 0.65]} />
      <directionalLight position={[-6, 8, 10]} intensity={3.0} color="#ffe8c8" />
      <directionalLight position={[8, 3, 7]} intensity={1.2} color="#b9cde0" />
      <directionalLight position={[0, 6, -10]} intensity={2.2} color="#ffd9a0" />
      <pointLight position={[0, 1, 8]} intensity={5} color="#ffb766" distance={14} decay={2} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 8, 6]} scale={[20, 3, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.6} position={[-10, 2, 1]} scale={[2, 11, 1]} color="#ffb766" rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.3} position={[10, 2, 1]} scale={[2, 11, 1]} color="#9fb6c8" rotation-y={-Math.PI / 2} />
        <Lightformer form="rect" intensity={1.0} position={[0, 1, -9]} scale={[16, 3, 1]} color="#ffe0b0" />
      </Environment>
      <ChamberEnvironment
        floorY={-4.02}
        wallRadius={26}
        platformRadius={7.4}
        shadowRadius={6.4}
        columnAngles={[-1.3, -0.9, -0.52, 0.52, 0.9, 1.3]}
        getPhase={() => phases.current.base}
      />
      <Sway reduced={reduced}>
        <Machine engine={engine} reduced={reduced} onReadout={onReadout} phases={phases} busy={busy} />
      </Sway>
      <Rig apiRef={apiRef} reduced={reduced} />
    </Canvas>
  );
}
