// «Агуулах» таб: агуулах тус бүрийн үлдэгдэл. ЗӨВХӨН УНШИХ (OData GET), 1С-ийн нягтлан бодох бүртгэлийн регистрээс шууд.
//
// Эх сурвалж: AccountingRegister_Хозрасчетный/Balance(Period) дээр 14xx дансууд. Эдгээр дансны субконто: 1 = Бараа материал (Номенклатура),
// 2 = Агуулах (Склады), 3 = (хоосон). Бараа бүрийн үлдэгдлийг (агуулах, бараа)-аар нь авна.
//  * 142x (Дуусаагүй үйлдвэрлэл: 1421, 1423, 1424 ...) нь агуулахын бараа биш: хүснэгтэд орохгүй, Агуулах табын тусдаа KPI (lib/onec/wip.ts).
//  * 1418.xx (Ашиглалтанд буй багаж, ажлын хувцас, БҮТЭЗ) нь 2-р субконтод агуулах БАЙХГҮЙ (ажилтан эсвэл хоосон), мөн зарим мөрийн агуулахын
//    талбар 1С-д бөглөгдөөгүй (жишээ нь 1431). Хуурамч агуулах үүсгэхгүй: складын код нь `acct:<данс>`, нэр нь дансны нэр, тусдаа бүлэгт
//    (stock-tree.ts: OFF_WAREHOUSE_*), нийт дүнд орно.
// Хүснэгтийн нийт = 14xx Balance (142x-гүй): `reconciliation` талбар тулгана (`npm run onec:reconcile` мөн ингэж баталгаажуулна).
import { keysWithPrefix, loadAccountBook, type AccountBook } from "./accounts";
import { balanceBoundary } from "./dates";
import { cachedLoad, type CacheMeta } from "./odata-cache";
import { enc, lookupRows, num, odataRows, OdataError, realKey, type Row } from "./odata-read";
import { OFF_WAREHOUSE_PREFIX, type StockRow } from "./stock-tree";
import { withOneCYear, yearOf } from "./year-context";

const REGISTER = "AccountingRegister_Хозрасчетный";
const ITEM_TYPE = "Catalog_Номенклатура";
const WAREHOUSE_TYPE = "Catalog_Склады";
export const STOCK_PREFIX = "14";
/** Дуусаагүй үйлдвэрлэл: агуулахын бараа биш */
export const STOCK_WIP_PREFIX = "142";
const BALANCE_TOP = 50_000;

const round2 = (v: number) => Math.round(v * 100) / 100;
const text = (v: unknown) => String(v ?? "").trim();

export interface StockReconciliation {
  /** 14xx Balance-ийн нийлбэр, 142x-гүй (регистрээс шууд) */
  balance: number;
  /** хүснэгтийн мөрүүдийн нийлбэр */
  table: number;
  /** table - balance: 0 байх ёстой */
  difference: number;
  /** тусад нь харуулдаг 142x (Дуусаагүй үйлдвэрлэл) Balance */
  wip: number;
}

export interface StockLive {
  asOf: string;
  rows: StockRow[];
  reconciliation: StockReconciliation;
}

export interface StockNames {
  items: Map<string, { name: string; code: string; unit: string }>;
  warehouses: Map<string, { name: string; code: string }>;
}

/**
 * Цэвэр нэгтгэл (тестлэгдэнэ): Balance-ийн мөрүүдээс (агуулах, бараа)-гаар нэгтгэсэн хүснэгт. Нэг бараа нэг агуулахад хэд хэдэн дансанд
 * (1401, 1415.01 ...) байж болно: тоо, дүнг нэгтгэж, дансны НЭРийг жагсаана. Нэг ч мөр алдагдахгүй: нийт = Balance.
 */
export function buildStockLive(asOf: string, balances: Row[], book: AccountBook, names: StockNames): StockLive {
  let balance = 0;
  let wip = 0;
  const merged = new Map<string, { whCode: string; whName: string; itemKey: string; accounts: Set<string>; byAccount: Map<string, number>; qty: number; amount: number }>();

  for (const r of balances) {
    const acc = book.byKey.get(text(r.Account_Key).toLowerCase());
    if (!acc) continue; // 14xx-ийн жагсаалтаас гадуурх данс (ирэхгүй)
    const amount = num(r["СуммаBalance"]);
    const qty = num(r["КоличествоBalance"]);
    if (acc.code.startsWith(STOCK_WIP_PREFIX)) {
      wip += amount;
      continue;
    }
    balance += amount;
    if (amount === 0 && qty === 0) continue;

    const itemKey = text(r.ExtDimension1_Type).endsWith(ITEM_TYPE) ? (realKey(r.ExtDimension1) ?? "") : "";
    const whKey = text(r.ExtDimension2_Type).endsWith(WAREHOUSE_TYPE) ? (realKey(r.ExtDimension2) ?? "") : "";
    const wh = whKey ? names.warehouses.get(whKey) : undefined;
    // Складын код хоосон бол түлхүүрээр (ERP-ийн Warehouse.onecCode-той таарахгүй ч мөр алдагдахгүй)
    const whCode = whKey ? wh?.code || `wh:${whKey}` : `${OFF_WAREHOUSE_PREFIX}${acc.code}`;
    // Агуулахгүй мөр: нэр нь дансны нэр; агуулахын талбар байгаа ч 1С-д бөглөөгүй бол тэмдэглэнэ
    const whName = whKey ? (wh?.name ?? "") : `${acc.name || "Данс"}${text(r.ExtDimension2_Type).endsWith(WAREHOUSE_TYPE) ? " · 1С-д агуулах заагаагүй" : ""}`;
    const key = `${whCode}|${itemKey}`;
    const cur = merged.get(key) ?? { whCode, whName, itemKey, accounts: new Set<string>(), byAccount: new Map<string, number>(), qty: 0, amount: 0 };
    cur.qty += qty;
    cur.amount += amount;
    cur.accounts.add(acc.name || "Данс");
    cur.byAccount.set(acc.name || "Данс", (cur.byAccount.get(acc.name || "Данс") ?? 0) + Math.abs(amount));
    merged.set(key, cur);
  }

  const rows: StockRow[] = [...merged.values()].map((m) => {
    const item = m.itemKey ? names.items.get(m.itemKey) : undefined;
    return {
      id: `${m.whCode || "in-use"}|${m.itemKey || "none"}`,
      warehouse_code: m.whCode,
      warehouse: m.whName,
      item_code: item?.code ?? "",
      item: item?.name || (m.itemKey ? "Бараа" : "Бараа тодорхойгүй"),
      unit: item?.unit ?? "",
      account: [...m.accounts].sort().join(", "),
      group: [...m.byAccount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "",
      qty: round2(m.qty),
      amount: round2(m.amount),
      unit_cost: m.qty !== 0 ? round2(m.amount / m.qty) : null,
    };
  });
  const table = rows.reduce((s, r) => s + r.amount, 0);
  return { asOf, rows, reconciliation: { balance: round2(balance), table: round2(table), difference: round2(table - balance), wip: round2(wip) } };
}

/** 1С-ээс тухайн өдрийн (өдрийн эцсийн) агуулахын үлдэгдлийг татна (бүх хүсэлт GET) */
export function fetchStockLive(date: string): Promise<StockLive> {
  return withOneCYear(yearOf(date), async () => {
    const book = await loadAccountBook();
    const keys = keysWithPrefix(book, STOCK_PREFIX);
    // Шүүлтгүй Balance нь бүх дансны мөрийг буцаадаг: 14xx данс олдохгүй бол 1С руу хандахгүй
    if (keys.length === 0) return { asOf: date, rows: [], reconciliation: { balance: 0, table: 0, difference: 0, wip: 0 } };
    const filter = keys.map((k) => `Account_Key eq guid'${k}'`).join(" or ");
    const select = "Account_Key,ExtDimension1,ExtDimension1_Type,ExtDimension2,ExtDimension2_Type,СуммаBalance,КоличествоBalance";
    const balances = await odataRows(`${enc(REGISTER)}/Balance(Period=datetime'${balanceBoundary(date)}')?$format=json&$select=${enc(select)}&$filter=${enc(filter)}&$top=${BALANCE_TOP}`, { timeoutMs: 60_000 });
    if (balances.length >= BALANCE_TOP) throw new OdataError(502, "Агуулахын үлдэгдлийн мөр хэт олон байна");

    const keyList = (field: string, type: string) => [...new Set(balances.filter((r) => text(r[`${field}_Type`]).endsWith(type)).map((r) => realKey(r[field])).filter((k): k is string => !!k))];
    const [items, warehouses] = await Promise.all([
      lookupRows(ITEM_TYPE, keyList("ExtDimension1", ITEM_TYPE), "Description,Code,ЕдиницаИзмерения_Key"),
      lookupRows(WAREHOUSE_TYPE, keyList("ExtDimension2", WAREHOUSE_TYPE), "Description,Code"),
    ]);
    const units = await lookupRows("Catalog_КлассификаторЕдиницИзмерения", [...items.values()].map((r) => realKey(r?.["ЕдиницаИзмерения_Key"])).filter((k): k is string => !!k), "Description");
    return buildStockLive(date, balances, book, {
      items: new Map([...items].map(([k, r]) => [k, { name: text(r?.Description), code: text(r?.Code), unit: text(units.get(realKey(r?.["ЕдиницаИзмерения_Key"]) ?? "")?.Description) }])),
      warehouses: new Map([...warehouses].map(([k, r]) => [k, { name: text(r?.Description), code: text(r?.Code) }])),
    });
  });
}

/** 5 минутын cache-тай (зэрэг олон хүн нээвэл нэг л хүсэлт 1С руу очно; 1С алдаа өгвөл сүүлд татсан нь) */
export function loadStockLive(date: string, refresh = false): Promise<{ value: StockLive; meta: CacheMeta }> {
  return cachedLoad(`stocklive:${date}`, () => fetchStockLive(date), { refresh });
}
