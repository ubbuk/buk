"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import * as THREE from "three";

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

// WebGL support, reduced-motion preference, and whether the scene is on screen
// (scrolled into view and the tab is foreground). Scenes pause when inactive.
export function useSceneEnv(ref: RefObject<HTMLElement | null>) {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

  useEffect(() => setWebgl(hasWebGL()), []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const el = ref.current;
    const io = el ? new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.02 }) : null;
    if (el && io) io.observe(el);
    const onVis = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ref]);

  return { webgl, reduced, active: inView && tabVisible };
}

// Procedural brushed-steel maps (fine horizontal grain). One 256px canvas
// feeds both roughness and bump; disposed with the component.
export function useBrushedSteel() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#8c8c8c";
    g.fillRect(0, 0, 256, 256);
    // Deterministic pseudo-random so the grain never changes between renders.
    let seed = 1337;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 700; i++) {
      const y = rnd() * 256;
      const v = 90 + Math.floor(rnd() * 120);
      g.strokeStyle = `rgba(${v},${v},${v},${0.15 + rnd() * 0.35})`;
      g.lineWidth = 0.5 + rnd() * 1.2;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y + (rnd() - 0.5) * 2);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

// Spur gear outline extruded with a small bevel. Caller owns disposal.
export function makeGearGeometry(teeth: number, outerR: number, rootR: number, thickness: number, holeR = rootR * 0.42): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  const pts: [number, number][] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [off, r] of [
      [0, rootR],
      [0.18, outerR],
      [0.5, outerR],
      [0.68, rootR],
    ] as const) {
      pts.push([Math.cos(a + off * step) * r, Math.sin(a + off * step) * r]);
    }
  }
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 1,
    curveSegments: 10,
  });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

// Thick bevelled annulus (a real metal ring, not a thin torus). Lies in the XY
// plane, centred on its thickness. Caller owns disposal.
export function makeRingGeometry(outerR: number, innerR: number, thickness: number, bevel = 0.025): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 72,
  });
  geo.translate(0, 0, -(thickness - bevel * 2) / 2);
  return geo;
}

// Tapered clock hand with a counterweight tail, pointing along +Y.
export function makeHandGeometry(length: number, baseW: number, tipW: number, tail: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-baseW, -tail);
  s.lineTo(baseW, -tail);
  s.lineTo(baseW, 0);
  s.lineTo(tipW, length);
  s.lineTo(0, length + tipW * 2);
  s.lineTo(-tipW, length);
  s.lineTo(-baseW, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
  geo.translate(0, 0, -0.015);
  return geo;
}

// Clock dial: brushed dark face, minute track, hour ticks, amber inner ring and
// 1-12 numerals, drawn once into a canvas texture.
export function useDialTexture() {
  const tex = useMemo(() => {
    const S = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    const cx = S / 2;
    const bg = g.createRadialGradient(cx, cx, 40, cx, cx, cx);
    bg.addColorStop(0, "#2b3037");
    bg.addColorStop(1, "#14171b");
    g.fillStyle = bg;
    g.fillRect(0, 0, S, S);
    g.translate(cx, cx);
    g.strokeStyle = "rgba(232,150,42,0.85)";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, cx * 0.9, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, cx * 0.62, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 60; i++) {
      const big = i % 5 === 0;
      g.save();
      g.rotate((i / 60) * Math.PI * 2);
      g.fillStyle = big ? "#eef1f5" : "rgba(220,226,234,0.65)";
      const w = big ? 12 : 4;
      const len = big ? 56 : 26;
      g.fillRect(-w / 2, -cx * 0.86, w, len);
      g.restore();
    }
    g.fillStyle = "#eef1f5";
    g.font = "700 92px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      g.fillText(String(n), Math.sin(a) * cx * 0.66, -Math.cos(a) * cx * 0.66);
    }
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

// Annular sector (an armour plate) centred on +X, extruded along Z and bevelled.
// Instance it around a circle with rotation.z. Caller owns disposal.
export function makeSectorGeometry(rIn: number, rOut: number, angle: number, depth: number, bevel = 0.03): THREE.ExtrudeGeometry {
  const a0 = -angle / 2;
  const a1 = angle / 2;
  const s = new THREE.Shape();
  s.moveTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
  s.lineTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut);
  s.absarc(0, 0, rOut, a0, a1, false);
  s.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
  s.absarc(0, 0, rIn, a1, a0, true);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -(depth - bevel * 2) / 2);
  return geo;
}

// Engraved nameplate: amber text on dark metal, drawn once into a canvas.
export function useLabelTexture(text: string) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 192;
    const g = c.getContext("2d")!;
    g.fillStyle = "#14171b";
    g.fillRect(0, 0, 1024, 192);
    g.strokeStyle = "rgba(232,150,42,0.9)";
    g.lineWidth = 8;
    g.strokeRect(14, 14, 996, 164);
    g.fillStyle = "#f0a640";
    g.font = "800 112px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 512, 100);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}
