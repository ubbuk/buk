"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRequestStore } from "@/lib/store";

const MAX_BACKOFF_MS = 30000;
const POLL_INTERVAL_MS = 20000;
const FAILURES_BEFORE_POLLING = 3;
// Several requests changing in quick succession (e.g. a batch of approvals)
// each broadcast their own signal; without coalescing, every connected
// client would re-run the full unbounded /api/requests fetch once per
// signal. Collapsing a burst into a single trailing refetch keeps the
// per-client cost to one fetch per burst instead of one per event.
const REFETCH_DEBOUNCE_MS = 400;

/**
 * Subscribes to /api/events (SSE) so every screen refetches when another
 * session changes something. Payloads carry no data — a message just
 * means "something changed, go re-fetch" (see lib/events.ts), so this
 * dispatches a DOM event other components (e.g. the notification bell in
 * Topbar) can also listen for, instead of overloading the request store
 * with notification state it doesn't otherwise need.
 *
 * Reconnects with capped exponential backoff; after a few failures in a
 * row it falls back to plain polling while still periodically retrying to
 * re-open the stream — the required fallback for a deployment where a
 * long-lived SSE connection might not survive (proxies, serverless, etc).
 */
export function RequestsLoader() {
  const loadRequests = useRequestStore((s) => s.loadRequests);
  const { status } = useSession();

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (status !== "authenticated") return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    let needsCatchUp = false;
    let stopped = false;

    function onSignal() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadRequests();
        window.dispatchEvent(new CustomEvent("ubbuk:live-event"));
      }, REFETCH_DEBOUNCE_MS);
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(onSignal, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function connect() {
      if (stopped) return;
      es = new EventSource("/api/events");

      // A reconnect means signals may have been missed while the stream was down
      // (they are not replayed): refresh once so every live view catches up.
      es.onopen = () => {
        if (needsCatchUp) {
          needsCatchUp = false;
          onSignal();
        }
      };

      es.onmessage = () => {
        consecutiveFailures = 0;
        stopPolling();
        onSignal();
      };

      es.onerror = () => {
        es?.close();
        needsCatchUp = true;
        consecutiveFailures += 1;
        if (consecutiveFailures >= FAILURES_BEFORE_POLLING) startPolling();

        const delay = Math.min(1000 * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      stopped = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return null;
}
