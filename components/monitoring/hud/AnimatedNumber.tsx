"use client";

import gsap from "gsap";
import { useEffect, useLayoutEffect, useRef } from "react";

// Tweens the displayed number by writing straight to the DOM node, so a data
// refresh never re-renders the surrounding dashboard. Reduced-motion users get
// the value instantly.
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef({ v: value });

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = String(Math.round(shown.current.v));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || shown.current.v === value) {
      shown.current.v = value;
      el.textContent = String(value);
      return;
    }
    const tween = gsap.to(shown.current, {
      v: value,
      duration: 0.8,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = String(Math.round(shown.current.v));
      },
    });
    return () => {
      tween.kill();
    };
  }, [value]);

  return <span ref={ref} className={className} />;
}
