import { EventEmitter } from "node:events";

// Process-wide singleton (cached on globalThis, same trick lib/prisma.ts
// uses) so Next.js dev's hot-reload doesn't spawn a new emitter per edit
// and silently drop subscribers. This only fans out within a single Node
// process — fine for this app's current single-instance deployment; if it
// ever runs across multiple instances behind a load balancer, clients on
// a different instance won't see these events until the polling fallback
// catches up (see components/requests/RequestsLoader.tsx).
const g = globalThis as unknown as { __eventBus?: EventEmitter };
export const eventBus = g.__eventBus ?? (g.__eventBus = new EventEmitter());
eventBus.setMaxListeners(0);

// Payloads intentionally carry no business data — just a signal to
// refetch from the real (authenticated, authorized) REST endpoints that
// already exist. This is what keeps "never broadcast confidential data"
// true by construction rather than by careful per-event filtering.
// "data-changed" = reference data (users, departments, approvers) edited by an admin.
export type LiveEvent = { type: "request-changed" | "notification" | "data-changed" };

export function emitUserEvent(userId: string, event: LiveEvent) {
  eventBus.emit(`user:${userId}`, event);
}

export function emitBroadcast(event: LiveEvent) {
  eventBus.emit("broadcast", event);
}
