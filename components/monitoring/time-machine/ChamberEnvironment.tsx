"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Channel } from "./reactorParts";

// A lightweight industrial chamber built from real geometry (so camera motion
// gives genuine parallax): a curved wall of structural panels, columns with
// amber light strips, a ring beam, a glossy floor with a circular platform and
// recessed amber lighting, soft light shafts and contact shadows. Everything
// repeated is instanced; nothing here casts dynamic shadows or renders a
// second pass. The floor's "reflection" is an approximation: the amber
// elements are mirrored under a slightly transparent floor.

const AMBER = new THREE.Color("#ff9d22");

export interface ChamberProps {
  /** World y of the floor. */
  floorY: number;
  /** Wall radius; everything else scales from it. */
  wallRadius: number;
  /** Radius of the circular platform around the machine. */
  platformRadius: number;
  /** Radius of the contact-shadow blob under the machine. */
  shadowRadius: number;
  /** Column angles (radians, 0 = straight behind the machine). */
  columnAngles: number[];
  /** Angular span of the wall panels. */
  wallSpan?: number;
  /** Brightness multiplier of the amber accents (the vault dims it). */
  level?: number;
  /** Pulse phase for the recessed platform channel. */
  getPhase?: () => number;
}

function useRadialShadow() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, "rgba(0,0,0,0.85)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.5)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

// Vertical fade for the light shafts.
function useBeamAlpha() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.6, "#7a7a7a");
    grad.addColorStop(1, "#000000");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

type Build = (i: number, o: THREE.Object3D, c: THREE.Color) => void;

// One instanced mesh whose matrices (and optional colours) are written once.
function Inst({ count, build, colored, children }: { count: number; build: Build; colored?: boolean; children: React.ReactNode }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      c.set("#ffffff");
      build(i, o, c);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (colored) m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [count, build, colored]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false} matrixAutoUpdate={false}>
      {children}
    </instancedMesh>
  );
}

// Deterministic pseudo-random in [0,1).
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function ChamberEnvironment({ floorY, wallRadius: Rw, platformRadius: Rp, shadowRadius, columnAngles, wallSpan = 2.0, level = 1, getPhase }: ChamberProps) {
  const shadow = useRadialShadow();
  const beamAlpha = useBeamAlpha();
  const Rc = Rw * 0.82;
  const Hc = Rw * 0.62;
  const panelCols = 26;
  const panelRows = 3;
  const rowH = Rw * 0.36;

  // ---- wall panels (instanced, tonal variation, slight depth jitter) ----
  const wall = useMemo<Build>(
    () => (i, o, c) => {
      const row = Math.floor(i / panelCols);
      const col = i % panelCols;
      const a = -wallSpan + ((col + 0.5) / panelCols) * wallSpan * 2;
      const r = Rw + (hash(i) - 0.5) * 1.1;
      const w = ((wallSpan * 2) / panelCols) * Rw * 0.97;
      o.position.set(Math.sin(a) * r, floorY + rowH * (row + 0.5), -Math.cos(a) * r);
      o.rotation.y = -a;
      o.scale.set(w, rowH * 0.97, 0.7);
      const t = 0.55 + hash(i * 3.1) * 0.35;
      c.setRGB(0.022 * t, 0.026 * t, 0.032 * t);
    },
    [Rw, floorY, rowH, wallSpan]
  );

  // ---- columns: shaft, base and cap collars ----
  const shaft = useMemo<Build>(
    () => (i, o) => {
      const a = columnAngles[i];
      o.position.set(Math.sin(a) * Rc, floorY + Hc / 2, -Math.cos(a) * Rc);
      o.rotation.y = -a;
      o.scale.set(Rw * 0.075, Hc, Rw * 0.075);
    },
    [columnAngles, Rc, Hc, floorY, Rw]
  );
  const collars = useMemo<Build>(
    () => (i, o) => {
      const a = columnAngles[Math.floor(i / 2)];
      const top = i % 2 === 1;
      o.position.set(Math.sin(a) * Rc, floorY + (top ? Hc - Rw * 0.03 : Rw * 0.03), -Math.cos(a) * Rc);
      o.rotation.y = -a;
      o.scale.set(Rw * 0.105, Rw * 0.06, Rw * 0.105);
    },
    [columnAngles, Rc, Hc, floorY, Rw]
  );
  // ---- ring beam between neighbouring columns ----
  const beams = useMemo<Build>(
    () => (i, o) => {
      const a0 = columnAngles[i];
      const a1 = columnAngles[i + 1];
      const am = (a0 + a1) / 2;
      const len = 2 * Rc * Math.sin(Math.abs(a1 - a0) / 2);
      const r = Rc * Math.cos(Math.abs(a1 - a0) / 2);
      o.position.set(Math.sin(am) * r, floorY + Hc - Rw * 0.05, -Math.cos(am) * r);
      o.rotation.y = -am;
      o.scale.set(len, Rw * 0.045, Rw * 0.045);
    },
    [columnAngles, Rc, Hc, floorY, Rw]
  );

  const amber = (m: number) => AMBER.clone().multiplyScalar(m);
  const stripBuild = useMemo<Build>(
    () => (i, o) => {
      const a = columnAngles[i];
      const r = Rc - Rw * 0.0405;
      o.position.set(Math.sin(a) * r, floorY + Hc * 0.5, -Math.cos(a) * r);
      o.rotation.y = -a;
      o.scale.set(Rw * 0.009, Hc * 0.72, Rw * 0.004);
    },
    [columnAngles, Rc, Hc, floorY, Rw]
  );
  const baseStrips = useMemo<Build>(
    () => (i, o) => {
      const a0 = columnAngles[i];
      const a1 = columnAngles[i + 1];
      const am = (a0 + a1) / 2;
      const len = 2 * Rc * Math.sin(Math.abs(a1 - a0) / 2) * 0.8;
      const r = Rw - 0.5;
      o.position.set(Math.sin(am) * r, floorY + 0.35, -Math.cos(am) * r);
      o.rotation.y = -am;
      o.scale.set(len, 0.14, 0.14);
    },
    [columnAngles, Rc, floorY, Rw]
  );
  const slants = useMemo<Build>(
    () => (i, o) => {
      const a = -wallSpan * 0.85 + (i / 9) * wallSpan * 1.7;
      o.position.set(Math.sin(a) * (Rw - 0.9), floorY + Hc * 0.8 + (i % 2) * 1.2, -Math.cos(a) * (Rw - 0.9));
      o.rotation.set(0, -a, (i % 2 ? 1 : -1) * 0.5);
      o.scale.set(Rw * 0.1, 0.2, 0.16);
    },
    [wallSpan, Rw, Hc, floorY]
  );

  const nCols = columnAngles.length;
  const nBeams = Math.max(0, nCols - 1);

  // Amber accents, rendered twice: real and (dimmer) mirrored under the floor.
  const AmberSet = ({ k, mirrored }: { k: number; mirrored?: boolean }) => (
    <group position={[0, mirrored ? floorY * 2 : 0, 0]} scale={[1, mirrored ? -1 : 1, 1]}>
      <Inst count={nCols} build={stripBuild}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={amber(k * 1.6)} toneMapped={false} side={mirrored ? THREE.DoubleSide : THREE.FrontSide} />
      </Inst>
      <Inst count={nBeams} build={baseStrips}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={amber(k * 0.9)} toneMapped={false} side={mirrored ? THREE.DoubleSide : THREE.FrontSide} />
      </Inst>
      {!mirrored && (
        <Inst count={10} build={slants}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={amber(k * 1.3)} toneMapped={false} />
        </Inst>
      )}
      {/* platform rings */}
      {[Rp - 0.55, Rp + 0.5, Rp + 2.2].map((r, i) => (
        <mesh key={i} position={[0, floorY + 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r - 0.06, r + 0.06, 128]} />
          <meshBasicMaterial color={amber(k * (i === 2 ? 0.55 : 1.2))} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );

  return (
    <group>
      {/* floor: glossy dark metal, slightly transparent so the mirrored accents show */}
      <mesh position={[0, floorY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[Rw * 1.2, 96]} />
        <meshStandardMaterial color="#0a0c0f" metalness={0.55} roughness={0.7} envMapIntensity={0.3} transparent opacity={0.93} />
      </mesh>
      <AmberSet k={level * 0.35} mirrored />
      <AmberSet k={level} />

      {/* circular platform around the machine */}
      <mesh position={[0, floorY + 0.05, 0]}>
        <cylinderGeometry args={[Rp, Rp + 0.15, 0.1, 96]} />
        <meshStandardMaterial color="#14171b" metalness={0.6} roughness={0.6} envMapIntensity={0.3} />
      </mesh>
      <group position={[0, floorY + 0.11, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <Channel count={96} radius={Rp - 0.2} size={[0.3, 0.08, 0.02]} getPhase={getPhase ?? (() => 0)} level={level} base={0.3} boost={1.6} sharp={6} />
      </group>
      {/* contact shadow */}
      <mesh position={[0, floorY + 0.03, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[shadowRadius * 2.3, shadowRadius * 2.3]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} toneMapped={false} />
      </mesh>

      {/* walls, columns, beams */}
      <Inst count={panelCols * panelRows} build={wall} colored>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" metalness={0.3} roughness={0.8} envMapIntensity={0.1} />
      </Inst>
      <Inst count={nCols} build={shaft}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#242930" metalness={0.8} roughness={0.5} envMapIntensity={0.3} />
      </Inst>
      <Inst count={nCols * 2} build={collars}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#323840" metalness={0.85} roughness={0.42} envMapIntensity={0.4} />
      </Inst>
      <Inst count={nBeams} build={beams}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#1f2329" metalness={0.8} roughness={0.55} envMapIntensity={0.3} />
      </Inst>

      {/* soft light shafts from the ceiling (additive, no shadows) */}
      {[-0.28, 0, 0.28].map((x, i) => (
        <mesh key={i} position={[x * Rw, floorY + Hc * 0.55, -Rw * 0.22]} rotation={[0, 0, x * 0.35]}>
          <cylinderGeometry args={[Rw * 0.012, Rw * 0.16, Hc * 1.1, 28, 1, true]} />
          <meshBasicMaterial color="#e9eef5" alphaMap={beamAlpha} transparent opacity={0.03} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}

      {/* overhead soft spots + low amber accents (no shadow maps) */}
      <spotLight position={[-Rw * 0.3, floorY + Hc * 1.1, Rw * 0.2]} angle={0.55} penumbra={1} intensity={170} decay={2} color="#f4f7fb" />
      <spotLight position={[Rw * 0.3, floorY + Hc * 1.1, Rw * 0.2]} angle={0.55} penumbra={1} intensity={110} decay={2} color="#ffe9cc" />
      <pointLight position={[-Rp, floorY + 1.2, Rp * 0.5]} intensity={3 * level} color="#ff9d2e" distance={Rp * 2.5} decay={2} />
      <pointLight position={[Rp, floorY + 1.2, Rp * 0.5]} intensity={3 * level} color="#ff9d2e" distance={Rp * 2.5} decay={2} />
    </group>
  );
}
