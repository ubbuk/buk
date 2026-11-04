"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

// Building blocks shared by the Time Machine reactor and the Backup Vault.

const AMBER = new THREE.Color("#ff9d22");

// A ring of glowing segments with light pulses travelling around it. Lies in the
// XY plane (rotate / position the wrapper to orient it). `getPhase` supplies the
// pulse angle each frame; the Time Machine feeds it the engine's ring angles, so
// pulses speed up, slow down and reverse together with the playback controls.
export function Channel({
  count,
  radius,
  size,
  getPhase,
  base = 0.14,
  boost = 1.7,
  sharp = 7,
  level = 1,
  pulses = 2,
}: {
  count: number;
  radius: number;
  size: [number, number, number];
  getPhase: () => number;
  base?: number;
  boost?: number;
  sharp?: number;
  /** Overall brightness multiplier (the vault dims this when not configured). */
  level?: number;
  pulses?: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const color = useMemo(() => new THREE.Color(), []);
  const levelRef = useRef(level);
  levelRef.current = level;

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      o.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      o.rotation.set(0, 0, a);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [count, radius]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const phase = getPhase();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      let w = 0;
      for (let p = 0; p < pulses; p++) w += Math.pow(Math.max(0, Math.cos(a - phase - (p * Math.PI * 2) / pulses)), sharp);
      color.copy(AMBER).multiplyScalar((base + boost * Math.min(1, w)) * levelRef.current);
      m.setColorAt(i, color);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={size} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </instancedMesh>
  );
}

// Instanced armour plates around a circle (one draw call).
export function ArmorRing({
  geometry,
  count,
  material,
}: {
  geometry: THREE.BufferGeometry;
  count: number;
  material: React.ReactNode;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      o.rotation.set(0, 0, (i / count) * Math.PI * 2);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]} frustumCulled={false}>
      {material}
    </instancedMesh>
  );
}

// Hydraulic strut between two points: cylinder body, thinner rod, ball joints.
export function Strut({ from, to, radius = 0.2, material }: { from: [number, number, number]; to: [number, number, number]; radius?: number; material?: React.ReactNode }) {
  const { mid, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const l = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return { mid: a.clone().add(b).multiplyScalar(0.5), quat: q, len: l };
  }, [from, to]);
  const mat = material ?? <meshStandardMaterial color="#6c737d" metalness={0.92} roughness={0.4} />;
  return (
    <group position={mid} quaternion={quat}>
      <mesh position={[0, -len * 0.22, 0]}>
        <cylinderGeometry args={[radius, radius, len * 0.56, 20]} />
        {mat}
      </mesh>
      <mesh position={[0, len * 0.26, 0]}>
        <cylinderGeometry args={[radius * 0.55, radius * 0.55, len * 0.5, 16]} />
        <meshStandardMaterial color="#c3c9d1" metalness={0.98} roughness={0.2} />
      </mesh>
      {[-0.5, 0.5].map((s) => (
        <mesh key={s} position={[0, len * s, 0]}>
          <sphereGeometry args={[radius * 0.9, 16, 12]} />
          <meshStandardMaterial color="#8a919b" metalness={0.95} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}
