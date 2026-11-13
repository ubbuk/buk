// «Дуусаагүй үйлдвэрлэл» (142x: 1421, 1423, 1424): Агуулах табд бараатай холихгүй, тусдаа KPI. Эдгээр нь агуулахын бараа биш,
// үйлдвэрлэлд хуримтлагдсан зардал тул /hs/dash/stock-д ордоггүй. 1С-ийн OData Balance (ЗӨВХӨН УНШИХ), сарын эцсийн (одоогийн сар
// бол өнөөдрийн) үлдэгдэл, lib/onec/dates.ts balanceBoundary. 5 минутын cache.
import { cachedLoad, type CacheMeta } from "./odata-cache";
import { asOfDate, balanceBoundary } from "./dates";
import { enc, num, odataRows } from "./odata-read";

export const WIP_PREFIX = "142";

export interface WipResult {
  asOf: string;
  total: number;
  accounts: { code: string; name: string; balance: number }[];
}

/** Цэвэр нэгтгэл (тестлэгдэнэ) */
export function buildWip(asOf: string, accounts: Map<string, { code: string; name: string }>, balances: Record<string, unknown>[]): WipResult {
  const per = new Map<string, number>();
  for (const r of balances) {
    const acc = accounts.get(String(r.Account_Key ?? "").toLowerCase());
    if (acc) per.set(acc.code, (per.get(acc.code) ?? 0) + num(r["СуммаBalance"]));
  }
  const list = [...per]
    .filter(([, v]) => Math.abs(v) >= 0.005)
    .map(([code, balance]) => ({ code, name: [...accounts.values()].find((a) => a.code === code)?.name ?? "", balance: Math.round(balance * 100) / 100 }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return { asOf, total: Math.round(list.reduce((s, a) => s + a.balance, 0) * 100) / 100, accounts: list };
}

export async function fetchWip(month: string): Promise<WipResult> {
  const asOf = asOfDate(month);
  const chart = await odataRows(`${enc("ChartOfAccounts_Хозрасчетный")}?$format=json&$select=${enc("Ref_Key,Code,Description")}&$filter=${enc(`startswith(Code,'${WIP_PREFIX}')`)}&$top=500`);
  const accounts = new Map(chart.map((r) => [String(r.Ref_Key).toLowerCase(), { code: String(r.Code ?? ""), name: String(r.Description ?? "") }]));
  if (accounts.size === 0) return { asOf, total: 0, accounts: [] };
  const filter = [...accounts.keys()].map((k) => `Account_Key eq guid'${k}'`).join(" or ");
  const balances = await odataRows(
    `${enc("AccountingRegister_Хозрасчетный")}/Balance(Period=datetime'${balanceBoundary(asOf)}')?$format=json&$select=${enc("Account_Key,СуммаBalance")}&$filter=${enc(filter)}&$top=20000`,
    { timeoutMs: 60_000 }
  );
  return buildWip(asOf, accounts, balances);
}

export function loadWip(month: string, refresh = false): Promise<{ value: WipResult; meta: CacheMeta }> {
  return cachedLoad(`wip:${month}:${asOfDate(month)}`, () => fetchWip(month), { refresh });
}
