// «Мөнгөн хөрөнгө» таб: сарын орлого, зарлага, дотоод шилжүүлэг, эхний/эцсийн үлдэгдэл. Зөвхөн 1С-ээс УНШИНА (OData, GET).
// Өмнөх эх сурвалж (1С /hs/dash/cash, onec_cash) зарлагыг үргэлж 0 гаргадаг байсан тул ашиглагдахгүй (код нь хэвээр, устгаагүй).
//
// Эх сурвалж: AccountingRegister_Хозрасчетный
//  * RecordsWithExtDimensions (StartPeriod..EndPeriod) - Дт эсвэл Кт нь мөнгөний данс (CASH_PREFIXES: 10xx, 11xx) байх бичилтүүд.
//    Дт мөнгөний данс, Кт өөр данс = ОРЛОГО; Кт мөнгөний данс, Дт өөр данс = ЗАРЛАГА; хоёулаа мөнгөний данс (касс↔банк, банк↔банк,
//    валют хөрвүүлэлт) = ДОТООД ШИЛЖҮҮЛЭГ: орлого, зарлагад тооцогдохгүй, тусад нь харагдана.
//  * Balance(Period) - эхний (сарын 1-ний 00:00:00) ба эцсийн (дараа өдрийн 00:00:00, lib/onec/dates.ts balanceBoundary) үлдэгдэл.
//    Эхний үлдэгдэл + орлого - зарлага ± шилжүүлэг = эцсийн үлдэгдэл гэж тулгана (scripts/onec-cash-check.ts нь 1С-ийн Turnovers-тай мөн тулгана).
// Данс бүр: банкны данс (ExtDimension Catalog_БанковскиеСчета) тус тусдаа, байхгүй бол дансны кодоор.
import { cachedLoad, type CacheMeta } from "./odata-cache";
import { asOfDate, balanceBoundary, monthRange } from "./dates";
import { enc, lookupRows, num, odataRows, OdataError, realKey, type Row } from "./odata-read";

const REGISTER = "AccountingRegister_Хозрасчетный";
const CHART = "ChartOfAccounts_Хозрасчетный";
const BANK = "Catalog_БанковскиеСчета";
const FLOW = "Catalog_СтатьиДвиженияДенежныхСредств";
const PARTY = "Catalog_Контрагенты";
const TOP = 100_000;
const RECENT_LIMIT = 200;
const COUNTERPART_LIMIT = 20;

/**
 * Мөнгөний дансны кодын угтвар: 10xx (касс: 1001 «Касс дахь бэлэн мөнгө») ба 11xx (харилцах, банк, хугацаагүй хадгаламж, валют).
 * Хоёр бүлгийн хоорондын шилжүүлэг (касс↔банк) дотоод шилжүүлэг болно.
 */
export const CASH_PREFIXES: readonly string[] = ["10", "11"];

export type CashEntryType = "inflow" | "outflow" | "internal";

export interface CashEntry {
  id: string;
  date: string;
  type: CashEntryType;
  /** мөнгөний данс (банкны данс); шилжүүлгийн хувьд зарлагадсан тал */
  account: string;
  /** харьцсан харилцагч эсвэл данс; шилжүүлгийн хувьд хүлээн авсан данс */
  counterpart: string;
  /** мөнгөн гүйлгээний зүйл */
  article: string;
  memo: string;
  document: string;
  amount: number;
}
export interface CashAccount {
  key: string;
  name: string;
  /** дансны код, жишээ 1101 */
  code: string;
  opening: number;
  inflow: number;
  outflow: number;
  transfersIn: number;
  transfersOut: number;
  closing: number;
  /** эцсийн үлдэгдэл - (эхний + орлого - зарлага + шилжүүлэг орсон - гарсан): 0 байх ёстой */
  difference: number;
}
export interface CashCounterpart {
  key: string;
  name: string;
  /** харьцсан дансны код */
  account: string;
  inflow: number;
  outflow: number;
}
export interface CashResult {
  month: string;
  /** эцсийн үлдэгдлийн өдөр (одоогийн сар бол өнөөдөр) */
  asOf: string;
  totals: { opening: number; inflow: number; outflow: number; internal: number; closing: number; expectedClosing: number; difference: number; entries: number };
  accounts: CashAccount[];
  daily: { date: string; inflow: number; outflow: number }[];
  byCounterpart: CashCounterpart[];
  transfers: CashEntry[];
  recent: CashEntry[];
}

export interface CashInputs {
  month: string;
  asOf: string;
  /** мөнгөний дансууд: GUID -> {code, name} */
  accounts: Map<string, { code: string; name: string }>;
  records: Row[];
  opening: Row[];
  closing: Row[];
  names: {
    banks: Map<string, string>;
    flows: Map<string, string>;
    parties: Map<string, string>;
    /** харьцсан дансууд (мөнгөний бус ч): GUID -> {code, name} */
    chart: Map<string, { code: string; name: string }>;
  };
}

const UNKNOWN = "Тодорхойгүй";
const round2 = (v: number) => Math.round(v * 100) / 100;
const lower = (v: unknown) => String(v ?? "").toLowerCase();
const codeKey = (code: string) => code.replace(/\..*$/, "").trim(); // "1101.00" -> "1101"

/** ExtDimension1..3-ийн дунд тухайн төрлийн (Catalog_…) утга. prefix: "ExtDimensionDr" | "ExtDimensionCr" | "ExtDimension" */
function dim(r: Row, prefix: string, type: string): string | null {
  for (const n of [1, 2, 3]) {
    if (String(r[`${prefix}${n}_Type`] ?? "").endsWith(type)) return realKey(r[`${prefix}${n}`]);
  }
  return null;
}

const DOCUMENT_LABELS: Record<string, string> = {
  ПоступлениеНаРасчетныйСчет: "Банкны орлого",
  СписаниеСРасчетногоСчета: "Банкны зарлага",
  ПриходныйКассовыйОрдер: "Кассын орлого",
  РасходныйКассовыйОрдер: "Кассын зарлага",
  ПлатежноеПоручениеИсходящее: "Төлбөрийн даалгавар",
  ПоступлениеТоваровУслуг: "Худалдан авалт",
  РеализацияТоваровУслуг: "Борлуулалт",
  ОперацияБух: "Гараар оруулсан бичилт",
  ВводНачальныхОстатков: "Эхний үлдэгдэл",
};
const documentLabel = (recorderType: unknown) => DOCUMENT_LABELS[String(recorderType ?? "").replace(/^.*Document_/, "")] ?? "Бусад баримт";

/** Цэвэр нэгтгэл (тестлэгдэнэ): 1С-ийн бичилт, үлдэгдлээс тайланг бүтээнэ. Техникийн нэр (Catalog_, _Key) гарахгүй. */
export function buildCash({ month, asOf, accounts, records, opening, closing, names }: CashInputs): CashResult {
  const cashAcct = (guid: unknown) => accounts.get(lower(guid));
  const bankName = (guid: string | null) => (guid ? names.banks.get(guid) : undefined);

  // Мөнгөний дансны түлхүүр: банкны данс (GUID) эсвэл дансны код
  const keyOf = (acc: { code: string; name: string }, bank: string | null) => (bank ? { key: `bank:${bank}`, name: bankName(bank) || acc.name, code: codeKey(acc.code) } : { key: `acct:${codeKey(acc.code)}`, name: acc.name, code: codeKey(acc.code) });
  const rows = new Map<string, CashAccount>();
  const row = (k: { key: string; name: string; code: string }) => {
    let a = rows.get(k.key);
    if (!a) {
      a = { key: k.key, name: k.name, code: k.code, opening: 0, inflow: 0, outflow: 0, transfersIn: 0, transfersOut: 0, closing: 0, difference: 0 };
      rows.set(k.key, a);
    }
    return a;
  };

  for (const [list, field] of [[opening, "opening"], [closing, "closing"]] as const) {
    for (const r of list) {
      const acc = cashAcct(r.Account_Key);
      if (!acc) continue;
      row(keyOf(acc, dim(r, "ExtDimension", BANK)))[field] += num(r["СуммаBalance"]);
    }
  }

  const daily = new Map<string, { inflow: number; outflow: number }>();
  const byCp = new Map<string, CashCounterpart>();
  const entries: CashEntry[] = [];
  const transfers: CashEntry[] = [];
  let inflow = 0;
  let outflow = 0;
  let internal = 0;

  for (const r of records) {
    const dr = cashAcct(r.AccountDr_Key);
    const cr = cashAcct(r.AccountCr_Key);
    if (!dr && !cr) continue;
    const amount = num(r["Сумма"]);
    const date = String(r.Period ?? "").slice(0, 10);
    const id = `${String(r.Recorder ?? "")}:${String(r.LineNumber ?? "")}`;
    const article = (names.flows.get(dim(r, dr ? "ExtDimensionDr" : "ExtDimensionCr", FLOW) ?? "") ?? "") || "";
    const base = { id, date, article, memo: String(r["Содержание"] ?? "").trim(), document: documentLabel(r.Recorder_Type), amount: round2(amount) };

    if (dr && cr) {
      const to = keyOf(dr, dim(r, "ExtDimensionDr", BANK));
      const from = keyOf(cr, dim(r, "ExtDimensionCr", BANK));
      row(to).transfersIn += amount;
      row(from).transfersOut += amount;
      internal += amount;
      transfers.push({ ...base, type: "internal", account: from.name, counterpart: to.name });
      continue;
    }

    // орлого: Дт мөнгөний данс; зарлага: Кт мөнгөний данс. Харьцсан тал нь нөгөө данс
    const income = !!dr;
    const cash = (income ? dr : cr)!;
    const side = income ? "ExtDimensionDr" : "ExtDimensionCr";
    const otherSide = income ? "ExtDimensionCr" : "ExtDimensionDr";
    const k = keyOf(cash, dim(r, side, BANK));
    const a = row(k);
    const otherAcc = names.chart.get(lower(income ? r.AccountCr_Key : r.AccountDr_Key));
    const party = dim(r, otherSide, PARTY);
    const cpName = (party && names.parties.get(party)) || otherAcc?.name || UNKNOWN;
    const cpKey = party ?? `acct:${otherAcc ? codeKey(otherAcc.code) : ""}`;

    if (income) {
      a.inflow += amount;
      inflow += amount;
    } else {
      a.outflow += amount;
      outflow += amount;
    }
    const d = daily.get(date) ?? { inflow: 0, outflow: 0 };
    d[income ? "inflow" : "outflow"] += amount;
    daily.set(date, d);
    const cp = byCp.get(cpKey) ?? { key: cpKey, name: cpName, account: otherAcc ? codeKey(otherAcc.code) : "", inflow: 0, outflow: 0 };
    cp[income ? "inflow" : "outflow"] += amount;
    byCp.set(cpKey, cp);
    entries.push({ ...base, type: income ? "inflow" : "outflow", account: k.name, counterpart: cpName });
  }

  const accountRows = [...rows.values()]
    .map((a) => {
      const expected = a.opening + a.inflow - a.outflow + a.transfersIn - a.transfersOut;
      return {
        ...a,
        opening: round2(a.opening),
        inflow: round2(a.inflow),
        outflow: round2(a.outflow),
        transfersIn: round2(a.transfersIn),
        transfersOut: round2(a.transfersOut),
        closing: round2(a.closing),
        difference: round2(a.closing - expected),
      };
    })
    .filter((a) => a.opening || a.inflow || a.outflow || a.transfersIn || a.transfersOut || a.closing)
    .sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing) || a.name.localeCompare(b.name, "mn"));

  const sum = (f: (a: CashAccount) => number) => accountRows.reduce((s, a) => s + f(a), 0);
  const totalOpening = sum((a) => a.opening);
  const totalClosing = sum((a) => a.closing);
  // Дотоод шилжүүлгийн орсон, гарсан нийлбэр тэнцүү тул нийтийн тулгалтад нөлөөлөхгүй (ханш, валютын зөрүү л үлдэнэ)
  const expected = totalOpening + inflow - outflow + (sum((a) => a.transfersIn) - sum((a) => a.transfersOut));

  const { from, to } = monthRange(month);
  const days: { date: string; inflow: number; outflow: number }[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, inflow: round2(daily.get(key)?.inflow ?? 0), outflow: round2(daily.get(key)?.outflow ?? 0) });
  }

  const byDateDesc = (a: CashEntry, b: CashEntry) => b.date.localeCompare(a.date) || b.amount - a.amount;
  return {
    month,
    asOf,
    totals: {
      opening: round2(totalOpening),
      inflow: round2(inflow),
      outflow: round2(outflow),
      internal: round2(internal),
      closing: round2(totalClosing),
      expectedClosing: round2(expected),
      difference: round2(totalClosing - expected),
      entries: entries.length + transfers.length,
    },
    accounts: accountRows,
    daily: days,
    byCounterpart: [...byCp.values()]
      .map((c) => ({ ...c, inflow: round2(c.inflow), outflow: round2(c.outflow) }))
      .sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow))
      .slice(0, COUNTERPART_LIMIT),
    transfers: transfers.sort(byDateDesc),
    recent: entries.sort(byDateDesc).slice(0, RECENT_LIMIT),
  };
}

/** Дансны төлөвлөгөөнөөс мөнгөний дансууд (код нь «1101.00» хэлбэртэй): угтвар бүрээр серверийн шүүлтээр, эрэмбэгүй хуудаслахгүй */
async function fetchCashAccounts(): Promise<Map<string, { code: string; name: string }>> {
  const out = new Map<string, { code: string; name: string }>();
  for (const prefix of CASH_PREFIXES) {
    const rows = await odataRows(`${enc(CHART)}?$format=json&$select=${enc("Ref_Key,Code,Description")}&$filter=${enc(`startswith(Code,'${prefix}')`)}&$top=500`);
    for (const r of rows) out.set(lower(r.Ref_Key), { code: String(r.Code ?? ""), name: String(r.Description ?? "") });
  }
  return out;
}

const orChain = (field: string, keys: readonly string[]) => keys.map((k) => `${field} eq guid'${k}'`).join(" or ");

/** 1С-ээс сарын мөнгөн хөрөнгийг татна (бүх хүсэлт GET) */
export async function fetchCash(month: string): Promise<CashResult> {
  const { from, to } = monthRange(month);
  const asOf = asOfDate(month);
  const accounts = await fetchCashAccounts();
  if (accounts.size === 0) throw new OdataError(502, "Мөнгөний данс 1С-ээс олдсонгүй");
  const keys = [...accounts.keys()];

  const balance = (period: string) =>
    odataRows(`${enc(REGISTER)}/Balance(Period=datetime'${period}')?$format=json&$filter=${enc(`(${orChain("Account_Key", keys)})`)}&$top=20000`, { timeoutMs: 60_000 });
  const [records, opening, closing] = await Promise.all([
    odataRows(
      `${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Top=${TOP})?$format=json&$filter=${enc(`(${orChain("AccountDr_Key", keys)}) or (${orChain("AccountCr_Key", keys)})`)}`,
      { timeoutMs: 60_000 }
    ),
    balance(`${from}T00:00:00`),
    balance(balanceBoundary(asOf)),
  ]);
  if (records.length >= TOP) throw new OdataError(502, "Мөнгөн хөрөнгийн бичилт хэт олон байна. Админд хандана уу");

  const all = [...records, ...opening, ...closing];
  const keyList = (rows: Row[], prefixes: string[], type: string) => {
    const set = new Set<string>();
    for (const r of rows) for (const p of prefixes) for (const n of [1, 2, 3]) if (String(r[`${p}${n}_Type`] ?? "").endsWith(type)) { const k = realKey(r[`${p}${n}`]); if (k) set.add(k); }
    return [...set];
  };
  const chartKeys = [...new Set(records.flatMap((r) => [realKey(r.AccountDr_Key), realKey(r.AccountCr_Key)]).filter((k): k is string => !!k && !accounts.has(k)))];
  const [banks, flows, parties, chart] = await Promise.all([
    lookupRows(BANK, keyList(all, ["ExtDimensionDr", "ExtDimensionCr", "ExtDimension"], BANK), "Description,НомерСчета"),
    lookupRows(FLOW, keyList(records, ["ExtDimensionDr", "ExtDimensionCr"], FLOW), "Description"),
    lookupRows(PARTY, keyList(records, ["ExtDimensionDr", "ExtDimensionCr"], PARTY), "Description"),
    lookupRows(CHART, chartKeys, "Code,Description"),
  ]);
  const text = (m: Map<string, Row | null>, f: (r: Row) => string) => new Map([...m].map(([k, r]) => [k, r ? f(r) : ""]));
  const chartMap = new Map<string, { code: string; name: string }>(accounts);
  for (const [k, r] of chart) if (r) chartMap.set(k, { code: String(r.Code ?? ""), name: String(r.Description ?? "") });

  return buildCash({
    month,
    asOf,
    accounts,
    records,
    opening,
    closing,
    names: {
      banks: text(banks, (r) => String(r.Description ?? "").trim() || String(r["НомерСчета"] ?? "").trim()),
      flows: text(flows, (r) => String(r.Description ?? "").trim()),
      parties: text(parties, (r) => String(r.Description ?? "").trim()),
      chart: chartMap,
    },
  });
}

/** 5 минутын cache-тай (өдөр бүр тусдаа түлхүүр: одоогийн сарын эцсийн үлдэгдэл өдөр бүр өөр) */
export function loadCash(month: string, refresh = false): Promise<{ value: CashResult; meta: CacheMeta }> {
  return cachedLoad(`cash:${month}:${asOfDate(month)}`, () => fetchCash(month), { refresh });
}
