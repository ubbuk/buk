// 1С-ийг ачаалахгүй байх: хэрэглэгч тус бүрийн хүсэлтийн хязгаар ба 5 минутын cache. Process дотор (нэг instance).
// Олон instance болвол instance бүр өөрийн тоолууртай (хязгаар instance тутамд) — lib/cache.ts-ийн тайлбартай ижил.
import { CACHE_TTL_MS, RATE_LIMIT_PER_MINUTE } from "./config";

const WINDOW_MS = 60_000;
const MAX_CACHE_ENTRIES = 200;

const g = globalThis as unknown as {
  __odataRate?: Map<string, { count: number; windowStart: number }>;
  __odataCache?: Map<string, { value: unknown; expiresAt: number }>;
};
const rate = g.__odataRate ?? (g.__odataRate = new Map());
const cache = g.__odataCache ?? (g.__odataCache = new Map());

/** Минутын цонхонд хэрэглэгч тутамд RATE_LIMIT_PER_MINUTE хүсэлт. Cache-ээс хариулсан хүсэлтийг ч тоолно. */
export function consumeRate(userId: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
  if (rate.size > 5000) for (const [k, v] of rate) if (now - v.windowStart >= WINDOW_MS) rate.delete(k);
  const cur = rate.get(userId);
  if (!cur || now - cur.windowStart >= WINDOW_MS) {
    rate.set(userId, { count: 1, windowStart: now });
    return { ok: true };
  }
  if (cur.count >= RATE_LIMIT_PER_MINUTE) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((cur.windowStart + WINDOW_MS - now) / 1000)) };
  cur.count += 1;
  return { ok: true };
}

export function cacheGet<T>(key: string, now = Date.now()): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet(key: string, value: unknown, now = Date.now()) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
    // Map нь оруулсан дарааллаа хадгалдаг: хамгийн хуучныг нь хасна
    while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
}

/** Зөвхөн тестэд */
export function resetLimits() {
  rate.clear();
  cache.clear();
}
