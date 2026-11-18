// 1С-ийн баримтууд: жагсаалт (карт), дэлгэрэнгүй (drawer), барааны түүх. ЗӨВХӨН УНШИХ (OData GET): lib/onec/odata-read.ts-ийн odataRows-оор.
// Баримтыг (төрөл, GUID)-аар тодорхойлно: дугаар нь төрөл хооронд давхардана (УБ00-002244 нь орлого, борлуулалт, шаардах хуудас гурван өөр баримт).
// Хэрэглэгчид 1С-ийн техникийн нэр (Document_, Catalog_, _Key, GUID) харагдахгүй: бүх нэрийг лавлахаас (1 цагийн cache) шийднэ.
import { accountRef, keysWithPrefix, loadAccountBook, shortCode, type AccountBook } from "./accounts";
import { DOC_KINDS, entityLabel, entityOfRecorderType, entityTone, kindByEntity, type DocCard, type DocDetail, type DocKind, type DocLine, type DocPosting, type ItemHistory, type ItemHistoryRow } from "./doc-kinds";
import { balanceBoundary, monthRange, monthsBetween, nextDay, today } from "./dates";
import { odataGet } from "@/lib/onec-odata/client";
import { configuredYears, multiYear } from "./bases";
import { cachedLoad, type CacheMeta } from "./odata-cache";
import { chunks, enc, fetchPaged, lookupRows, num, odataRows, OdataError, realKey, type Row } from "./odata-read";
import { isPayrollRecord, loadPayrollRecorders, PAYROLL_LABEL, payrollAccountKeys, redactPayrollCards } from "./payroll-guard";
import { withOneCYear, yearOf } from "./year-context";

const REGISTER = "AccountingRegister_Хозрасчетный";
const ITEM_TYPE = "Catalog_Номенклатура";
const STOCK_ACCOUNT_PREFIX = "14";
const REGISTER_TOP = 100_000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 1С-ийн баримтын нэр: зөвхөн үсэг, тоо, _ (URL, шүүлтэд шууд орохоос өмнө шалгана) */
const ENTITY_RE = /^[\p{L}\d_]{1,80}$/u;
const CODE_RE = /^[\p{L}\d\-_./ ]{1,40}$/u;

export const MAX_LIST_DAYS = 100;
export const MAX_HISTORY_MONTHS = 6;

const round2 = (v: number) => Math.round(v * 100) / 100;
const text = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => String(v ?? "").toLowerCase();

interface Spec {
  /** мөр бүхий хүснэгтэн хэсгүүд (Товары, Услуги ...) */
  tables: string[];
  warehouse?: string;
  warehouseTo?: string;
  /** лавлахын түлхүүр талбар (Контрагент_Key) */
  party?: string;
  /** холбоос + төрөл (Контрагент, Контрагент_Type): зөвхөн Контрагенты бол харилцагчийн нэр */
  partyComposite?: string;
  department?: string[];
  amount?: string;
  vatIncluded?: string;
  /** баримт өөрөө өртөг хадгалдаггүй: дүнг нягтлан бодох бүртгэлээс авна */
  ledgerCost?: boolean;
  bankAccount?: string;
  purpose?: string;
}

const SPECS: Record<DocKind, Spec> = {
  receipt: { tables: ["Товары", "Услуги"], warehouse: "Склад_Key", party: "Контрагент_Key", amount: "СуммаДокумента", vatIncluded: "СуммаВключаетНДС" },
  requisition: { tables: ["Материалы"], warehouse: "Склад_Key", partyComposite: "Получатель", department: ["ПодразделениеЗатрат_Key", "ПодразделениеОрганизации_Key"], ledgerCost: true },
  writeoff: { tables: ["Товары"], warehouse: "Склад_Key", amount: "СуммаДокумента", department: ["ПодразделениеЗатрат_Key", "ПодразделениеОрганизации_Key"] },
  transfer: { tables: ["Товары"], warehouse: "СкладОтправитель_Key", warehouseTo: "СкладПолучатель_Key", ledgerCost: true },
  sale: { tables: ["Товары", "Услуги"], warehouse: "Склад_Key", party: "Контрагент_Key", amount: "СуммаДокумента", vatIncluded: "СуммаВключаетНДС" },
  bank_in: { tables: [], partyComposite: "Контрагент", amount: "СуммаДокумента", bankAccount: "СчетОрганизации_Key", purpose: "НазначениеПлатежа" },
  bank_out: { tables: [], party: "Контрагент_Key", amount: "СуммаДокумента", bankAccount: "СчетОрганизации_Key", purpose: "НазначениеПлатежа" },
  cash_in: { tables: [], partyComposite: "Контрагент", amount: "СуммаДокумента" },
  cash_out: { tables: [], partyComposite: "Контрагент", amount: "СуммаДокумента" },
};

const fieldsOf = (s: Spec): string[] => [
  ...[s.warehouse, s.warehouseTo, s.party, s.amount, s.vatIncluded, s.bankAccount, s.purpose].filter((f): f is string => !!f),
  ...(s.partyComposite ? [s.partyComposite, `${s.partyComposite}_Type`] : []),
  ...(s.department ?? []),
];

const nameMap = (m: Map<string, Row | null>, f: string = "Description") => new Map([...m].map(([k, r]) => [k, text(r?.[f])]));
const keysOf = (rows: Row[], fields: (string | undefined)[]) => [...new Set(rows.flatMap((r) => fields.map((f) => (f ? realKey(r[f]) : null))).filter((k): k is string => !!k))];

/** Холбоос + төрөл хосоос зөвхөн харилцагчийг (Catalog_Контрагенты) авна: хувь хүн, ажилтан зэрэг нэрсийг харуулахгүй */
const contractorOf = (r: Row, composite: string | undefined): string | null => (composite && text(r[`${composite}_Type`]).endsWith("Catalog_Контрагенты") ? realKey(r[composite]) : null);

/** Баримтын төрлөөр: нягтлангийн бичилтүүд (Recorder_Type-аар шүүсэн) */
async function ledgerFor(entity: string, from: string, to: string): Promise<Row[]> {
  const cond = `Recorder_Type eq 'StandardODATA.Document_${entity}'`.replace(/'/g, "''");
  const rows = await odataRows(`${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Condition='${enc(cond)}',Top=${REGISTER_TOP})?$format=json`, { timeoutMs: 60_000 });
  if (rows.length >= REGISTER_TOP) throw new OdataError(502, "Бичилт хэт олон байна: хугацааг богиносгоно уу");
  return rows;
}

/** Баримт тус бүрийн өртөг (Кт тал, барааны субконто): Recorder(GUID) -> дүн */
function costByRecorder(records: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of records) {
    if (!text(r.ExtDimensionCr1_Type).endsWith(ITEM_TYPE)) continue;
    const k = lower(r.Recorder);
    out.set(k, (out.get(k) ?? 0) + num(r["Сумма"]));
  }
  return out;
}

export interface ListInput {
  from: string;
  to: string;
  kinds: readonly DocKind[];
  /** харилцагчийн 1С-ийн код (жишээ 00-001177) эсвэл GUID: харилцагчтай төрлүүдийг серверээр шүүнэ (харилцагчгүй төрөл хоосон) */
  partyCode?: string | null;
}

async function resolvePartyKey(code: string): Promise<string | null> {
  if (GUID.test(code)) return code.toLowerCase();
  if (!CODE_RE.test(code)) return null;
  const rows = await odataRows(`${enc("Catalog_Контрагенты")}?$format=json&$select=Ref_Key&$filter=${enc(`Code eq '${code.replace(/'/g, "''")}'`)}&$top=1`);
  return realKey(rows[0]?.Ref_Key);
}

/** Нэг төрлийн баримтын картууд (өдрийн хүрээгээр) */
async function fetchKind(kind: DocKind, from: string, to: string, partyKey: string | null): Promise<DocCard[]> {
  const info = DOC_KINDS[kind];
  const spec = SPECS[kind];
  const filters = [`Posted eq true`, `Date ge datetime'${from}T00:00:00'`, `Date lt datetime'${nextDay(to)}T00:00:00'`];
  if (partyKey) {
    // түлхүүр талбар: шууд харьцуулна; холбоос+төрөл талбар (Контрагент): cast-аар (1С зөвхөн ингэж харьцуулна)
    if (spec.party) filters.push(`${spec.party} eq guid'${partyKey}'`);
    else if (spec.partyComposite) filters.push(`${spec.partyComposite} eq cast(guid'${partyKey}', 'Catalog_Контрагенты')`);
    else return []; // харилцагчгүй төрөл (шилжүүлэг, хасалт)
  }
  const select = ["Ref_Key", "Number", "Date", "Комментарий", ...fieldsOf(spec), ...spec.tables];
  const docs = await fetchPaged(`Document_${info.entity}`, `$select=${enc(select.join(","))}&$filter=${enc(filters.join(" and "))}&$orderby=${enc("Date,Ref_Key")}`);

  const [warehouses, contractors, departments, ledger] = await Promise.all([
    lookupRows("Catalog_Склады", keysOf(docs, [spec.warehouse, spec.warehouseTo]), "Description,Code"),
    lookupRows("Catalog_Контрагенты", [...new Set(docs.flatMap((d) => [spec.party ? realKey(d[spec.party]) : null, contractorOf(d, spec.partyComposite)]).filter((k): k is string => !!k))], "Description,Code"),
    lookupRows("Catalog_ПодразделенияОрганизаций", keysOf(docs, spec.department ?? []), "Description"),
    spec.ledgerCost ? ledgerFor(info.entity, from, to) : Promise.resolve([] as Row[]),
  ]);
  const cost = costByRecorder(ledger);

  return docs.map((d) => {
    const wh = realKey(d[spec.warehouse ?? ""]);
    const whTo = realKey(d[spec.warehouseTo ?? ""]);
    const partyKey = (spec.party ? realKey(d[spec.party]) : null) ?? contractorOf(d, spec.partyComposite);
    const deptKey = (spec.department ?? []).map((f) => realKey(d[f])).find((k) => k) ?? null;
    const partyRow = partyKey ? contractors.get(partyKey) : null;
    // шаардах хуудасны «харилцагч» нь хэлтэс (хэрэглэгч түүгээр нь таньдаг)
    const party = text(partyRow?.Description) || (deptKey ? text(departments.get(deptKey)?.Description) : "");
    const lines = spec.tables.reduce((s, t) => s + (Array.isArray(d[t]) ? (d[t] as unknown[]).length : 0), 0);
    const amount = spec.amount ? num(d[spec.amount]) : (cost.get(lower(d.Ref_Key)) ?? 0);
    return {
      kind,
      type: info.entity,
      ref: lower(d.Ref_Key),
      number: text(d.Number),
      date: text(d.Date),
      label: info.label,
      tone: info.tone,
      party,
      partyCode: text(partyRow?.Code),
      warehouse: wh ? text(warehouses.get(wh)?.Description) : "",
      warehouseCode: wh ? text(warehouses.get(wh)?.Code) : "",
      warehouseTo: whTo ? text(warehouses.get(whTo)?.Description) : "",
      warehouseToCode: whTo ? text(warehouses.get(whTo)?.Code) : "",
      amount: round2(amount),
      lines: spec.tables.length ? lines : null,
      comment: text(d.Комментарий) || text(spec.purpose ? d[spec.purpose] : ""),
    } satisfies DocCard;
  });
}

/** Хугацааны хүрээнд, төрөл бүрээр (5 минутын cache). Шүүлтүүр (агуулах, төрөл, хайлт) нь клиент талд: нэг татаалтаар бүгдийг шүүнэ. */
export async function loadDocuments(input: ListInput, refresh = false): Promise<{ value: DocCard[]; meta: CacheMeta }> {
  const { from, to } = input;
  if (yearOf(from) !== yearOf(to)) throw new OdataError(400, "Хугацаа нэг оны дотор байх ёстой");
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > MAX_LIST_DAYS * 86_400_000) throw new OdataError(400, `Хугацаа ${MAX_LIST_DAYS} хоногоос хэтрэхгүй байх ёстой`);
  const party = input.partyCode?.trim() || null;
  return cachedLoad(
    `docs:${from}:${to}:${[...input.kinds].sort().join(",")}:${party ?? ""}`,
    () =>
      withOneCYear(yearOf(from), async () => {
        const partyKey = party ? await resolvePartyKey(party) : null;
        if (party && !partyKey) return [];
        // 1С-ийг ачаалахгүйн тулд төрлүүдийг 2-оор зэрэг татна
        const all: DocCard[] = [];
        for (const group of chunks([...input.kinds], 2)) all.push(...(await Promise.all(group.map((k) => fetchKind(k, from, to, partyKey)))).flat());
        return all.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
      }),
    { refresh }
  );
}

/** Данс дээр бичилт хийсэн баримтууд (Зардал таб: данс -> баримтууд). side: Дт эсвэл Кт. */
export async function loadAccountDocuments(accountCode: string, month: string, side: "debit" | "credit", refresh = false): Promise<{ value: DocCard[]; meta: CacheMeta }> {
  return cachedLoad(
    `acctdocs:${month}:${side}:${accountCode}`,
    () =>
      withOneCYear(yearOf(month), async () => {
        const book = await loadAccountBook();
        // onec_pl-д код "6101.00" хэлбэртэй байж болно: дансны жагсаалттай (shortCode) адилхан болгож, дэд дансыг (1415.03) хамтад нь авна
        const wanted = shortCode(accountCode);
        const keys = [...book.byKey.values()].filter((a) => a.code === wanted || a.code.startsWith(`${wanted}.`)).map((a) => a.key);
        if (keys.length === 0) return [];
        const { from, to } = monthRange(month);
        const field = side === "debit" ? "AccountDr_Key" : "AccountCr_Key";
        const filter = keys.map((k) => `${field} eq guid'${k}'`).join(" or ");
        const records = await odataRows(
          `${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Top=${REGISTER_TOP})?$format=json&$select=${enc("Period,Recorder,Recorder_Type,Сумма")}&$filter=${enc(`(${filter})`)}`,
          { timeoutMs: 60_000 }
        );
        if (records.length >= REGISTER_TOP) throw new OdataError(502, "Бичилт хэт олон байна");
        const per = new Map<string, { type: string; date: string; amount: number }>();
        for (const r of records) {
          const k = lower(r.Recorder);
          const cur = per.get(k) ?? { type: entityOfRecorderType(r.Recorder_Type), date: text(r.Period), amount: 0 };
          cur.amount += num(r["Сумма"]);
          per.set(k, cur);
        }
        // баримтын дугаар: төрөл бүрээр лавлана
        const byType = new Map<string, string[]>();
        for (const [ref, v] of per) byType.set(v.type, [...(byType.get(v.type) ?? []), ref]);
        const numbers = new Map<string, string>();
        for (const [type, refs] of byType) {
          if (!ENTITY_RE.test(type) || !refs.every((r) => GUID.test(r))) continue;
          const rows = await lookupRows(`Document_${type}`, refs, "Number");
          for (const [k, r] of rows) numbers.set(k, text(r?.Number));
        }
        return [...per].map(([ref, v]) => ({
          kind: kindByEntity(v.type) ?? "other",
          type: v.type,
          ref,
          number: numbers.get(ref) ?? "",
          date: v.date,
          label: entityLabel(v.type),
          tone: entityTone(v.type),
          party: "",
          partyCode: "",
          warehouse: "",
          warehouseCode: "",
          warehouseTo: "",
          warehouseToCode: "",
          amount: round2(v.amount),
          lines: null,
          comment: "",
        } satisfies DocCard)).sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
      }),
    { refresh }
  );
}

// ---------------------------------------------------------------- дэлгэрэнгүй

function postingsOf(records: Row[], book: AccountBook, hidePayroll = false): DocPosting[] {
  const payrollKeys = hidePayroll ? payrollAccountKeys(book) : null;
  return records
    .map((r, i) => ({
      n: Number(r.LineNumber) || i + 1,
      debit: accountRef(book, r.AccountDr_Key),
      credit: accountRef(book, r.AccountCr_Key),
      amount: round2(num(r["Сумма"])),
      qty: r["КоличествоDr"] != null ? num(r["КоличествоDr"]) : r["КоличествоCr"] != null ? num(r["КоличествоCr"]) : null,
      memo: payrollKeys && isPayrollRecord(r, payrollKeys) ? PAYROLL_LABEL : text(r["Содержание"]),
    }))
    .sort((a, b) => a.n - b.n);
}

export interface DetailOptions {
  /** нярав: нягтлангийн бичилт харахгүй */
  withPostings: boolean;
  /** canViewPayroll-гүй: цалингийн бичилттэй баримтын хүний нэр, утга (хариуцагч, харилцагч, гүйлгээний утга, коммент, бичилтийн утга) нуугдана */
  hidePayroll?: boolean;
}

/** Цалингийн эрхгүй хүнд цалингийн бичилттэй баримтын дэлгэрэнгүйг нэгтгэж харуулна: дүн, огноо хэвээр, нэр/утга нуугдана */
export function redactPayrollDetail(detail: DocDetail): DocDetail {
  return { ...detail, fields: [{ label: "Төрөл", value: PAYROLL_LABEL }], comment: "" };
}

/** Баримтын картуудаас цалингийн бичилттэй баримтыг нэгтгэнэ (canViewPayroll-гүй хэрэглэгчид). from, to нь картуудын хугацаа. */
export function hidePayrollInCards(cards: DocCard[], from: string, to: string): Promise<DocCard[]> {
  return withOneCYear(yearOf(from), async () => redactPayrollCards(cards, await loadPayrollRecorders(from, to)));
}

/** Баримтын дэлгэрэнгүй. `type` нь 1С-ийн баримтын нэр (шалгагдсан), `ref` нь GUID. */
export async function loadDocumentDetail(type: string, ref: string, opts: DetailOptions): Promise<{ value: DocDetail; meta: CacheMeta }> {
  if (!ENTITY_RE.test(type) || !GUID.test(ref)) throw new OdataError(400, "Баримтын лавлагаа буруу байна");
  return cachedLoad(`docdetail:${type}:${ref.toLowerCase()}:${opts.withPostings ? 1 : 0}:${opts.hidePayroll ? 1 : 0}`, () => fetchDetail(type, ref.toLowerCase(), opts));
}

async function fetchDetail(type: string, ref: string, opts: DetailOptions): Promise<DocDetail> {
  // Баримтын оныг мэдэхгүй тул одоогийн оны баазаас хайж, олдохгүй бол бусад оны баазаас (ONEC_BASES)
  return findAcrossBases(ref, type, opts);
}

/** Нэг баримт ({...} хэлбэртэй, `value` массивгүй) тул odataRows биш odataGet-ээр. Олдохгүй бол null. */
async function getDocElement(type: string, ref: string): Promise<Row | null> {
  try {
    return JSON.parse(await odataGet(`${enc(`Document_${type}`)}(guid'${ref}')?$format=json`, "json")) as Row;
  } catch (e) {
    if (e instanceof OdataError && /\((404|400)\)/.test(e.message)) return null;
    throw e;
  }
}

async function findAcrossBases(ref: string, type: string, opts: DetailOptions): Promise<DocDetail> {
  const years = [String(new Date().getUTCFullYear()), String(new Date().getUTCFullYear() - 1)];
  const candidates = multiYear() ? [...new Set([...years, ...configuredYears().reverse()])].filter((y) => configuredYears().includes(y)) : [undefined];
  for (const y of candidates) {
    const run = <T,>(fn: () => Promise<T>) => (y ? withOneCYear(y, fn) : fn());
    const found = await run(async () => ((await getDocElement(type, ref)) ? await buildDetail(type, ref, opts) : null));
    if (found) return found;
  }
  throw new OdataError(404, "Баримт олдсонгүй");
}

async function buildDetail(type: string, ref: string, opts: DetailOptions): Promise<DocDetail | null> {
  const doc = await getDocElement(type, ref);
  if (!doc) return null;
  const kind = kindByEntity(type);
  const spec = kind ? SPECS[kind] : null;
  const date = text(doc.Date);
  const day = date.slice(0, 10);

  const rawLines: { n: number; item: string | null; qty: number; price: number; amount: number; vat: number; memo: string }[] = [];
  for (const t of spec?.tables ?? []) {
    for (const r of (doc[t] as Row[] | undefined) ?? []) {
      rawLines.push({ n: 0, item: realKey(r["Номенклатура_Key"]), qty: num(r["Количество"]), price: num(r["Цена"]), amount: num(r["Сумма"]), vat: num(r["СуммаНДС"]), memo: text(r["Содержание"]) });
    }
  }
  rawLines.forEach((l, i) => (l.n = i + 1));

  const [book, ledger] = await Promise.all([opts.withPostings || opts.hidePayroll || spec?.ledgerCost || !spec ? loadAccountBook() : Promise.resolve(null), day ? ledgerFor(type, day, day).catch(() => [] as Row[]) : Promise.resolve([] as Row[])]);
  const mine = ledger.filter((r) => lower(r.Recorder) === ref);

  // Өртөг: баримт өөрөө хадгалдаггүй бол нягтлангийн бичилтээс (барааны Кт тал): бараа бүрээр, тоогоор хуваарилна
  let costFromLedger = false;
  if (spec?.ledgerCost) {
    const per = new Map<string, { amount: number; qty: number }>();
    for (const r of mine) {
      if (!text(r.ExtDimensionCr1_Type).endsWith(ITEM_TYPE)) continue;
      const k = realKey(r.ExtDimensionCr1);
      if (!k) continue;
      const cur = per.get(k) ?? { amount: 0, qty: 0 };
      cur.amount += num(r["Сумма"]);
      cur.qty += num(r["КоличествоCr"]);
      per.set(k, cur);
    }
    const qtyOf = new Map<string, number>();
    for (const l of rawLines) if (l.item) qtyOf.set(l.item, (qtyOf.get(l.item) ?? 0) + l.qty);
    for (const l of rawLines) {
      const c = l.item ? per.get(l.item) : undefined;
      if (!c || !l.item) continue;
      const total = qtyOf.get(l.item) || 0;
      l.amount = total ? round2((c.amount * l.qty) / total) : 0;
      l.price = l.qty ? round2(l.amount / l.qty) : 0;
      costFromLedger = true;
    }
  }

  const [items, warehouses, contractors, departments, users, banks] = await Promise.all([
    lookupRows(ITEM_TYPE, [...new Set(rawLines.map((l) => l.item).filter((k): k is string => !!k))], "Description,Code,ЕдиницаИзмерения_Key"),
    lookupRows("Catalog_Склады", keysOf([doc], [spec?.warehouse, spec?.warehouseTo]), "Description"),
    lookupRows("Catalog_Контрагенты", [...new Set([spec?.party ? realKey(doc[spec.party]) : null, contractorOf(doc, spec?.partyComposite)].filter((k): k is string => !!k))], "Description"),
    lookupRows("Catalog_ПодразделенияОрганизаций", keysOf([doc], spec?.department ?? []), "Description"),
    lookupRows("Catalog_Пользователи", keysOf([doc], ["Ответственный_Key"]), "Description"),
    lookupRows("Catalog_БанковскиеСчета", keysOf([doc], [spec?.bankAccount]), "Description,НомерСчета"),
  ]);
  const unitRows = await lookupRows("Catalog_КлассификаторЕдиницИзмерения", [...items.values()].map((r) => realKey(r?.["ЕдиницаИзмерения_Key"])).filter((k): k is string => !!k), "Description");
  const unitOf = (itemKey: string | null) => (itemKey ? text(unitRows.get(realKey(items.get(itemKey)?.["ЕдиницаИзмерения_Key"]) ?? "")?.Description) : "");

  const lines: DocLine[] = rawLines.map((l) => ({
    n: l.n,
    itemKey: l.item ?? "",
    item: l.item ? text(items.get(l.item)?.Description) || l.memo || "Бараа" : l.memo || "Үйлчилгээ",
    itemCode: l.item ? text(items.get(l.item)?.Code) : "",
    unit: unitOf(l.item),
    qty: l.qty,
    price: round2(l.price),
    amount: round2(l.amount),
    vat: round2(l.vat),
  }));

  const sumAmount = lines.reduce((s, l) => s + l.amount, 0);
  const sumVat = lines.reduce((s, l) => s + l.vat, 0);
  const sumQty = lines.reduce((s, l) => s + l.qty, 0);
  const vatIncluded = spec?.vatIncluded && typeof doc[spec.vatIncluded] === "boolean" ? (doc[spec.vatIncluded] as boolean) : null;
  const docAmount = spec?.amount ? num(doc[spec.amount]) : 0;
  const total = docAmount > 0 ? docAmount : vatIncluded === false ? sumAmount + sumVat : sumAmount;

  const nameOf = (m: Map<string, Row | null>, key: string | null) => (key ? text(m.get(key)?.Description) : "");
  const wh = spec?.warehouse ? realKey(doc[spec.warehouse]) : null;
  const whTo = spec?.warehouseTo ? realKey(doc[spec.warehouseTo]) : null;
  const partyKey = (spec?.party ? realKey(doc[spec.party]) : null) ?? contractorOf(doc, spec?.partyComposite);
  const deptKey = (spec?.department ?? []).map((f) => realKey(doc[f])).find((k) => k) ?? null;
  const bankKey = spec?.bankAccount ? realKey(doc[spec.bankAccount]) : null;
  const bankRow = bankKey ? banks.get(bankKey) : null;

  const fields: { label: string; value: string }[] = [];
  const add = (label: string, value: string) => value && fields.push({ label, value });
  if (kind === "requisition") {
    add("Хэлтэс", nameOf(departments, deptKey));
    add("Хүлээн авагч", nameOf(contractors, partyKey));
  } else {
    add("Харилцагч", nameOf(contractors, partyKey));
    add("Хэлтэс", nameOf(departments, deptKey));
  }
  if (kind === "transfer") {
    add("Хаанаас (агуулах)", nameOf(warehouses, wh));
    add("Хаашаа (агуулах)", nameOf(warehouses, whTo));
  } else {
    add("Агуулах", nameOf(warehouses, wh));
  }
  add("Банкны данс", text(bankRow?.Description) || text(bankRow?.["НомерСчета"]));
  add("Хариуцагч", nameOf(users, realKey(doc["Ответственный_Key"])));
  add("Гүйлгээний утга", text(spec?.purpose ? doc[spec.purpose] : ""));

  const detail: DocDetail = {
    type,
    ref,
    kind: kind ?? "other",
    label: entityLabel(type),
    tone: entityTone(type),
    number: text(doc.Number),
    date,
    posted: doc.Posted === true,
    fields,
    comment: text(doc.Комментарий),
    lines,
    totals: { amount: round2(sumAmount), vat: round2(sumVat), total: round2(total), vatIncluded, qty: sumQty },
    postings: opts.withPostings && book ? postingsOf(mine, book, opts.hidePayroll) : [],
    costFromLedger,
  };
  // Цалингийн дансны бичилттэй баримт: нэр, утга нуугдана. Бичилт хоосон (нярав) бол ч тодорхойлж болно: ledger нь үргэлж татагдсан.
  if (opts.hidePayroll && book) {
    const keys = payrollAccountKeys(book);
    if (mine.some((r) => isPayrollRecord(r, keys))) return redactPayrollDetail(detail);
  }
  return detail;
}

// ---------------------------------------------------------------- барааны түүх

interface StockLine {
  date: string;
  recorder: string;
  type: string;
  direction: "in" | "out";
  /** барааны GUID */
  item: string;
  /** агуулахын GUID (хоосон бол агуулах тодорхойгүй) */
  whKey: string;
  qty: number;
  amount: number;
}

/** Нэг сарын агуулахын бичилт (14xx данс, барааны субконто): Дт = орлого, Кт = зарлага. Бүх барааны мөрийг нэг удаа татаж, 5 минут cache-лэнэ. */
async function monthStockLines(month: string, side: "Dr" | "Cr", stockKeys: ReadonlySet<string>): Promise<StockLine[]> {
  const { from, to } = monthRange(month);
  const f = enc(`ExtDimension${side}1_Type eq 'StandardODATA.${ITEM_TYPE}'`);
  const select = enc(`Period,Recorder,Recorder_Type,Account${side}_Key,Сумма,Количество${side},ExtDimension${side}1,ExtDimension${side}2,ExtDimension${side}2_Type`);
  const rows = await odataRows(
    `${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Top=${REGISTER_TOP})?$format=json&$select=${select}&$filter=${f}`,
    { timeoutMs: 60_000 }
  );
  if (rows.length >= REGISTER_TOP) throw new OdataError(502, "Бичилт хэт олон байна: хугацааг богиносгоно уу");
  return rows
    .filter((r) => stockKeys.has(lower(r[`Account${side}_Key`])))
    .map((r) => ({
      date: text(r.Period),
      recorder: lower(r.Recorder),
      type: entityOfRecorderType(r.Recorder_Type),
      direction: side === "Dr" ? ("in" as const) : ("out" as const),
      item: lower(r[`ExtDimension${side}1`]),
      whKey: text(r[`ExtDimension${side}2_Type`]).endsWith("Catalog_Склады") ? (realKey(r[`ExtDimension${side}2`]) ?? "") : "",
      qty: num(r[`Количество${side}`]),
      amount: num(r["Сумма"]),
    }));
}

export interface ItemInput {
  key?: string | null;
  code?: string | null;
  from: string;
  to: string;
}

export interface ItemBalanceRow {
  warehouse: string;
  qty: number;
  amount: number;
}

export type ItemHistoryResult = ItemHistory & { balances: ItemBalanceRow[] };

/** Барааны түүх: хугацаанд ямар баримтаар, ямар агуулахад хэд орж, гарсан + одоогийн агуулах бүрийн үлдэгдэл */
export async function loadItemHistory(input: ItemInput): Promise<{ value: ItemHistoryResult; meta: CacheMeta }> {
  const { from, to } = input;
  const months = monthsBetween(from.slice(0, 7), to.slice(0, 7));
  if (months.length > MAX_HISTORY_MONTHS) throw new OdataError(400, `Түүхийг дээд тал нь ${MAX_HISTORY_MONTHS} сараар харуулна`);
  if (yearOf(from) !== yearOf(to)) throw new OdataError(400, "Хугацаа нэг оны дотор байх ёстой");
  return withOneCYear(yearOf(from), async () => {
    const itemKey = await resolveItem(input);
    return cachedLoad(`itemhist:${itemKey}:${from}:${to}`, async () => {
      const book = await loadAccountBook();
      const stockKeys = new Set(keysWithPrefix(book, STOCK_ACCOUNT_PREFIX));
      const lines: StockLine[] = [];
      // сар бүр Дт, Кт: сарын татаалтыг cache-лэж (олон бараа ижил сарыг дахин татахгүй), 1С-ийг ачаалахгүйн тулд 2-оор зэрэг
      for (const group of chunks(months.flatMap((m) => (["Dr", "Cr"] as const).map((s) => [m, s] as const)), 2)) {
        const part = await Promise.all(group.map(([m, s]) => cachedLoad(`stocklines:${m}:${s}`, () => monthStockLines(m, s, stockKeys)).then((r) => r.value)));
        for (const p of part) lines.push(...p.filter((l) => l.item === itemKey && l.date.slice(0, 10) >= from && l.date.slice(0, 10) <= to));
      }

      // шилжүүлэг, үйлдвэрлэл зэрэг нэг баримтын Дт, Кт хоёулаа бичигддэг: баримт бүрийн бичилтийг тус тусад нь харуулна (орлого ба зарлага)
      const [warehouses, balances] = await Promise.all([
        lookupRows("Catalog_Склады", [...new Set(lines.map((l) => l.whKey).filter(Boolean))], "Description"),
        itemBalances(itemKey, stockKeys),
      ]);
      const whNames = nameMap(warehouses);
      const byType = new Map<string, string[]>();
      for (const l of lines) byType.set(l.type, [...new Set([...(byType.get(l.type) ?? []), l.recorder])]);
      const numbers = new Map<string, string>();
      for (const [t, refs] of byType) {
        if (!ENTITY_RE.test(t)) continue;
        const rows = await lookupRows(`Document_${t}`, refs, "Number");
        for (const [k, r] of rows) numbers.set(k, text(r?.Number));
      }

      const item = (await lookupRows(ITEM_TYPE, [itemKey], "Description,Code,ЕдиницаИзмерения_Key")).get(itemKey);
      const unit = (await lookupRows("Catalog_КлассификаторЕдиницИзмерения", [realKey(item?.["ЕдиницаИзмерения_Key"])].filter((k): k is string => !!k), "Description")).values().next().value as Row | null | undefined;
      const rows: ItemHistoryRow[] = lines
        .map((l) => ({
          date: l.date,
          type: l.type,
          ref: l.recorder,
          label: entityLabel(l.type),
          tone: entityTone(l.type),
          number: numbers.get(l.recorder) ?? "",
          warehouse: whNames.get(l.whKey) ?? "",
          direction: l.direction,
          qty: round2(l.qty),
          amount: round2(l.amount),
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
      const sum = (dir: "in" | "out", f: (r: ItemHistoryRow) => number) => round2(rows.filter((r) => r.direction === dir).reduce((s, r) => s + f(r), 0));
      const whBal = await lookupRows("Catalog_Склады", balances.map((b) => b.whKey), "Description");
      return {
        itemKey,
        item: text(item?.Description),
        itemCode: text(item?.Code),
        unit: text(unit?.Description),
        from,
        to,
        rows,
        totals: { inQty: sum("in", (r) => r.qty), inAmount: sum("in", (r) => r.amount), outQty: sum("out", (r) => r.qty), outAmount: sum("out", (r) => r.amount) },
        balances: balances.map((b) => ({ warehouse: text(whBal.get(b.whKey)?.Description) || "Агуулах тодорхойгүй", qty: round2(b.qty), amount: round2(b.amount) })).sort((a, b) => b.amount - a.amount),
      } satisfies ItemHistoryResult;
    });
  });
}

async function resolveItem(input: ItemInput): Promise<string> {
  const key = input.key?.trim();
  if (key) {
    if (!GUID.test(key)) throw new OdataError(400, "Барааны лавлагаа буруу байна");
    return key.toLowerCase();
  }
  const code = input.code?.trim();
  if (!code || !CODE_RE.test(code)) throw new OdataError(400, "Барааны код буруу байна");
  const rows = await odataRows(`${enc(ITEM_TYPE)}?$format=json&$select=Ref_Key&$filter=${enc(`Code eq '${code.replace(/'/g, "''")}'`)}&$top=1`);
  const k = realKey(rows[0]?.Ref_Key);
  if (!k) throw new OdataError(404, "Бараа олдсонгүй");
  return k;
}

/** Агуулах бүрийн одоогийн үлдэгдэл (14xx дансны Balance; субконто 1 = бараа, 2 = агуулах). Бүх барааг нэг удаа татаж 5 минут cache-лэнэ. */
async function itemBalances(itemKey: string, stockKeys: ReadonlySet<string>): Promise<{ whKey: string; qty: number; amount: number }[]> {
  const asOf = today();
  const { value } = await cachedLoad(`stockbalance:${asOf}`, async () => {
    const filter = [...stockKeys].map((k) => `Account_Key eq guid'${k}'`).join(" or ");
    const rows = await odataRows(
      `${enc(REGISTER)}/Balance(Period=datetime'${balanceBoundary(asOf)}')?$format=json&$select=${enc("ExtDimension1,ExtDimension1_Type,ExtDimension2,ExtDimension2_Type,СуммаBalance,КоличествоBalance")}&$filter=${enc(filter)}&$top=50000`,
      { timeoutMs: 60_000 }
    );
    return rows
      .filter((r) => text(r.ExtDimension1_Type).endsWith(ITEM_TYPE))
      .map((r) => ({ item: lower(r.ExtDimension1), whKey: text(r.ExtDimension2_Type).endsWith("Catalog_Склады") ? (realKey(r.ExtDimension2) ?? "") : "", qty: num(r["КоличествоBalance"]), amount: num(r["СуммаBalance"]) }));
  });
  const per = new Map<string, { whKey: string; qty: number; amount: number }>();
  for (const r of value) {
    if (r.item !== itemKey || !r.whKey) continue;
    const cur = per.get(r.whKey) ?? { whKey: r.whKey, qty: 0, amount: 0 };
    cur.qty += r.qty;
    cur.amount += r.amount;
    per.set(r.whKey, cur);
  }
  return [...per.values()].filter((b) => Math.abs(b.qty) > 0.0001 || Math.abs(b.amount) > 0.005);
}
