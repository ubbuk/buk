"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

const RUN_MS = 1000;

// Gold delivery-truck badge (icon only). On click the truck drives out of the
// badge before navigating, so the route change reads as "order dispatched".
export function TruckButton({ href, label, large = false }: { href: string; label: string; large?: boolean }) {
  const router = useRouter();
  const gradId = useId();
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onClick() {
    if (running) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(href);
      return;
    }
    setRunning(true);
    timer.current = setTimeout(() => router.push(href), RUN_MS);
  }

  const gold = `url(#${gradId})`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-busy={running}
      className={`focus-ring group relative flex ${large ? "size-[72px]" : "size-14"} shrink-0 items-center justify-center rounded-full bg-black shadow-[0_0_22px_-2px_rgba(245,158,11,0.55)] transition-transform duration-200 hover:scale-105 active:scale-95`}
    >
      {!running && (
        <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 animate-ping rounded-full bg-amber-400/30 [animation-duration:2.4s]" />
      )}
      <svg viewBox="0 0 100 100" aria-hidden className="absolute inset-0 size-full">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FBE9A0" />
            <stop offset="0.45" stopColor="#D9A21B" />
            <stop offset="0.7" stopColor="#F6D463" />
            <stop offset="1" stopColor="#B07A0C" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="none" stroke={gold} strokeWidth="3" />
        <circle
          cx="50"
          cy="50"
          r="41"
          fill="none"
          stroke={gold}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="0.1 4.1"
        />
      </svg>

      <span className={`relative flex ${large ? "size-12" : "size-8"} items-center justify-center overflow-hidden`}>
        <motion.svg
          viewBox="0 0 66 40"
          aria-hidden
          className={large ? "h-8 w-12" : "h-5 w-8"}
          initial={false}
          animate={running ? { x: [0, -4, 46] } : { x: 0 }}
          transition={{ duration: RUN_MS / 1000, times: [0, 0.25, 1], ease: ["easeOut", "easeIn"] }}
        >
          <rect x="0" y="9" width="12" height="3" rx="1.5" fill={gold} />
          <rect x="4" y="15" width="10" height="3" rx="1.5" fill={gold} />
          <rect x="15" y="2" width="31" height="23" rx="3" fill={gold} />
          <path d="M48 9h7.2c1 0 1.9.5 2.5 1.3l5.5 7.4c.5.7.8 1.5.8 2.4V28H48z" fill={gold} />
          <path d="M51.5 12.5h3.8l4.2 5.5h-8z" fill="#000" />
          <rect x="15" y="25" width="49" height="4" rx="2" fill={gold} />
          <circle cx="26" cy="31" r="6.5" fill={gold} />
          <circle cx="26" cy="31" r="2.6" fill="#000" />
          <circle cx="53" cy="31" r="6.5" fill={gold} />
          <circle cx="53" cy="31" r="2.6" fill="#000" />
        </motion.svg>
      </span>
    </button>
  );
}
