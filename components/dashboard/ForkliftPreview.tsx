import type { ReactNode, Ref } from "react";

// Light-weight pieces shared by the dashboard and the (lazy) three.js viewer.
// Nothing here imports three / R3F, so it stays in the initial bundle and the
// dashboard can show a placeholder of the exact same size while the 3D chunk
// and GLB load.

export const FORKLIFT_POSTER_SRC = "/images/forklift-preview.webp";
const MODEL_LABEL = "Electric Counterbalance Forklift";
const MODEL_ATTRIBUTION = "CC0 — Innerscene Corp";

export function ViewerFrame({
  className = "",
  containerRef,
  children,
}: {
  className?: string;
  containerRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={containerRef}
      className={`group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-bg-surface via-bg-surface to-bg transition-colors hover:border-tech/40 ${className}`}
    >
      {children}
    </div>
  );
}

export function ViewerLabel() {
  return (
    <span className="rounded-md border border-border bg-bg/85 px-2 py-1 text-[10px] font-medium text-text-muted backdrop-blur">
      {MODEL_LABEL} · {MODEL_ATTRIBUTION}
    </span>
  );
}

// Static snapshot of the model (same camera/lighting as the live scene).
export function ForkliftPoster({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- fixed-size decorative poster, not worth the optimizer round-trip
    <img
      src={FORKLIFT_POSTER_SRC}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      loading="lazy"
      className={`pointer-events-none absolute inset-0 size-full select-none object-cover ${className}`}
    />
  );
}

// Shown in place of the viewer until the 3D chunk is requested / downloaded.
export function ForkliftPreview({ className = "" }: { className?: string }) {
  return (
    <ViewerFrame className={className}>
      <ForkliftPoster />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-2.5 pr-14">
        <ViewerLabel />
      </div>
    </ViewerFrame>
  );
}
