"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { useLiveRefresh } from "./use-live-refresh";

// Sidebar, CommandBar and MobileBottomNav are all mounted at once and all show the
// "Худалдан авалт" counter. They share one store and one in-flight request instead of
// each fetching (or, as before, counting every request in the browser): the number is
// computed by the server for the logged-in manager (GET /api/procurement/badge).
const useBadgeStore = create<{ count: number }>(() => ({ count: 0 }));

let inflight: Promise<void> | null = null;
let stale = false;

function refresh(): Promise<void> {
  if (inflight) {
    stale = true; // something changed while a fetch was running: fetch once more afterwards
    return inflight;
  }
  inflight = (async () => {
    try {
      do {
        stale = false;
        const res = await fetch("/api/procurement/badge", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { count?: number };
          useBadgeStore.setState({ count: typeof body.count === "number" ? body.count : 0 });
        }
      } while (stale);
    } catch {
      // keep the last known number; the next live event retries
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function hasProcurementBadge(role: string | undefined) {
  return role === "MANAGER" || role === "ADMIN";
}

export function useProcurementBadge(role: string | undefined, userId: string | undefined): number {
  const count = useBadgeStore((s) => s.count);
  const enabled = hasProcurementBadge(role) && !!userId;
  useEffect(() => {
    if (enabled) void refresh();
    else useBadgeStore.setState({ count: 0 });
  }, [enabled, userId]);
  useLiveRefresh(() => {
    if (enabled) void refresh();
  });
  return enabled ? count : 0;
}
