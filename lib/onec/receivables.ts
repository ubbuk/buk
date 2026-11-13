// «Авлага» таб: өдрийн эцсийн авлагын үлдэгдэл харилцагчаар. Зөвхөн 1С-ээс УНШИНА (GET).
//
// Balance нь 1С дээр удаан (1201 ~5-9 сек, НӨАТ-ын 1271 ~35-110 сек) тул хуудас 1С-ийг хүлээхгүй: ар талын ажил данс бүрийг
// дарааллаар татаж Postgres-ийн агшин зураг (lib/onec/receivables-store.ts) руу бичнэ, хуудас агшин зургийг шууд харуулна.
//
// AccountingRegister_Хозрасчетный/Balance(Period, Condition) функц. Condition нь зөвхөн ExtDimension1 = Харилцагч гэж шүүнэ
// (Account_Key-ийг Condition-д өгвөл 1С 500 буцаадаг тул данс $filter-ээр сонгогдоно). Balance нь $skip үл тоодог тул нэг л удаа
// том $top-оор авч, хязгаарт хүрвэл алдаа өгнө (тасархай өгөгдөл харуулахгүй).
//
// Данс: 1201 (худалдан авагчаас авах авлага, толгой тоо) болон НӨАТ-ын авлага 1271, 1272 тусдаа мөр. 1209 (найдваргүй авлагын
// хасагдуулга) тооцогдохгүй. Нийт, Топ 10 нь зөвхөн 1201.
import { enc, lookupRows, num, odataRows, OdataError, realKey, type Row } from "./odata-read";

const REGISTER = "AccountingRegister_Хозрасчетный";
const CHART = "ChartOfAccounts_Хозрасчетный";
const CONTRACTOR_TYPE = "StandardODATA.Catalog_Контрагенты";
const TOP = 20_000;
/** Ар талын ажил: Balance 110 сек хүртэл үргэлжилж байсан */
const BALANCE_TIMEOUT_MS = 180_000;

/** Толгой авлага */
export const MAIN_ACCOUNT = "1201";
/** НӨАТ-ын авлага: тусдаа мөр, толгой дүнд орохгүй */
export const VAT_ACCOUNTS = ["1271", "1272"] as const;
const TRACKED: string[] = [MAIN_ACCOUNT, ...VAT_ACCOUNTS];
/** Татах дараалал: хурдан толгой данс эхэлж (хуудас хурдан бүрдэнэ), хамгийн удаан 1271 сүүлд */
export const STAGES: readonly string[] = [MAIN_ACCOUNT, "1272", "1271"];

export interface ReceivableCustomer {
  key: string;
  name: string;
  /** Дт - Кт (1201); сөрөг нь урьдчилж төлсөн */
  balance: number;
  /** нийт дүнд эзлэх хувь (зөвхөн өртэй харилцагчдын нийлбэрт харьцуулна) */
  share: number;
}
export interface ReceivableAccount {
  code: string;
  name: string;
  balance: number;
  customers: number;
}
export interface ReceivablesResult {
  asOf: string;
  totals: { receivable: number; debit: number; credit: number; customers: number; debtors: number; vat: number };
  accounts: ReceivableAccount[];
  customers: ReceivableCustomer[];
  top: ReceivableCustomer[];
}

/** Агшин зургийн мөр (onec_receivable_balances): 1201 нь харилцагч бүрээр, НӨАТ-ын данс нэг нэгтгэсэн мөрөөр */
export interface SnapshotRow {
  accountCode: string;
  accountName: string;
  customerKey: string;
  customer: string;
  balance: number;
  customers: number;
}

export interface ReceivablesInputs {
  asOf: string;
  /** Balance-ийн мөрүүд */
  balances: Row[];
  /** Account_Key (GUID) -> {code, name} */
  accounts: Map<string, { code: string; name: string }>;
  /** Харилцагчийн GUID -> нэр */
  names: Map<string, string>;
}

const UNKNOWN = "Тодорхойгүй";
const round2 = (v: number) => Math.round(v * 100) / 100;
const codeKey = (code: string) => code.replace(/\..*$/, "").trim(); // "1201.00" -> "1201"

/** Нийтлэг дүгнэлт: 1201-ийн харилцагчид (цэвэр үлдэгдэлтэй) ба дансны дүнгээс тайланг бүтээнэ. Техникийн нэр гарахгүй. */
function shape(asOf: string, main: { key: string; name: string; balance: number }[], accountsIn: ReceivableAccount[]): ReceivablesResult {
  const debit = main.filter((c) => c.balance > 0).reduce((s, c) => s + c.balance, 0);
  const credit = -main.filter((c) => c.balance < 0).reduce((s, c) => s + c.balance, 0);
  const customers: ReceivableCustomer[] = main
    .filter((c) => Math.round(c.balance * 100) !== 0)
    .map((c) => ({ key: c.key, name: c.name || UNKNOWN, balance: round2(c.balance), share: c.balance > 0 && debit ? Math.round((c.balance / debit) * 1000) / 10 : 0 }))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "mn"));
  // 1201: цэвэр үлдэгдэл нь 0-ээс ялгаатай харилцагчдын тоо
  const accounts = TRACKED.flatMap((code) => accountsIn.filter((a) => a.code === code)).map((a) => ({ ...a, customers: a.code === MAIN_ACCOUNT ? customers.length : a.customers }));
  const balanceOf = (code: string) => accounts.find((a) => a.code === code)?.balance ?? 0;
  return {
    asOf,
    totals: {
      receivable: round2(balanceOf(MAIN_ACCOUNT)),
      debit: round2(debit),
      credit: round2(credit),
      customers: customers.length,
      debtors: customers.filter((c) => c.balance > 0).length,
      vat: round2(VAT_ACCOUNTS.reduce((s, c) => s + balanceOf(c), 0)),
    },
    accounts,
    customers,
    top: customers.filter((c) => c.balance > 0).slice(0, 10),
  };
}

/** Цэвэр нэгтгэл (тестлэгдэнэ): Balance-ийн мөрүүдээс тайланг бүтээнэ. */
export function buildReceivables({ asOf, balances, accounts, names }: ReceivablesInputs): ReceivablesResult {
  const perAccount = new Map<string, { name: string; balance: number; customers: Set<string> }>();
  const perCustomer = new Map<string, number>(); // зөвхөн 1201
  for (const r of balances) {
    const acc = accounts.get(String(r.Account_Key ?? "").toLowerCase());
    if (!acc || !TRACKED.includes(codeKey(acc.code))) continue;
    if (!String(r.ExtDimension1_Type ?? "").endsWith("Catalog_Контрагенты")) continue;
    const customer = realKey(r.ExtDimension1) ?? "";
    const amount = num(r["СуммаBalance"]);
    const code = codeKey(acc.code);
    const cur = perAccount.get(code) ?? { name: acc.name, balance: 0, customers: new Set<string>() };
    cur.balance += amount;
    if (amount !== 0) cur.customers.add(customer);
    perAccount.set(code, cur);
    if (code === MAIN_ACCOUNT) perCustomer.set(customer, (perCustomer.get(customer) ?? 0) + amount);
  }
  return shape(
    asOf,
    [...perCustomer].map(([key, balance]) => ({ key, name: (key && names.get(key)) || "", balance })),
    [...perAccount].map(([code, a]) => ({ code, name: a.name, balance: round2(a.balance), customers: a.customers.size }))
  );
}

/** Нэг дансны Balance-ийн мөрүүдээс агшин зургийн мөр (цэвэр, тестлэгдэнэ). 1201: харилцагч бүрээр; НӨАТ: нэг мөр; хоосон бол 0-тэй тэмдэглэгээ мөр */
export function stageRows(code: string, accountName: string, balances: Row[], names: Map<string, string>): SnapshotRow[] {
  const valid = balances.filter((r) => String(r.ExtDimension1_Type ?? "").endsWith("Catalog_Контрагенты") && num(r["СуммаBalance"]) !== 0);
  if (code !== MAIN_ACCOUNT) {
    const customers = new Set(valid.map((r) => realKey(r.ExtDimension1) ?? ""));
    return [{ accountCode: code, accountName, customerKey: "", customer: "", balance: round2(valid.reduce((s, r) => s + num(r["СуммаBalance"]), 0)), customers: customers.size }];
  }
  const per = new Map<string, number>();
  for (const r of valid) {
    const key = realKey(r.ExtDimension1) ?? "";
    per.set(key, (per.get(key) ?? 0) + num(r["СуммаBalance"]));
  }
  const rows = [...per].map(([key, balance]) => ({ accountCode: code, accountName, customerKey: key, customer: (key && names.get(key)) || "", balance: round2(balance), customers: 1 }));
  return rows.length ? rows : [{ accountCode: code, accountName, customerKey: "", customer: "", balance: 0, customers: 0 }];
}

/** Агшин зургийн мөрүүдээс тайлан (Postgres-оос шууд, 1С-гүй) */
export function fromSnapshotRows(asOf: string, rows: SnapshotRow[]): ReceivablesResult {
  const main = rows.filter((r) => r.accountCode === MAIN_ACCOUNT && r.customers > 0).map((r) => ({ key: r.customerKey, name: r.customer, balance: r.balance }));
  const byCode = new Map<string, ReceivableAccount>();
  for (const r of rows) {
    const cur = byCode.get(r.accountCode) ?? { code: r.accountCode, name: r.accountName, balance: 0, customers: 0 };
    cur.balance = round2(cur.balance + r.balance);
    cur.customers += r.customers;
    byCode.set(r.accountCode, cur);
  }
  return shape(asOf, main, [...byCode.values()]);
}

/**
 * Дансны төлөвлөгөөнөөс 1201, 1271, 1272 (код нь «1201.00» хэлбэртэй). Сервер талд startswith(Code,'12') (59 данс) гэж шүүнэ:
 * дансны төлөвлөгөөг эрэмбэгүй хуудаслахад 1С мөр давхардуулж, зарим дансыг (1201) алдагдуулдаг.
 */
async function fetchAccounts(): Promise<Map<string, { code: string; name: string }>> {
  const rows = await odataRows(`${enc(CHART)}?$format=json&$select=${enc("Ref_Key,Code,Description")}&$filter=${enc("startswith(Code,'12')")}&$top=500`);
  const out = new Map<string, { code: string; name: string }>();
  for (const r of rows) {
    const code = String(r.Code ?? "");
    if (TRACKED.includes(codeKey(code))) out.set(String(r.Ref_Key).toLowerCase(), { code, name: String(r.Description ?? "") });
  }
  return out;
}

/**
 * Нэг дансны өдрийн эцсийн үлдэгдлийг 1С-ээс татаж агшин зургийн мөр болгоно (бүх хүсэлт GET, 180 сек хүртэл).
 * Данс дансны төлөвлөгөөнд байхгүй бол null (1272 байхгүй 1С-д алдаа биш); толгой 1201 байхгүй бол алдаа.
 */
export async function fetchStage(asOf: string, code: string): Promise<SnapshotRow[] | null> {
  const accounts = [...(await fetchAccounts())].filter(([, a]) => codeKey(a.code) === code);
  if (accounts.length === 0) {
    if (code === MAIN_ACCOUNT) throw new OdataError(502, "Авлагын данс 1С-ээс олдсонгүй");
    return null;
  }
  const cond = `ExtDimension1_Type eq '${CONTRACTOR_TYPE}'`.replace(/'/g, "''");
  const filter = `(${accounts.map(([k]) => `Account_Key eq guid'${k}'`).join(" or ")}) and СуммаBalance ne 0`;
  const rows = await odataRows(`${enc(REGISTER)}/Balance(Period=datetime'${asOf}T23:59:59',Condition='${enc(cond)}')?$format=json&$filter=${enc(filter)}&$top=${TOP}`, { timeoutMs: BALANCE_TIMEOUT_MS });
  if (rows.length >= TOP) throw new OdataError(502, "Авлагын мөр хэт олон байна. Админд хандана уу");
  const wanted = new Set(accounts.map(([k]) => k));
  const balances = rows.filter((r) => wanted.has(String(r.Account_Key ?? "").toLowerCase())); // шүүлтийг 1С буруу биелүүлсэн ч өөр данс орохгүй

  // Нэрийг зөвхөн 1201-ийн харилцагчдад авна (НӨАТ-ын данс харилцагчаар харагдахгүй)
  let names = new Map<string, string>();
  if (code === MAIN_ACCOUNT) {
    const keys = [...new Set(balances.map((r) => realKey(r.ExtDimension1)).filter((k): k is string => !!k))];
    const found = await lookupRows("Catalog_Контрагенты", keys, "Description");
    names = new Map([...found].map(([k, r]) => [k, String(r?.Description ?? "")]));
  }
  return stageRows(code, accounts[0][1].name, balances, names);
}
