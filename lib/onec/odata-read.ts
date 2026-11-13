// Самбарын OData унших туслах функцүүд. ЗӨВХӨН УНШИХ (GET): lib/onec-odata/client.ts-ийн odataGet-ээр. Объектын нэр, шүүлтийг энд
// сервер өөрөө бүтээнэ (хэрэглэгчийн текст URL-д орохгүй); GUID-ийг оруулахаас өмнө шалгана.
import { odataGet, OdataError } from "@/lib/onec-odata/client";
import { defaultYear } from "./bases";
import { activeOneCYear } from "./year-context";

export { OdataError };
export type Row = Record<string, unknown>;

export const enc = encodeURIComponent;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/** Бодит лавлах холбоос (хоосон GUID биш) бол GUID, үгүй бол null */
export const realKey = (v: unknown): string | null => (typeof v === "string" && GUID.test(v) && v !== EMPTY_GUID ? v.toLowerCase() : null);
export const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function odataRows(path: string, opts?: { timeoutMs?: number }): Promise<Row[]> {
  let data: unknown;
  try {
    data = JSON.parse(await odataGet(path, "json", opts));
  } catch (e) {
    if (e instanceof OdataError) throw e;
    throw new OdataError(502, "1С-ийн хариуг уншиж чадсангүй");
  }
  const value = (data as { value?: unknown }).value;
  if (!Array.isArray(value)) throw new OdataError(502, "1С-ийн хариу хүлээсэн хэлбэртэй биш байна");
  return value as Row[];
}

/** Entity set-ийн бүх мөр ($skip-ээр хуудаслана; нэг хуудас дүүрэн биш болтол). Хэт олон бол алдаа: хязгааргүй татахгүй. */
export async function fetchPaged(entity: string, query: string, pageSize = 500, maxPages = 40): Promise<Row[]> {
  const all: Row[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await odataRows(`${enc(entity)}?$format=json&${query}&$top=${pageSize}&$skip=${page * pageSize}`);
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
  throw new OdataError(502, "1С-ээс хэт олон мөр ирлээ");
}

/** `Ref_Key eq guid'…' or …` (GUID бүр шалгагдсан) */
export function refKeyFilter(keys: readonly string[]): string {
  return keys
    .map((k) => {
      if (!GUID.test(k)) throw new Error("Буруу GUID");
      return `Ref_Key eq guid'${k}'`;
    })
    .join(" or ");
}

// ---- лавлахын нэр (1 цаг cache): GUID -> нэр ----
const NAME_TTL_MS = 60 * 60_000;
const NAME_BATCH = 25;
const LOOKUP_CONCURRENCY = 4;
const g = globalThis as unknown as { __onecNames?: Map<string, { at: number; row: Row | null }> };
const nameCache = g.__onecNames ?? (g.__onecNames = new Map());

/** Лавлахаас түлхүүрээр нь мөр авна (Description г.м.). Олдоогүй түлхүүр null; ижил түлхүүрийг 1 цаг дахин асуухгүй. */
export async function lookupRows(catalog: string, keys: readonly string[], select: string): Promise<Map<string, Row | null>> {
  const now = Date.now();
  const yr = activeOneCYear() ?? defaultYear(); // баазууд өөр өөр: нэрийн кэш оны хувьд тусдаа
  const out = new Map<string, Row | null>();
  const missing: string[] = [];
  for (const k of new Set(keys)) {
    const hit = nameCache.get(`${yr}|${catalog}:${k}`);
    if (hit && now - hit.at < NAME_TTL_MS) out.set(k, hit.row);
    else missing.push(k);
  }
  // Багцуудыг 4-өөр зэрэг асууна (дараалан асуухад 20 багц ~0.3 сек; 1С-ийг шахахгүйн тулд дээд тал нь 4)
  for (const group of chunks(chunks(missing, NAME_BATCH), LOOKUP_CONCURRENCY)) {
    await Promise.all(
      group.map(async (batch) => {
        const rows = await odataRows(`${enc(catalog)}?$format=json&$select=${enc(`Ref_Key,${select}`)}&$filter=${enc(refKeyFilter(batch))}`);
        const byKey = new Map(rows.map((r) => [String(r.Ref_Key).toLowerCase(), r]));
        for (const k of batch) {
          const row = byKey.get(k) ?? null;
          nameCache.set(`${yr}|${catalog}:${k}`, { at: now, row });
          out.set(k, row);
        }
      })
    );
  }
  return out;
}

/** Зөвхөн тестэд */
export function resetNameCache() {
  nameCache.clear();
}
