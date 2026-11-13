// «Зарцуулалт» таб: Шаардах хуудас (Document_ТребованиеНакладная, зөвхөн батлагдсан) сараар. Зөвхөн 1С-ээс УНШИНА (GET).
//
// Баримтын «Материалы» хүснэгтэн хэсгийн Себестоимость нь бүх баримтад 0 тул (1С-д өртөг тэнд хадгалагддаггүй) материал бүрийн
// тоо, дүнг нягтлан бодох бүртгэлийн регистрээс авна: AccountingRegister_Хозрасчетный/RecordsWithExtDimensions, Recorder нь
// Шаардах хуудас байх бичилтүүд (Сумма = өртөг, КоличествоCr = тоо, ExtDimensionCr1 = бараа материал).
import { cachedLoad, type CacheMeta } from "./odata-cache";
import { enc, fetchPaged, lookupRows, num, odataRows, OdataError, realKey, type Row } from "./odata-read";
import { monthRange } from "./dates";

const DOC = "Document_ТребованиеНакладная";
const REGISTER = "AccountingRegister_Хозрасчетный";
const RECORDER_TYPE = "StandardODATA.Document_ТребованиеНакладная";
const ITEM_TYPE = "Catalog_Номенклатура";
const REGISTER_TOP = 100_000;

export interface UsageMaterial {
  key: string;
  name: string;
  unit: string;
  quantity: number;
  amount: number;
  documents: number;
}
export interface UsageDepartment {
  name: string;
  amount: number;
  documents: number;
}
export interface UsageDocument {
  id: string;
  number: string;
  date: string;
  department: string;
  warehouse: string;
  recipient: string;
  purpose: string;
  amount: number;
}
export interface UsageResult {
  month: string;
  totals: { amount: number; documents: number; materials: number };
  byMaterial: UsageMaterial[];
  byDepartment: UsageDepartment[];
  daily: { date: string; amount: number }[];
  documents: UsageDocument[];
}

export interface UsageInputs {
  month: string;
  /** Баримтын толгой (Posted=true) */
  docs: Row[];
  /** Регистрын бичилтүүд (RecordsWithExtDimensions) */
  records: Row[];
  /** GUID -> нэр */
  names: { items: Map<string, { name: string; unit: string }>; departments: Map<string, string>; warehouses: Map<string, string>; contractors: Map<string, string> };
}

const UNKNOWN = "Тодорхойгүй";
const day = (v: unknown) => String(v ?? "").slice(0, 10);
const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Цэвэр нэгтгэл (тестлэгдэнэ): 1С-ийн мөрүүдээс харагдах тайланг бүтээнэ. Техникийн нэр (Catalog_, _Key) гарахгүй. */
export function buildUsage({ month, docs, records, names }: UsageInputs): UsageResult {
  const nameOf = (m: Map<string, string>, key: unknown) => {
    const k = realKey(key);
    return (k && m.get(k)) || UNKNOWN;
  };

  // Регистрын бичилт: бараа материалын кредит талынх (тоо, өртөг)
  const perDoc = new Map<string, number>();
  const perItem = new Map<string, { quantity: number; amount: number; docs: Set<string> }>();
  const perDay = new Map<string, number>();
  const docDate = new Map(docs.map((d) => [String(d.Ref_Key).toLowerCase(), day(d.Date)]));
  for (const r of records) {
    if (!String(r.ExtDimensionCr1_Type ?? "").endsWith(ITEM_TYPE)) continue;
    const item = realKey(r.ExtDimensionCr1);
    const doc = String(r.Recorder ?? "").toLowerCase();
    if (!item) continue;
    const amount = num(r["Сумма"]);
    const cur = perItem.get(item) ?? { quantity: 0, amount: 0, docs: new Set<string>() };
    cur.quantity += num(r["КоличествоCr"]);
    cur.amount += amount;
    cur.docs.add(doc);
    perItem.set(item, cur);
    perDoc.set(doc, (perDoc.get(doc) ?? 0) + amount);
    const d = docDate.get(doc) ?? day(r.Period);
    perDay.set(d, (perDay.get(d) ?? 0) + amount);
  }

  const documents: UsageDocument[] = docs
    .map((d) => {
      const id = String(d.Ref_Key).toLowerCase();
      return {
        id,
        number: String(d.Number ?? ""),
        date: String(d.Date ?? ""),
        department: nameOf(names.departments, realKey(d["ПодразделениеЗатрат_Key"]) ?? d["ПодразделениеОрганизации_Key"]),
        warehouse: nameOf(names.warehouses, d["Склад_Key"]),
        recipient: String(d["Получатель_Type"] ?? "").endsWith("Catalog_Контрагенты") ? nameOf(names.contractors, d["Получатель"]) : "",
        purpose: String(d["Комментарий"] ?? "").trim(),
        amount: round2(perDoc.get(id) ?? 0),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));

  const byDept = new Map<string, UsageDepartment>();
  for (const d of documents) {
    const cur = byDept.get(d.department) ?? { name: d.department, amount: 0, documents: 0 };
    cur.amount += d.amount;
    cur.documents += 1;
    byDept.set(d.department, cur);
  }

  const byMaterial: UsageMaterial[] = [...perItem].map(([key, v]) => {
    const item = names.items.get(key);
    return { key, name: item?.name || UNKNOWN, unit: item?.unit ?? "", quantity: round2(v.quantity), amount: round2(v.amount), documents: v.docs.size };
  });
  byMaterial.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "mn"));

  const { from, to } = monthRange(month);
  const daily: { date: string; amount: number }[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, amount: round2(perDay.get(key) ?? 0) });
  }

  return {
    month,
    totals: { amount: round2(sumBy(documents, (d) => d.amount)), documents: documents.length, materials: byMaterial.length },
    byMaterial,
    byDepartment: [...byDept.values()].map((d) => ({ ...d, amount: round2(d.amount) })).sort((a, b) => b.amount - a.amount),
    daily,
    documents,
  };
}

/** 1С-ээс сарын зарцуулалтыг татна (бүх хүсэлт GET). Харилцагчийн нэр зэргийг lookup (1 цагийн cache)-ээр. */
export async function fetchUsage(month: string): Promise<UsageResult> {
  const { from, to } = monthRange(month);
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const filter = `Posted eq true and Date ge datetime'${from}T00:00:00' and Date lt datetime'${next.toISOString().slice(0, 10)}T00:00:00'`;
  const select = "Ref_Key,Number,Date,Склад_Key,ПодразделениеЗатрат_Key,ПодразделениеОрганизации_Key,Комментарий,Получатель,Получатель_Type";

  const docs = await fetchPaged(DOC, `$select=${enc(select)}&$filter=${enc(filter)}&$orderby=${enc("Date,Ref_Key")}`);

  const cond = `Recorder_Type eq '${RECORDER_TYPE}'`.replace(/'/g, "''");
  const records = await odataRows(
    `${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Condition='${enc(cond)}',Top=${REGISTER_TOP})?$format=json`
  );
  if (records.length >= REGISTER_TOP) throw new OdataError(502, "Зарцуулалтын бичилт хэт олон байна. Сарыг богиносгох боломжгүй тул админд хандана уу");

  const keys = (rows: Row[], field: string, type?: (r: Row) => boolean) => [...new Set(rows.filter((r) => !type || type(r)).map((r) => realKey(r[field])).filter((k): k is string => !!k))];
  const itemKeys = keys(records, "ExtDimensionCr1", (r) => String(r.ExtDimensionCr1_Type ?? "").endsWith(ITEM_TYPE));
  const deptKeys = [...new Set(docs.map((d) => realKey(d["ПодразделениеЗатрат_Key"]) ?? realKey(d["ПодразделениеОрганизации_Key"])).filter((k): k is string => !!k))];

  const [items, departments, warehouses, contractors] = await Promise.all([
    lookupRows("Catalog_Номенклатура", itemKeys, "Description,ЕдиницаИзмерения_Key"),
    lookupRows("Catalog_ПодразделенияОрганизаций", deptKeys, "Description"),
    lookupRows("Catalog_Склады", keys(docs, "Склад_Key"), "Description"),
    lookupRows("Catalog_Контрагенты", keys(docs, "Получатель", (r) => String(r["Получатель_Type"] ?? "").endsWith("Catalog_Контрагенты")), "Description"),
  ]);
  const unitRows = await lookupRows(
    "Catalog_КлассификаторЕдиницИзмерения",
    [...items.values()].map((r) => realKey(r?.["ЕдиницаИзмерения_Key"])).filter((k): k is string => !!k),
    "Description"
  );

  const toNames = (m: Map<string, Row | null>) => new Map([...m].map(([k, r]) => [k, String(r?.Description ?? "")]));
  return buildUsage({
    month,
    docs,
    records,
    names: {
      items: new Map([...items].map(([k, r]) => [k, { name: String(r?.Description ?? ""), unit: String(unitRows.get(realKey(r?.["ЕдиницаИзмерения_Key"]) ?? "")?.Description ?? "") }])),
      departments: toNames(departments),
      warehouses: toNames(warehouses),
      contractors: toNames(contractors),
    },
  });
}

/** 5 минутын cache-тай (зэрэг олон хүн нээвэл нэг л хүсэлт 1С руу очно) */
export function loadUsage(month: string, refresh = false): Promise<{ value: UsageResult; meta: CacheMeta }> {
  return cachedLoad(`usage:${month}`, () => fetchUsage(month), { refresh });
}

