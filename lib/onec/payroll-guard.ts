// Цалингийн нууцлал: canViewPayroll-гүй хэрэглэгчид цалингийн дансны (3340-3349, 3450, 3462, 3463, 1243, 1249, 1295) бичилт,
// тэдгээртэй холбогдсон баримтын хүний нэр, утга (memo) харагдахгүй. Нийт дүн (тулгалт) өөрчлөгдөхгүй: мөрүүд нэг «Цалин олголт (нэгтгэсэн)» мөр болно.
// Шүүлтийг СЕРВЕР дээр хийнэ (клиентийн нуусан талбарт найдахгүй). Энэ файл 1С-ээс зөвхөн унших (GET) дуудлага хийнэ.
import { loadAccountBook, shortCode, type AccountBook } from "./accounts";
import { cachedLoad } from "./odata-cache";
import { enc, fetchPaged, type Row } from "./odata-read";
import type { DocCard } from "./doc-kinds";

export const PAYROLL_LABEL = "Цалин олголт (нэгтгэсэн)";

const REGISTER_RECORDS = "AccountingRegister_Хозрасчетный_RecordType";
const PAYROLL_ACCOUNT = /^(334\d|3450|3462|3463|1243|1249|1295)(\.|$)/;
const lower = (v: unknown) => String(v ?? "").toLowerCase();

/** "3342.00" -> true; дэд данс (3450.01) мөн орно */
export const isPayrollAccount = (code: string | null | undefined): boolean => PAYROLL_ACCOUNT.test(shortCode(String(code ?? "")));

export function payrollAccountKeys(book: AccountBook): Set<string> {
  const out = new Set<string>();
  for (const a of book.byKey.values()) if (isPayrollAccount(a.code)) out.add(a.key);
  return out;
}

/** Бичилтийн аль нэг тал нь цалингийн данс бол true (Дт/Кт түлхүүр, GUID) */
export const isPayrollRecord = (r: Row, keys: ReadonlySet<string>): boolean => keys.has(lower(r.AccountDr_Key)) || keys.has(lower(r.AccountCr_Key));

/**
 * OData шүүлт: өгсөн талбар бүрд цалингийн данс БИШ байх (`AccountDr_Key ne guid'..' and ...`). Түлхүүр байхгүй бол алдаа:
 * цалингийн дансыг тодорхойлж чадаагүй бол шүүлтгүй өгөгдөл өгөхгүй (fail-closed).
 */
export function notPayrollFilter(keys: ReadonlySet<string>, fields: readonly string[]): string {
  if (keys.size === 0) throw new Error("Цалингийн данс олдсонгүй");
  return fields.map((f) => [...keys].map((k) => `${f} ne guid'${k}'`).join(" and ")).join(" and ");
}

const orChain = (field: string, keys: ReadonlySet<string>) => [...keys].map((k) => `${field} eq guid'${k}'`).join(" or ");

/** Хугацааны хүрээнд цалингийн дансны бичилттэй баримтуудын (Recorder) GUID-ууд. 20000-аас олон бол алдаа (fail-closed). */
export async function fetchPayrollRecorders(book: AccountBook, from: string, to: string): Promise<Set<string>> {
  const keys = payrollAccountKeys(book);
  if (keys.size === 0) throw new Error("Цалингийн данс олдсонгүй");
  const filter = `Period ge datetime'${from}T00:00:00' and Period le datetime'${to}T23:59:59' and ((${orChain("AccountDr_Key", keys)}) or (${orChain("AccountCr_Key", keys)}))`;
  const rows = await fetchPaged(REGISTER_RECORDS, `$select=${enc("Recorder")}&$filter=${enc(filter)}&$orderby=${enc("Period")}`, 500, 40);
  return new Set(rows.map((r) => lower(r.Recorder)).filter(Boolean));
}

/** 5 минутын cache-тай (баримтын жагсаалтын cache-тэй хамт). Идэвхтэй оны баазын контекстод дуудна. */
export async function loadPayrollRecorders(from: string, to: string): Promise<Set<string>> {
  const { value } = await cachedLoad(`payrollrec:${from}:${to}`, async () => fetchPayrollRecorders(await loadAccountBook(), from, to));
  return value;
}

/**
 * Баримтын картуудаас цалингийн бичилттэй баримтыг (recorders) өдөр, төрлөөр нэг «Цалин олголт (нэгтгэсэн)» карт болгоно:
 * хүний нэр, гүйлгээний утга, баримтын дугаар, лавлагаа (нээх боломж) гарахгүй; дүнгийн нийлбэр өөрчлөгдөхгүй.
 */
export function redactPayrollCards(cards: readonly DocCard[], recorders: ReadonlySet<string>): DocCard[] {
  const out: DocCard[] = [];
  const merged = new Map<string, DocCard>();
  for (const c of cards) {
    if (!recorders.has(c.ref.toLowerCase())) {
      out.push(c);
      continue;
    }
    const key = `${c.date.slice(0, 10)}|${c.type}`;
    const cur = merged.get(key);
    if (cur) {
      cur.amount = Math.round((cur.amount + c.amount) * 100) / 100;
      continue;
    }
    const agg: DocCard = { ...c, ref: "", number: "", party: PAYROLL_LABEL, partyCode: "", warehouse: "", warehouseCode: "", warehouseTo: "", warehouseToCode: "", lines: null, comment: "" };
    merged.set(key, agg);
    out.push(agg);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}
