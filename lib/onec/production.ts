// «Үйлдвэрлэл» таб: 1С-ээс (OData, ЗӨВХӨН GET) үйлдвэрлэлийн гарцыг татна.
//   Гарц     = Document_ОтчетПроизводстваЗаСмену (DeletionMark=false), Продукция хүснэгт. Батлагдсан БА батлагдаагүй (Posted) хоёулаа: нягтлан батлаагүйг тусад нь тэмдэглэнэ.
//              Шат нь мөрийн Счет_Key-ээс: 1441 бэлэн бүтээгдэхүүн, 1431 хагас боловсруулсан, 1401 бутлан ангилах үйлдвэрийн гарц (түүхий эд).
//   Өртөг    = Хозрасчетный, ЗӨВХӨН энэ баримтын бичилт: Дт 1441/1431 ← Кт 142x. Сар хаагдтал Сумма нь төлөвлөсөн (нэгж үнэ 1 ₮), хаагдсаны дараа бодит өртөг.
//   Материал = Дт 1423 ← Кт 1401 (цехээр). КомплектацияНоменклатуры г.м. өөр баримтын бичилтийг ГАРЦАД оруулахгүй (үйлдвэрлэл биш).
//   Дараа нь брак болсон = Document_КомплектацияНоменклатуры (Дт 1441 ← Кт 1441): толгой бүтээгдэхүүний нэр «Брак», эх бүтээгдэхүүн брак БИШ бол
//              тэр баримтын өдрөөр, stage = "reclass" мөр болгон хадгална. Эсрэг чиглэл (толгой «Зас»/«Брак»-гүй, эх нь «… Брак»/«… Зас») нь stage = "defect_to_ready"/"repair_to_ready" (давхар тоолохгүй: гарцын нийлбэрт ордоггүй). Цех нь баримтад байхгүй: хадгалахдаа бүтээгдэхүүнийхээ цехээр.
// Хүний мэдээлэл, баримтын «Комментарий»-ийг огт уншихгүй ($select-ээр зөвхөн хэрэгтэй талбар).
import { loadAccountBook, shortCode, type AccountBook } from "./accounts";
import { monthRange } from "./dates";
import { enc, lookupRows, num, odataRows, realKey, type Row } from "./odata-read";
import { splitProductName, stageOfAccount, type ProductionStage } from "./production-names";
import { withOneCYear, yearOf } from "./year-context";

const DOC = "Document_ОтчетПроизводстваЗаСмену";
const REGISTER = "AccountingRegister_Хозрасчетный";
const NOMENCLATURE = "Catalog_Номенклатура";
const UNITS = "Catalog_КлассификаторЕдиницИзмерения";
const DEPARTMENTS = "Catalog_ПодразделенияОрганизаций";
const RECLASS_DOC = "Document_КомплектацияНоменклатуры";
const RECORDER = "Document_ОтчетПроизводстваЗаСмену";
const PAGE = 200;
const TOP = 100_000;
export const PRODUCTION_TIMEOUT_MS = 45_000;

export interface ProductionLineInput {
  day: string;
  docRef: string;
  docNumber: string;
  lineNo: number;
  /** баримтын цаг «ЦЦ:ММ» */
  time: string;
  posted: boolean;
  stage: ProductionStage;
  department: string;
  productKey: string;
  product: string;
  unit: string;
  quantity: number;
}

export interface ProductionLedgerInput {
  kind: "output" | "material";
  stage: ProductionStage | "";
  department: string;
  productKey: string;
  product: string;
  unit: string;
  quantity: number;
  amount: number;
}

export interface ProductionMonthData {
  month: string;
  lines: ProductionLineInput[];
  ledger: ProductionLedgerInput[];
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const lower = (v: unknown) => String(v ?? "").toLowerCase();
const orChain = (field: string, keys: Iterable<string>) => [...keys].map((k) => `${field} eq guid'${k}'`).join(" or ");
const base = (code: string) => shortCode(code).replace(/\..*$/, "");

async function fetchDocs(month: string, timeoutMs: number): Promise<Row[]> {
  const { from, to } = monthRange(month);
  const filter = `Date ge datetime'${from}T00:00:00' and Date le datetime'${to}T23:59:59' and DeletionMark eq false`;
  const select = "Ref_Key,Number,Date,Posted,ПодразделениеЗатрат_Key,Продукция";
  const all: Row[] = [];
  for (let page = 0; page < 40; page++) {
    const rows = await odataRows(`${enc(DOC)}?$format=json&$select=${enc(select)}&$filter=${enc(filter)}&$orderby=${enc("Date asc")}&$top=${PAGE}&$skip=${page * PAGE}`, { timeoutMs });
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/** Комплектацийн баримтууд (батлагдсан): толгой бүтээгдэхүүн + эх бүтээгдэхүүнүүд */
async function fetchReclassDocs(month: string, timeoutMs: number): Promise<Row[]> {
  const { from, to } = monthRange(month);
  const filter = `Date ge datetime'${from}T00:00:00' and Date le datetime'${to}T23:59:59' and DeletionMark eq false and Posted eq true`;
  const select = "Ref_Key,Number,Date,Номенклатура_Key,Количество,Комплектующие";
  const all: Row[] = [];
  for (let page = 0; page < 40; page++) {
    const rows = await odataRows(`${enc(RECLASS_DOC)}?$format=json&$select=${enc(select)}&$filter=${enc(filter)}&$orderby=${enc("Date asc")}&$top=${PAGE}&$skip=${page * PAGE}`, { timeoutMs });
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/** Үйлдвэрлэлийн баримтын бичилт: гарцын (Дт 1441/1431) ба материалын (Дт 1423 ← Кт 1401) мөрүүд */
async function fetchLedger(month: string, book: AccountBook, timeoutMs: number): Promise<Row[]> {
  const keys = (codes: string[]) => [...book.byKey.values()].filter((a) => codes.includes(base(a.code))).map((a) => a.key);
  const output = keys(["1441", "1431"]);
  const materialDr = keys(["1423"]);
  const materialCr = keys(["1401"]);
  if (!output.length && !(materialDr.length && materialCr.length)) return [];
  const parts: string[] = [];
  if (output.length) parts.push(`(${orChain("AccountDr_Key", output)})`);
  if (materialDr.length && materialCr.length) parts.push(`((${orChain("AccountDr_Key", materialDr)}) and (${orChain("AccountCr_Key", materialCr)}))`);
  const { from, to } = monthRange(month);
  const select = "Recorder_Type,AccountDr_Key,AccountCr_Key,Сумма,КоличествоDr,ExtDimensionDr1,ExtDimensionDr1_Type,ПодразделениеDr_Key,ПодразделениеCr_Key";
  const rows = await odataRows(
    `${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Top=${TOP})?$format=json&$select=${enc(select)}&$filter=${enc(`(${parts.join(" or ")})`)}`,
    { timeoutMs }
  );
  return rows.filter((r) => String(r.Recorder_Type ?? "").endsWith(RECORDER));
}

/** GUID -> нэр (олдохгүй бол хоосон) */
async function names(catalog: string, keys: (string | null)[], select = "Description"): Promise<Map<string, Row | null>> {
  return lookupRows(catalog, [...new Set(keys.filter((k): k is string => !!k))], select);
}

/**
 * Нэг сарын үйлдвэрлэлийн гарц, бичилт. Хүсэлтүүдийг дараалан явуулна (1С-д нэг дор нэг). `timeoutMs`: хүсэлт тус бүрийн дээд хугацаа.
 * Баримтгүй сар алдаа биш: хоосон жагсаалттай буцна.
 */
export function fetchProductionMonth(month: string, opts: { timeoutMs?: number } = {}): Promise<ProductionMonthData> {
  const timeoutMs = opts.timeoutMs ?? PRODUCTION_TIMEOUT_MS;
  return withOneCYear(yearOf(month), async () => {
    const book = await loadAccountBook();
    const docs = await fetchDocs(month, timeoutMs);
    const ledgerRows = await fetchLedger(month, book, timeoutMs);
    const reclassDocs = await fetchReclassDocs(month, timeoutMs);

    const lineRows = docs.flatMap((d) => (Array.isArray(d.Продукция) ? (d.Продукция as Row[]) : []));
    const reclassComps = (d: Row): Row[] => (Array.isArray(d.Комплектующие) ? (d.Комплектующие as Row[]) : []);
    const productKeys = [
      ...lineRows.map((l) => realKey(l.Номенклатура_Key)),
      ...ledgerRows.map((r) => realKey(r.ExtDimensionDr1)),
      ...reclassDocs.flatMap((d) => [realKey(d.Номенклатура_Key), ...reclassComps(d).map((c) => realKey(c.Номенклатура_Key))]),
    ];
    const products = await names(NOMENCLATURE, productKeys, "Description,ЕдиницаИзмерения_Key");
    const unitKeys = [...lineRows.map((l) => realKey(l.ЕдиницаИзмерения_Key)), ...reclassDocs.map((d) => realKey(products.get(realKey(d.Номенклатура_Key) ?? "")?.ЕдиницаИзмерения_Key)), ...[...products.values()].map((p) => realKey(p?.ЕдиницаИзмерения_Key))];
    const units = await names(UNITS, unitKeys);
    const deptKeys = [...docs.map((d) => realKey(d.ПодразделениеЗатрат_Key)), ...ledgerRows.flatMap((r) => [realKey(r.ПодразделениеDr_Key), realKey(r.ПодразделениеCr_Key)])];
    const depts = await names(DEPARTMENTS, deptKeys);
    const unitName = (key: unknown): string => String(units.get(realKey(key) ?? "")?.Description ?? "").trim();
    const productName = (key: string | null): string => String(products.get(key ?? "")?.Description ?? "").replace(/\s+/g, " ").trim() || "Нэргүй бүтээгдэхүүн";
    const deptName = (key: unknown): string => String(depts.get(realKey(key) ?? "")?.Description ?? "").replace(/\s+/g, " ").trim() || "Цех заагаагүй";
    const accountCode = (key: unknown): string => book.byKey.get(lower(key))?.code ?? "";

    const lines: ProductionLineInput[] = [];
    const unitOf = new Map<string, string>();
    for (const d of docs) {
      const docRef = lower(d.Ref_Key);
      const day = String(d.Date ?? "").slice(0, 10);
      const dept = deptName(d.ПодразделениеЗатрат_Key);
      const time = String(d.Date ?? "").slice(11, 16);
      for (const l of (Array.isArray(d.Продукция) ? d.Продукция : []) as Row[]) {
        const quantity = round(num(l.Количество), 3);
        const productKey = realKey(l.Номенклатура_Key);
        if (!quantity || !productKey) continue;
        const unit = unitName(l.ЕдиницаИзмерения_Key) || unitName(products.get(productKey)?.ЕдиницаИзмерения_Key);
        unitOf.set(productKey, unit);
        lines.push({
          day,
          docRef,
          docNumber: String(d.Number ?? "").trim(),
          lineNo: Number(l.LineNumber) || lines.length + 1,
          time,
          posted: d.Posted === true,
          stage: stageOfAccount(accountCode(l.Счет_Key)) ?? "finished",
          department: dept,
          productKey,
          product: productName(productKey),
          unit,
          quantity,
        });
      }
    }

    // Дараа нь брак болсон: толгой нь «Брак», эх бүтээгдэхүүн нь брак биш. Цех хоосон: хадгалахдаа (production-store) бүтээгдэхүүнээр нь тодорхойлно.
    for (const d of reclassDocs) {
      const productKey = realKey(d.Номенклатура_Key);
      const quantity = round(num(d.Количество), 3);
      if (!productKey || !quantity) continue;
      const head = productName(productKey);
      const comps = reclassComps(d).map((c) => productName(realKey(c.Номенклатура_Key)));
      if (splitProductName(head).variant !== "defect" || !comps.length || comps.some((n) => splitProductName(n).variant === "defect")) continue;
      lines.push({
        day: String(d.Date ?? "").slice(0, 10),
        docRef: lower(d.Ref_Key),
        docNumber: String(d.Number ?? "").trim(),
        lineNo: 1,
        time: String(d.Date ?? "").slice(11, 16),
        posted: true,
        stage: "reclass",
        department: "",
        productKey,
        product: head,
        unit: unitName(products.get(productKey)?.ЕдиницаИзмерения_Key),
        quantity,
      });
    }

    // Бракаас / Засвараас бэлэн болгосон: толгой нь «Зас»/«Брак»-гүй, эх бүтээгдэхүүн бүр «… Брак» эсвэл «… Зас». Эх бүтээгдэхүүн бүрийн тоо = нэг мөр (шат нь эхийнхээр).
    for (const d of reclassDocs) {
      const productKey = realKey(d.Номенклатура_Key);
      if (!productKey || splitProductName(productName(productKey)).variant !== "main") continue;
      reclassComps(d).forEach((c, i) => {
        const variant = splitProductName(productName(realKey(c.Номенклатура_Key))).variant;
        const quantity = round(num(c.Количество), 3);
        if (variant === "main" || !quantity) return;
        lines.push({
          day: String(d.Date ?? "").slice(0, 10),
          docRef: lower(d.Ref_Key),
          docNumber: String(d.Number ?? "").trim(),
          lineNo: i + 1,
          time: String(d.Date ?? "").slice(11, 16),
          posted: true,
          stage: variant === "defect" ? "defect_to_ready" : "repair_to_ready",
          department: "",
          productKey,
          product: productName(productKey),
          unit: unitName(products.get(productKey)?.ЕдиницаИзмерения_Key),
          quantity,
        });
      });
    }

    // Нэг бүтээгдэхүүн + нэг цех + нэг шат = нэг мөр (тоо, дүнг нэгтгэнэ)
    const merged = new Map<string, ProductionLedgerInput>();
    for (const r of ledgerRows) {
      const dr = base(accountCode(r.AccountDr_Key));
      const amount = num(r.Сумма);
      if (dr === "1423") {
        const department = deptName(r.ПодразделениеDr_Key);
        const k = `material|${department}`;
        const row = merged.get(k) ?? { kind: "material" as const, stage: "" as const, department, productKey: "", product: "", unit: "", quantity: 0, amount: 0 };
        row.amount += amount;
        merged.set(k, row);
        continue;
      }
      const stage = stageOfAccount(dr);
      const productKey = realKey(r.ExtDimensionDr1);
      if (!stage || !productKey) continue;
      const department = deptName(r.ПодразделениеCr_Key);
      const k = `output|${stage}|${department}|${productKey}`;
      const unit = unitOf.get(productKey) ?? unitName(products.get(productKey)?.ЕдиницаИзмерения_Key);
      const row = merged.get(k) ?? { kind: "output" as const, stage, department, productKey, product: productName(productKey), unit, quantity: 0, amount: 0 };
      row.quantity += num(r.КоличествоDr);
      row.amount += amount;
      merged.set(k, row);
    }
    const ledger = [...merged.values()].map((r) => ({ ...r, quantity: round(r.quantity, 3), amount: round(r.amount, 2) }));
    return { month, lines, ledger };
  });
}
