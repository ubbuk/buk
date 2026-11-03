"use client";

import { useEffect, useRef } from "react";

export const LIVE_EVENT = "ubbuk:live-event";

/**
 * Runs `refetch` whenever the server signals that something changed (the
 * /api/events SSE stream, listened to by RequestsLoader, re-dispatches every
 * signal as a window event, already debounced). Use it in pages that load their
 * own data with fetch() so they update without a manual reload. Pages that read
 * the shared request store are already live and don't need this.
 */
export function useLiveRefresh(refetch: () => void) {
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  });

  useEffect(() => {
    const handler = () => latest.current();
    window.addEventListener(LIVE_EVENT, handler);
    return () => window.removeEventListener(LIVE_EVENT, handler);
  }, []);
}
