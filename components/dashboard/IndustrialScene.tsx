// Lightweight inline-SVG "isometric facility" geometry -- every structure is
// built from flat 2D polygons (no Three.js/WebGL), so it stays cheap to
// render while still reading as a recognizable building type rather than a
// generic cube. Reused across structures:
//   isoBox   -- a 3-face extruded platform (top diamond + two shaded sides)
//   lerpQuad -- maps a (u,v) in [0,1]x[0,1] onto a skewed face parallelogram,
//               so doors/racks/window-bands sit correctly on the iso faces.
export const GROUND_Y = 360;
export const VB_W = 1200;
export const VB_H = 480;
export const PAD_X = 120;

type Pt = [number, number];

interface Faces {
  top: string;
  left: string;
  right: string;
  cy: number;
  topN: Pt;
  topE: Pt;
  topS: Pt;
  topW: Pt;
  bottomFront: Pt;
  leftBottomOuter: Pt;
  rightBottomOuter: Pt;
}

function isoBox(cx: number, groundY: number, halfW: number, halfH: number, legH: number): Faces {
  const cy = groundY - halfH - legH;
  const N: Pt = [cx, cy - halfH];
  const E: Pt = [cx + halfW, cy];
  const S: Pt = [cx, cy + halfH];
  const W: Pt = [cx - halfW, cy];
  const S2: Pt = [cx, cy + halfH + legH];
  const W2: Pt = [cx - halfW, cy + legH];
  const E2: Pt = [cx + halfW, cy + legH];
  const pts = (arr: Pt[]) => arr.map((p) => p.join(",")).join(" ");
  return {
    top: pts([N, E, S, W]),
    left: pts([W, S, S2, W2]),
    right: pts([S, E, E2, S2]),
    cy,
    topN: N,
    topE: E,
    topS: S,
    topW: W,
    bottomFront: S2,
    leftBottomOuter: W2,
    rightBottomOuter: E2,
  };
}

function lerpQuad(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number, v: number): Pt {
  const ax = p0[0] + (p1[0] - p0[0]) * u;
  const ay = p0[1] + (p1[1] - p0[1]) * u;
  const bx = p3[0] + (p2[0] - p3[0]) * u;
  const by = p3[1] + (p2[1] - p3[1]) * u;
  return [ax + (bx - ax) * v, ay + (by - ay) * v];
}

function faceRect(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u0: number, v0: number, u1: number, v1: number): string {
  return [lerpQuad(p0, p1, p2, p3, u0, v0), lerpQuad(p0, p1, p2, p3, u1, v0), lerpQuad(p0, p1, p2, p3, u1, v1), lerpQuad(p0, p1, p2, p3, u0, v1)]
    .map((p) => p.join(","))
    .join(" ");
}

export interface Structure {
  node: React.ReactNode;
  anchorX: number;
  anchorY: number;
}

const CYAN = "#22D3EE";
const AMBER = "#F59E0B";

function renderWarehouse(cx: number): Structure {
  const f = isoBox(cx, GROUND_Y, 64, 32, 102);
  const cap = isoBox(cx - 4, f.cy, 24, 12, 18);
  const door = faceRect(f.topW, f.topS, f.bottomFront, f.leftBottomOuter, 0.3, 0.52, 0.7, 0.94);
  const rack: string[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      rack.push(faceRect(f.topS, f.topE, f.rightBottomOuter, f.bottomFront, c / 3 + 0.04, 0.18 + r * 0.38, c / 3 + 0.29, 0.18 + r * 0.38 + 0.24));
    }
  }
  const node = (
    <g>
      <polygon points={f.left} fill="#111C26" />
      <polygon points={f.right} fill="#17242F" />
      <polygon points={f.top} fill="#1E303D" stroke={CYAN} strokeOpacity="0.4" strokeWidth="1.5" />
      <polygon points={cap.left} fill="#0E161D" />
      <polygon points={cap.right} fill="#131F28" />
      <polygon points={cap.top} fill="#1E303D" stroke={CYAN} strokeOpacity="0.55" strokeWidth="1.2" />
      <polygon points={door} fill="#0B1118" stroke={CYAN} strokeOpacity="0.3" />
      {rack.map((pts, i) => (
        <polygon key={i} points={pts} fill={CYAN} fillOpacity="0.2" stroke={CYAN} strokeOpacity="0.55" strokeWidth="0.75" />
      ))}
    </g>
  );
  return { node, anchorX: cx, anchorY: cap.topN[1] - 16 };
}

function renderSupplyDock(cx: number): Structure {
  const f = isoBox(cx, GROUND_Y, 52, 26, 74);
  const canopy = isoBox(cx - 2, f.cy + 6, 30, 10, 8);
  const door = faceRect(f.topW, f.topS, f.bottomFront, f.leftBottomOuter, 0.25, 0.4, 0.75, 0.92);
  const rampTop1 = lerpQuad(f.topW, f.topS, f.bottomFront, f.leftBottomOuter, 0.05, 0.78);
  const rampTop2 = lerpQuad(f.topW, f.topS, f.bottomFront, f.leftBottomOuter, 0.05, 1.0);
  const rampBottom1: Pt = [rampTop1[0] - 46, GROUND_Y + 2];
  const rampBottom2: Pt = [rampTop2[0] - 46, GROUND_Y + 2];
  const ramp = [rampTop1, rampBottom1, rampBottom2, rampTop2].map((p) => p.join(",")).join(" ");
  const pallet = isoBox(rampBottom1[0] - 10, GROUND_Y, 10, 5, 10);
  const node = (
    <g>
      <polygon points={ramp} fill="#131F28" stroke={CYAN} strokeOpacity="0.2" />
      <polygon points={pallet.left} fill="#0E161D" />
      <polygon points={pallet.right} fill="#131F28" />
      <polygon points={pallet.top} fill="#1E303D" stroke={AMBER} strokeOpacity="0.4" />
      <polygon points={f.left} fill="#111C26" />
      <polygon points={f.right} fill="#17242F" />
      <polygon points={f.top} fill="#1E303D" stroke={CYAN} strokeOpacity="0.4" strokeWidth="1.5" />
      <polygon points={canopy.left} fill="#0E161D" />
      <polygon points={canopy.right} fill="#131F28" />
      <polygon points={canopy.top} fill="#17242F" stroke={AMBER} strokeOpacity="0.45" strokeWidth="1.2" />
      <polygon points={door} fill="#0B1118" stroke={AMBER} strokeOpacity="0.35" />
    </g>
  );
  return { node, anchorX: cx, anchorY: canopy.topN[1] - 16 };
}

function renderApprovalLine(cx: number, attention: boolean): Structure {
  const f = isoBox(cx, GROUND_Y, 100, 24, 16);
  const color = attention ? AMBER : CYAN;
  const gateCount = 5;
  const gates = Array.from({ length: gateCount }, (_, i) => {
    const t = (i + 0.5) / gateCount;
    return { gx: cx - 78 + 156 * t, gy: f.cy + 4 };
  });
  const node = (
    <g>
      <polygon points={f.left} fill="#111C26" />
      <polygon points={f.right} fill="#17242F" />
      <polygon points={f.top} fill="#1E303D" stroke={color} strokeOpacity="0.45" strokeWidth="1.5" />
      <polyline
        points={gates.map((g) => `${g.gx},${g.gy}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray="3 6"
        strokeLinecap="round"
        className="icc-flow"
      />
      {gates.map((g, i) => (
        <g key={i}>
          <line x1={g.gx} y1={g.gy} x2={g.gx} y2={g.gy - 18} stroke={color} strokeOpacity="0.4" />
          <circle cx={g.gx} cy={g.gy - 18} r="2.2" fill={color} />
        </g>
      ))}
    </g>
  );
  return { node, anchorX: cx, anchorY: f.cy - 24 - 22 };
}

function renderFinanceTower(cx: number, attention: boolean): Structure {
  const f = isoBox(cx, GROUND_Y, 38, 19, 112);
  const cap = isoBox(cx, f.cy, 16, 8, 10);
  const color = attention ? AMBER : CYAN;
  const vault = lerpQuad(f.topW, f.topS, f.bottomFront, f.leftBottomOuter, 0.5, 0.65);
  const bands = [0.28, 0.5, 0.72].map((v) => faceRect(f.topS, f.topE, f.rightBottomOuter, f.bottomFront, 0.1, v, 0.9, v + 0.04));
  const node = (
    <g>
      <polygon points={f.left} fill="#111C26" />
      <polygon points={f.right} fill="#17242F" />
      <polygon points={f.top} fill="#1E303D" stroke={CYAN} strokeOpacity="0.4" strokeWidth="1.5" />
      <polygon points={cap.left} fill="#0E161D" />
      <polygon points={cap.right} fill="#131F28" />
      <polygon points={cap.top} fill="#1E303D" stroke={color} strokeOpacity="0.5" strokeWidth="1.2" />
      {bands.map((pts, i) => (
        <polygon key={i} points={pts} fill={CYAN} fillOpacity="0.14" />
      ))}
      <circle cx={vault[0]} cy={vault[1]} r="7" fill="none" stroke={color} strokeOpacity="0.65" strokeWidth="1.3" />
      <circle cx={vault[0]} cy={vault[1]} r="2.4" fill={color} fillOpacity="0.75" />
    </g>
  );
  return { node, anchorX: cx, anchorY: cap.topN[1] - 16 };
}

function renderReportsTower(cx: number): Structure {
  const f = isoBox(cx, GROUND_Y, 36, 18, 92);
  const mastTopY = f.topN[1] - 36;
  const node = (
    <g>
      <polygon points={f.left} fill="#111C26" />
      <polygon points={f.right} fill="#17242F" />
      <polygon points={f.top} fill="#1E303D" stroke={CYAN} strokeOpacity="0.4" strokeWidth="1.5" />
      <line x1={cx} y1={f.topN[1]} x2={cx} y2={mastTopY} stroke={CYAN} strokeOpacity="0.55" strokeWidth="1.3" />
      <line x1={cx - 14} y1={mastTopY + 12} x2={cx + 14} y2={mastTopY + 12} stroke={CYAN} strokeOpacity="0.3" />
      <circle cx={cx} cy={mastTopY} r="3.5" fill="none" stroke={CYAN} strokeWidth="1.2" />
      <circle cx={cx} cy={mastTopY} r="1.6" fill={CYAN} className="icc-blink" />
    </g>
  );
  return { node, anchorX: cx, anchorY: mastTopY - 16 };
}

function renderAdminBlock(cx: number): Structure {
  const f = isoBox(cx, GROUND_Y, 50, 25, 84);
  const turret = isoBox(cx + 20, f.cy - 4, 14, 7, 16);
  const [sx, sy] = lerpQuad(f.topS, f.topE, f.rightBottomOuter, f.bottomFront, 0.5, 0.55);
  const shield = `${sx},${sy - 9} ${sx + 7},${sy - 4} ${sx + 6},${sy + 6} ${sx},${sy + 10} ${sx - 6},${sy + 6} ${sx - 7},${sy - 4}`;
  const gateBaseX = cx - 54;
  const node = (
    <g>
      <polygon points={f.left} fill="#111C26" />
      <polygon points={f.right} fill="#17242F" />
      <polygon points={f.top} fill="#1E303D" stroke={AMBER} strokeOpacity="0.45" strokeWidth="1.5" />
      <polygon points={turret.left} fill="#0E161D" />
      <polygon points={turret.right} fill="#131F28" />
      <polygon points={turret.top} fill="#1E303D" stroke={AMBER} strokeOpacity="0.5" strokeWidth="1.2" />
      <polygon points={shield} fill={AMBER} fillOpacity="0.18" stroke={AMBER} strokeOpacity="0.7" strokeWidth="1" />
      <line x1={gateBaseX} y1={GROUND_Y - 2} x2={gateBaseX} y2={GROUND_Y - 24} stroke={CYAN} strokeOpacity="0.4" />
      <line x1={gateBaseX} y1={GROUND_Y - 20} x2={gateBaseX + 30} y2={GROUND_Y - 28} stroke={AMBER} strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
  return { node, anchorX: cx, anchorY: turret.topN[1] - 16 };
}

export function renderStructure(href: string, cx: number, attention: boolean): Structure {
  switch (href) {
    case "/requests":
      return renderSupplyDock(cx);
    case "/approvals":
      return renderApprovalLine(cx, attention);
    case "/warehouses":
      return renderWarehouse(cx);
    case "/accounting":
      return renderFinanceTower(cx, attention);
    case "/reports":
      return renderReportsTower(cx);
    case "/admin":
      return renderAdminBlock(cx);
    default:
      return renderWarehouse(cx);
  }
}

export function layoutPositions(count: number): number[] {
  if (count === 1) return [VB_W / 2];
  const usable = VB_W - PAD_X * 2;
  return Array.from({ length: count }, (_, i) => PAD_X + (usable / (count - 1)) * i);
}
