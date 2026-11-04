"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ChamberEnvironment } from "./ChamberEnvironment";
import { ArmorRing, Channel } from "./reactorParts";
import { makeRingGeometry, makeSectorGeometry, useBrushedSteel, useLabelTexture } from "./sceneKit";

// Heavy cylindrical data-storage reactor: a spinning core of stacked metal
// platters, wrapped by segmented armour plates that counter-rotate, held by
// locking collars with latches, on a stepped bolted base. It carries no data.
// The amber channels and rails follow `lit`, which is true only when a real
// backup system reports metadata; otherwise they stay dim (nothing is shown as
// healthy that is not).

const DISKS = 5;
const DH = 0.5;
const PITCH = 0.6;
const Y0 = -1.15;
const SECTORS = 12;
const AMBER = new THREE.Color("#ff9d22");
const diskY = (i: number) => Y0 + i * PITCH;

function Steel({ map, tone = "#8d949e", rough = 0.4, bump = 0.4 }: { map: THREE.Texture; tone?: string; rough?: number; bump?: number }) {
  return <meshStandardMaterial color={tone} metalness={0.92} roughness={rough} roughnessMap={map} bumpMap={map} bumpScale={bump} envMapIntensity={1.3} />;
}

function Vault({ lit, reduced, busy }: { lit: boolean; reduced: boolean; busy: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const steel = useBrushedSteel();
  const plate = useLabelTexture("BACKUP VAULT");
  const cores = useRef<(THREE.Group | null)[]>([]);
  const armors = useRef<(THREE.Group | null)[]>([]);
  const railMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const ringMat = useRef<THREE.MeshStandardMaterial>(null);
  const phase = useRef(0);
  const glow = useRef(0);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const baseBolts = useRef<THREE.InstancedMesh>(null);
  const lidBolts = useRef<THREE.InstancedMesh>(null);

  const geos = useMemo(() => {
    const step = (Math.PI * 2) / SECTORS;
    return {
      armor: makeSectorGeometry(1.34, 1.8, step * 0.8, DH, 0.035),
      collar: makeRingGeometry(1.98, 1.78, 0.26, 0.03),
      lid: makeRingGeometry(1.9, 0.62, 0.34, 0.04),
    };
  }, []);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);

  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    const ring = (m: THREE.InstancedMesh | null, count: number, r: number, y: number) => {
      if (!m) return;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        o.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    };
    ring(baseBolts.current, 20, 2.75, -2.33);
    ring(lidBolts.current, 14, 1.62, 1.97);
  }, []);

  useFrame((_, delta) => {
    const target = lit || busyRef.current ? 1 : 0.15;
    glow.current += (target - glow.current) * (1 - Math.exp(-delta * 4));
    for (const m of railMats.current) if (m) m.emissiveIntensity = glow.current * 1.3;
    if (ringMat.current) ringMat.current.emissiveIntensity = glow.current * 1.6;
    if (!reduced) {
      const boost = busyRef.current ? 3 : 1; // the vault works faster while an operation runs
      phase.current += delta * 0.9 * boost;
      for (let i = 0; i < DISKS; i++) {
        const c = cores.current[i];
        if (c) c.rotation.y += delta * (0.35 + i * 0.05) * boost * (i % 2 ? -1 : 1);
        const a = armors.current[i];
        if (a) a.rotation.y -= delta * (0.12 + i * 0.02) * boost * (i % 2 ? -1 : 1);
      }
    } else if (Math.abs(target - glow.current) > 0.01) {
      invalidate();
    }
  });

  const level = lit ? 1 : 0.22;
  const getPhase = () => phase.current;

  return (
    <group>
      <ChamberEnvironment
        floorY={-2.77}
        wallRadius={18}
        platformRadius={4.7}
        shadowRadius={3.9}
        columnAngles={[-0.8, -0.42, 0.42, 0.8]}
        wallSpan={1.5}
        level={lit ? 1 : 0.5}
        getPhase={getPhase}
      />
      {/* ---------- stepped, bolted base with nameplate ---------- */}
      <mesh position={[0, -2.55, 0]}>
        <cylinderGeometry args={[2.9, 3.05, 0.4, 80]} />
        <Steel map={steel} tone="#59606a" rough={0.5} />
      </mesh>
      <mesh position={[0, -2.17, 0]}>
        <cylinderGeometry args={[2.5, 2.7, 0.36, 80]} />
        <Steel map={steel} tone="#707782" />
      </mesh>
      <mesh position={[0, -1.85, 0]}>
        <cylinderGeometry args={[2.15, 2.3, 0.3, 80]} />
        <Steel map={steel} tone="#8a919b" rough={0.36} />
      </mesh>
      <group position={[0, -2.17, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <Channel count={40} radius={2.74} size={[0.24, 0.06, 0.05]} getPhase={getPhase} level={level} base={0.25} boost={1.4} sharp={5} />
      </group>
      <instancedMesh ref={baseBolts} args={[undefined, undefined, 20]}>
        <cylinderGeometry args={[0.08, 0.08, 0.08, 6]} />
        <meshStandardMaterial color="#b4bbc4" metalness={0.95} roughness={0.28} />
      </instancedMesh>
      <mesh position={[0, -2.5, 3.02]} rotation={[-0.12, 0, 0]}>
        <boxGeometry args={[2.1, 0.36, 0.08]} />
        <meshStandardMaterial map={plate} metalness={0.5} roughness={0.5} emissive="#ffffff" emissiveMap={plate} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, -1.55, 0]}>
        <cylinderGeometry args={[1.6, 1.7, 0.3, 64]} />
        <Steel map={steel} tone="#4a515b" rough={0.5} />
      </mesh>

      {/* ---------- central spindle ---------- */}
      <mesh>
        <cylinderGeometry args={[0.38, 0.38, 3.9, 28]} />
        <meshStandardMaterial color="#b9c0c9" metalness={0.98} roughness={0.22} />
      </mesh>

      {/* ---------- storage disks: spinning core + counter-rotating armour ---------- */}
      {Array.from({ length: DISKS }, (_, i) => (
        <group key={i} position={[0, diskY(i), 0]}>
          <group ref={(g) => void (cores.current[i] = g)}>
            <mesh>
              <cylinderGeometry args={[1.26, 1.26, DH, 64]} />
              <Steel map={steel} tone={i % 2 ? "#6f7680" : "#7d848e"} rough={0.36} bump={0.45} />
            </mesh>
            {[0.95, 0.65].map((r) => (
              <mesh key={r} position={[0, DH / 2 + 0.005, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[r, 0.02, 6, 72]} />
                <meshStandardMaterial color="#1c2025" metalness={0.6} roughness={0.6} />
              </mesh>
            ))}
          </group>
          {/* amber channel in the slits between armour plates */}
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <Channel count={72} radius={1.56} size={[0.18, 0.18, 0.1]} getPhase={getPhase} level={level} base={0.2} boost={1.6} sharp={8} />
          </group>
          <group ref={(g) => void (armors.current[i] = g)}>
            <group rotation={[-Math.PI / 2, 0, 0]}>
              <ArmorRing geometry={geos.armor} count={SECTORS} material={<Steel map={steel} tone={i % 2 ? "#6c737d" : "#7b828d"} rough={0.42} bump={0.5} />} />
            </group>
          </group>
        </group>
      ))}

      {/* ---------- locking collars with latches ---------- */}
      {[diskY(0) - DH / 2 - 0.02, diskY(DISKS - 1) + DH / 2 + 0.02].map((y, ci) => (
        <group key={ci} position={[0, y, 0]}>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh geometry={geos.collar}>
              <Steel map={steel} tone="#9aa1ab" rough={0.32} />
            </mesh>
          </group>
          {[0, 1, 2, 3].map((k) => {
            const a = (k * Math.PI) / 2 + Math.PI / 4;
            return (
              <group key={k} position={[Math.sin(a) * 2.0, 0, Math.cos(a) * 2.0]} rotation={[0, a, 0]}>
                <RoundedBox args={[0.5, 0.34, 0.26]} radius={0.05} smoothness={2}>
                  <Steel map={steel} tone="#6c737d" />
                </RoundedBox>
                <mesh position={[0, 0, 0.15]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.07, 0.07, 0.1, 6]} />
                  <meshStandardMaterial color="#c3c9d1" metalness={0.95} roughness={0.28} />
                </mesh>
                <mesh position={[0, ci ? -0.2 : 0.2, 0.02]}>
                  <boxGeometry args={[0.3, 0.1, 0.2]} />
                  <meshStandardMaterial color="#aab1bb" metalness={0.95} roughness={0.3} />
                </mesh>
              </group>
            );
          })}
        </group>
      ))}

      {/* vertical structural rails with amber light strips */}
      {[0, 1, 2, 3].map((k) => {
        const a = (k * Math.PI) / 2;
        return (
          <group key={k} position={[Math.sin(a) * 2.05, 0.1, Math.cos(a) * 2.05]} rotation={[0, a, 0]}>
            <RoundedBox args={[0.3, 3.9, 0.34]} radius={0.05} smoothness={2}>
              <Steel map={steel} tone="#59606a" rough={0.45} />
            </RoundedBox>
            <mesh position={[0, 0, 0.19]}>
              <boxGeometry args={[0.07, 3.3, 0.04]} />
              <meshStandardMaterial ref={(m) => void (railMats.current[k] = m)} color="#2a2216" emissive={AMBER} emissiveIntensity={0.2} toneMapped={false} />
            </mesh>
          </group>
        );
      })}

      {/* ---------- sealed lid with core ring ---------- */}
      <group position={[0, 1.78, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh geometry={geos.lid}>
          <Steel map={steel} tone="#79808b" rough={0.38} />
        </mesh>
      </group>
      <mesh position={[0, 1.72, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 0.3, 48]} />
        <Steel map={steel} tone="#4a515b" rough={0.5} />
      </mesh>
      <mesh position={[0, 1.97, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.45, 0.05, 10, 64]} />
        <meshStandardMaterial ref={ringMat} color="#2a2216" emissive={AMBER} emissiveIntensity={0.25} toneMapped={false} />
      </mesh>
      <instancedMesh ref={lidBolts} args={[undefined, undefined, 14]}>
        <cylinderGeometry args={[0.06, 0.06, 0.06, 6]} />
        <meshStandardMaterial color="#c3c9d1" metalness={0.95} roughness={0.28} />
      </instancedMesh>
    </group>
  );
}

export interface BackupVaultSceneProps {
  lit: boolean;
  frameloop: "always" | "demand" | "never";
  reduced: boolean;
  /** A backend operation is running (create / verify / test restore). */
  busy?: boolean;
}

export default function BackupVaultScene({ lit, frameloop, reduced, busy = false }: BackupVaultSceneProps) {
  return (
    <Canvas
      className="tm-canvas"
      frameloop={frameloop}
      dpr={[1, 1.5]}
      camera={{ fov: 32, position: [3.4, 2.4, 12.2], near: 0.5, far: 120 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      aria-hidden
    >
      <color attach="background" args={["#0e1013"]} />
      <fog attach="fog" args={["#14171b", 22, 60]} />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={["#d5dde8", "#23262c", 0.65]} />
      <directionalLight position={[-5, 8, 9]} intensity={3.0} color="#ffe8c8" />
      <directionalLight position={[8, 3, 6]} intensity={1.2} color="#b9cde0" />
      <directionalLight position={[0, 6, -9]} intensity={2.0} color="#ffd9a0" />
      <pointLight position={[0, 0, 3.5]} intensity={lit ? 12 : 3} color="#ff9d2e" distance={9} decay={2} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 8, 5]} scale={[16, 3, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.5} position={[-9, 2, 1]} scale={[2, 10, 1]} color="#ffb766" rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.2} position={[9, 2, 1]} scale={[2, 10, 1]} color="#9fb6c8" rotation-y={-Math.PI / 2} />
        <Lightformer form="rect" intensity={0.9} position={[0, 1, -8]} scale={[12, 3, 1]} color="#ffe0b0" />
      </Environment>
      <Vault lit={lit} reduced={reduced} busy={busy} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        enableDamping={!reduced}
        dampingFactor={0.07}
        rotateSpeed={0.5}
        minPolarAngle={0.75}
        maxPolarAngle={1.7}
        target={[0, -0.35, 0]}
      />
    </Canvas>
  );
}
