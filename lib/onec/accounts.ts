// Дансны төлөвлөгөө (ChartOfAccounts_Хозрасчетный): дансны НЭР. Хэрэглэгчид код биш нэр харагдана, код нь зөвхөн tooltip-д.
// Зөвхөн 1С-ээс УНШИНА (GET). Нэрийг 1 цаг cache-лэнэ; тухайн оны баазаар тусдаа (ONEC_BASES).
import { defaultYear } from "./bases";
import { enc, fetchPaged } from "./odata-read";
import { activeOneCYear } from "./year-context";

const CHART = "ChartOfAccounts_Хозрасчетный";
export const ACCOUNT_TTL_MS = 60 * 60_000;

export interface AccountInfo {
  key: string;
  /** "1101.00" -> "1101" */
  code: string;
  name: string;
}

export interface AccountBook {
  byKey: Map<string, AccountInfo>;
  byCode: Map<string, AccountInfo>;
}

const g = globalThis as unknown as { __onecAccounts?: Map<string, { at: number; book: AccountBook }>; __onecAccountsInflight?: Map<string, Promise<AccountBook>> };
const store = g.__onecAccounts ?? (g.__onecAccounts = new Map());
const inflight = g.__onecAccountsInflight ?? (g.__onecAccountsInflight = new Map());

/** "1101.00" -> "1101"; "1415.03" -> "1415.03" (дэд данс өөрийн кодтой) */
export const shortCode = (code: string): string => code.replace(/\.00$/, "").trim();

/** Цэвэр: 1С-ийн мөрүүдээс дансны жагсаалт бүтээнэ (тестлэгдэнэ) */
export function buildAccountBook(rows: { Ref_Key?: unknown; Code?: unknown; Description?: unknown }[]): AccountBook {
  const byKey = new Map<string, AccountInfo>();
  const byCode = new Map<string, AccountInfo>();
  for (const r of rows) {
    const key = String(r.Ref_Key ?? "").toLowerCase();
    if (!key) continue;
    const info: AccountInfo = { key, code: shortCode(String(r.Code ?? "")), name: String(r.Description ?? "").replace(/\s+/g, " ").trim() };
    byKey.set(key, info);
    byCode.set(info.code, info);
  }
  return { byKey, byCode };
}

export async function loadAccountBook(now = Date.now()): Promise<AccountBook> {
  const yr = activeOneCYear() ?? defaultYear();
  const key = String(yr ?? "");
  const hit = store.get(key);
  if (hit && now - hit.at < ACCOUNT_TTL_MS) return hit.book;
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const rows = await fetchPaged(CHART, `$select=${enc("Ref_Key,Code,Description")}&$orderby=Ref_Key`, 500, 10);
      const book = buildAccountBook(rows);
      store.set(key, { at: Date.now(), book });
      return book;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    return await pending;
  } catch (e) {
    if (hit) return hit.book; // 1С алдаа өгвөл хуучин (stale) нэрсийг ашиглана
    throw e;
  }
}

/** Дансны нэр (олдохгүй бол "Данс"): код нь tooltip-д */
export function accountRef(book: AccountBook, key: unknown): { name: string; code: string } {
  const a = book.byKey.get(String(key ?? "").toLowerCase());
  return a ? { name: a.name || "Данс", code: a.code } : { name: "Данс", code: "" };
}

/** Дансны код (угтвартай, жишээ "14") -> тэдгээр дансны түлхүүрүүд */
export function keysWithPrefix(book: AccountBook, prefix: string): string[] {
  return [...book.byKey.values()].filter((a) => a.code.startsWith(prefix)).map((a) => a.key);
}

/** Зөвхөн тестэд */
export function resetAccountBook() {
  store.clear();
  inflight.clear();
}
