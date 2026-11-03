"use client";

import { Component, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls, useGLTF } from "@react-three/drei";
import { AlertTriangle, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import * as THREE from "three";


const MODEL_SRC = "/models/forklift.glb";
const MODEL_LABEL = "Electric Counterbalance Forklift";
const MODEL_ATTRIBUTION = "CC0 — Innerscene Corp";

const VIEW_DIRECTION = new THREE.Vector3(0.85, 0.55, 1.15).normalize();

const FIT_PADDING = 1.65;

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
  } catch {
    return false;
  }
}


function Model({
  controlsRef,
  onMeasure,
}: {
  controlsRef: React.RefObject<React.ComponentRef<typeof OrbitControls> | null>;
  onMeasure: (m: { groundY: number; radius: number }) => void;
}) {
  const { scene } = useGLTF(MODEL_SRC);
  const { camera, invalidate } = useThree();

  useLayoutEffect(() => {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());


    scene.position.sub(center);
    onMeasure({ groundY: -size.y / 2, radius: Math.hypot(size.x, size.z) / 2 });

    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const persp = camera as THREE.PerspectiveCamera;
    const fovRad = (persp.fov * Math.PI) / 180;
    const fitDistance = (maxDim / 2 / Math.tan(fovRad / 2)) * FIT_PADDING;

    camera.position.copy(VIEW_DIRECTION.clone().multiplyScalar(fitDistance));
    persp.near = Math.max(0.01, fitDistance / 100);
    persp.far = fitDistance * 20;
    camera.lookAt(0, 0, 0);
    persp.updateProjectionMatrix();

    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.minDistance = fitDistance * 0.4;
      controls.maxDistance = fitDistance * 2.2;
      controls.update();
    }

    invalidate();
  }, [scene, camera, controlsRef, onMeasure, invalidate]);

  return <primitive object={scene} />;
}
useGLTF.preload(MODEL_SRC);

function Stage({ groundY, radius }: { groundY: number; radius: number }) {
  const r = radius * 1.35;
  const h = Math.max(0.12, radius * 0.12);
  return (
    <group position={[0, groundY, 0]}>
      <mesh position={[0, -h / 2 - 0.002, 0]} receiveShadow>
        <cylinderGeometry args={[r, r * 1.04, h, 72]} />
        <meshStandardMaterial color="#1B2A36" roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.97, r, 96]} />
        <meshBasicMaterial color="#22D3EE" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 0.97, 72]} />
        <meshStandardMaterial color="#223545" roughness={0.45} metalness={0.4} />
      </mesh>
      <spotLight position={[-r * 2.2, r * 1.6, r * 0.6]} angle={0.5} penumbra={0.8} intensity={260} decay={2} color="#9BE9F7" />
      <spotLight position={[r * 2.2, r * 1.6, r * 0.6]} angle={0.5} penumbra={0.8} intensity={260} decay={2} color="#FFD79A" />
    </group>
  );
}

function Lighting() {
  return (
    <>
      {/* Brighter, more neutral ambient + a soft opposite-side fill so the
          forklift's orange body and gray mast read clearly instead of
          falling into shadow; cyan/amber point lights stay as rim accents. */}
      <ambientLight intensity={0.75} color="#9CA9B3" />
      <directionalLight position={[4, 6, 3]} intensity={1.4} color="#F3F6FA" />
      <directionalLight position={[-3, 2, -4]} intensity={0.5} color="#C7D2D9" />
      <pointLight position={[-4, 2.5, -3]} intensity={6} color="#22D3EE" distance={14} decay={2} />
      <pointLight position={[3, -1, 4]} intensity={3.5} color="#F59E0B" distance={12} decay={2} />
    </>
  );
}

interface BoundaryProps {
  children: ReactNode;
  fallback: ReactElement;
}
interface BoundaryState {
  hasError: boolean;
}

class ViewerErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function ViewerFallback({ reason }: { reason: string }) {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 p-4 text-center">
      <AlertTriangle className="size-5 text-text-muted" />
      <p className="text-xs text-text-muted">{reason}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full min-h-[140px] items-center justify-center">
      <div className="size-6 animate-spin rounded-full border-2 border-tech/30 border-t-tech" />
    </div>
  );
}

export default function Industrial3DViewer({ className = "" }: { className?: string }) {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [{ groundY, radius }, setMeasure] = useState({ groundY: -1, radius: 2 });
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  useEffect(() => {
    setWebglOk(hasWebGL());
  }, []);

  useEffect(() => {
    function onFsChange() {
      setFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    }
  }

  function resetCamera() {
    controlsRef.current?.reset();
  }

  return (
    <div
      ref={containerRef}
      className={`group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-bg-surface via-bg-surface to-bg transition-colors hover:border-tech/40 ${className}`}
    >
      {webglOk === null && <LoadingState />}

      {webglOk === false && <ViewerFallback reason="3D харагдац энэ төхөөрөмж дээр дэмжигдэхгүй байна" />}

      {webglOk === true && (
        <ViewerErrorBoundary fallback={<ViewerFallback reason="3D загвар ачаалахад алдаа гарлаа" />}>
          <Suspense fallback={<LoadingState />}>
            <Canvas
              frameloop="demand"
              dpr={[1, 1.5]}
              camera={{ position: [3.2, 1.6, 3.6], fov: 38 }}
              gl={{ antialias: true, alpha: false }}
              onCreated={({ gl }) => gl.setClearColor("#0B1118", 1)}
              className="size-full"
            >
              <Lighting />
              <Suspense fallback={null}>
                <Model controlsRef={controlsRef} onMeasure={setMeasure} />
                <Stage groundY={groundY} radius={radius} />
                <ContactShadows position={[0, groundY + 0.003, 0]} opacity={0.5} scale={radius * 2.6} blur={2.2} far={3} color="#000000" />
              </Suspense>
              <OrbitControls
                ref={controlsRef}
                enablePan={false}
                minPolarAngle={Math.PI / 6}
                maxPolarAngle={Math.PI / 1.7}
                autoRotate
                autoRotateSpeed={1.2}
                makeDefault
              />
            </Canvas>
          </Suspense>
        </ViewerErrorBoundary>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-2.5 pr-14">
        <span className="rounded-md border border-border bg-bg/85 px-2 py-1 text-[10px] font-medium text-text-muted backdrop-blur">
          {MODEL_LABEL} · {MODEL_ATTRIBUTION}
        </span>
        {webglOk === true && (
          <div className="pointer-events-auto flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={resetCamera}
              title="Камер шинэчлэх"
              className="focus-ring flex size-7 items-center justify-center rounded-md border border-border bg-bg/85 text-text-muted backdrop-blur hover:text-tech"
            >
              <RotateCcw className="size-3.5" />
            </button>
            <button
              onClick={toggleFullscreen}
              title={fullscreen ? "Жижигрүүлэх" : "Дэлгэц дүүргэх"}
              className="focus-ring flex size-7 items-center justify-center rounded-md border border-border bg-bg/85 text-text-muted backdrop-blur hover:text-tech"
            >
              {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
