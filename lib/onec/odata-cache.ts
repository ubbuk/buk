// OData табуудын 5 минутын cache. «Шинэчлэх» товч cache-ийг тойрно, гэхдээ 1С-ийг ачаалахгүйн тулд хамгийн багадаа 60 сек тутамд.
// Нэг түлхүүрийг зэрэг олон хүн нээвэл нэг л хүсэлт 1С руу очно (in-flight дундын promise). 1С алдаа өгвөл хуучин (stale) өгөгдлийг буцаана.
export const TTL_MS = 5 * 60_000;
export const MIN_REFRESH_MS = 60_000;
const MAX_ENTRIES = 60;

interface Entry {
  value: unknown;
  at: number;
}
const g = globalThis as unknown as { __onecOdataCache?: Map<string, Entry>; __onecOdataInflight?: Map<string, Promise<Entry>> };
const store = g.__onecOdataCache ?? (g.__onecOdataCache = new Map());
const inflight = g.__onecOdataInflight ?? (g.__onecOdataInflight = new Map());

export interface CacheMeta {
  /** 1С-ээс сүүлд татсан цаг (ms) */
  fetchedAt: number;
  cached: boolean;
  /** 1С алдаа өгсөн тул хуучин өгөгдөл харагдаж байна */
  stale: boolean;
  /** «Шинэчлэх» хязгаарт орсон: хэдэн секундийн дараа дахин боломжтой */
  retryAfterSeconds?: number;
}

export async function cachedLoad<T>(key: string, load: () => Promise<T>, opts: { refresh?: boolean; now?: () => number } = {}): Promise<{ value: T; meta: CacheMeta }> {
  const now = opts.now ?? Date.now;
  const hit = store.get(key);
  const age = hit ? now() - hit.at : Infinity;

  if (hit && age < TTL_MS) {
    if (!opts.refresh) return { value: hit.value as T, meta: { fetchedAt: hit.at, cached: true, stale: false } };
    if (age < MIN_REFRESH_MS) {
      return { value: hit.value as T, meta: { fetchedAt: hit.at, cached: true, stale: false, retryAfterSeconds: Math.max(1, Math.ceil((MIN_REFRESH_MS - age) / 1000)) } };
    }
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const value = await load();
      const entry = { value, at: now() };
      if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
      store.set(key, entry);
      return entry;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    const entry = await pending;
    return { value: entry.value as T, meta: { fetchedAt: entry.at, cached: false, stale: false } };
  } catch (e) {
    if (hit) return { value: hit.value as T, meta: { fetchedAt: hit.at, cached: true, stale: true } };
    throw e;
  }
}

/** Зөвхөн тестэд */
export function resetOdataCache() {
  store.clear();
  inflight.clear();
}
