"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LIVE_EVENT } from "@/lib/use-live-refresh";

export const REFRESH_INTERVAL_MS = 30_000;

/**
 * One shared clock for the whole monitoring page: `tick` increases every 30 s
 * (only while the tab is visible; coming back to a stale tab refreshes at
 * once) and whenever `refresh()` is called. Every section refetches on a tick,
 * so they all update together.
 */
export function useRefreshTick() {
  const [tick, setTick] = useState(0);
  const lastRef = useRef(Date.now());

  const refresh = useCallback(() => {
    lastRef.current = Date.now();
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastRef.current >= REFRESH_INTERVAL_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Real-time: a server signal refreshes immediately (the 30 s timer remains as a safety net).
    const onLive = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener(LIVE_EVENT, onLive);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(LIVE_EVENT, onLive);
    };
  }, [refresh]);

  return { tick, refresh };
}

interface LiveState<T> {
  data: T | null;
  error: string | null;
  /** True only until the first response; refreshes keep showing the last data. */
  loading: boolean;
  /** A request (initial, page change or refresh) is in flight. */
  fetching: boolean;
  updatedAt: number | null;
}

export function useLiveData<T>(url: string, tick: number) {
  const [state, setState] = useState<LiveState<T>>({ data: null, error: null, loading: true, fetching: true, updatedAt: null });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, fetching: true }));

    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Серверийн алдаа (${res.status})`);
        }
        return res.json() as Promise<T>;
      })
      .then((data) => setState({ data, error: null, loading: false, fetching: false, updatedAt: Date.now() }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Keep whatever was last shown; surface the failure next to it.
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : "Мэдээлэл ачаалахад алдаа гарлаа",
          loading: false,
          fetching: false,
        }));
      });

    return () => controller.abort();
  }, [url, tick]);

  return state;
}
