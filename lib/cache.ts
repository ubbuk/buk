// Tiny in-process TTL cache for non-sensitive, shared (never per-user) data —
// catalog lists (materials/departments/warehouses) and the auth jwt
// callback's user-role lookup. Process-wide singleton on globalThis, same
// hot-reload survival trick as lib/prisma.ts and lib/events.ts.
//
// Deliberately not Redis: this app runs as a single Next.js instance against
// a single Postgres instance, so an in-process Map removes the DB round trip
// without adding infrastructure. If this ever runs as multiple instances
// behind a load balancer, each instance's cache is independent — writes
// still invalidate correctly within an instance, but a stale read on another
// instance is possible until that instance's TTL expires. Fine for current
// deployment; worth a Redis-backed cache if that changes.
type Entry = { value: unknown; expiresAt: number };

const g = globalThis as unknown as { __appCache?: Map<string, Entry> };
const store = g.__appCache ?? (g.__appCache = new Map());

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = await load();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function invalidate(key: string) {
  store.delete(key);
}
