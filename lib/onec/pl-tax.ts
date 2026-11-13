// Зардал: 8xxx, 9xxx дансууд (татвар г.м.). 1С-ийн /hs/dash/pl нь зөвхөн 5xxx-7xxx-ийг буцаадаг тул (2026-10: 9102 «Хүүгийн орлогын
// албан татвар» 5,388,967.93₮ дутсан) нягтлан бодох бүртгэлийн регистрээс (OData Turnovers, ЗӨВХӨН УНШИХ) нэмж, onec_pl-д хадгална.
// Нэг данс: зардал = Дт эргэлт - Кт эргэлт. 9200 «Орлого зарлагын нэгдсэн данс» нь хаалтын данс (Дт = Кт) тул оруулахгүй.
import type { PlRow } from "./client";
import { enc, num, odataRows } from "./odata-read";
import { withOneCYear, yearOf } from "./year-context";

const REGISTER = "AccountingRegister_Хозрасчетный";
export const PL_TAX_PREFIXES: readonly string[] = ["8", "9"];
/** хаалтын (нэгтгэх) данс: Дт = Кт тул зардал биш */
export const PL_TAX_EXCLUDED: readonly string[] = ["9200"];
export const PL_TAX_GROUP = "tax";

const codeKey = (code: string) => code.replace(/\..*$/, "").trim();

export const odataConfigured = (env: Record<string, string | undefined> = process.env): boolean => !!(env.ONEC_ODATA_BASE_URL?.trim() && env.ONEC_ODATA_USER && env.ONEC_ODATA_PASSWORD);

/** Цэвэр нэгтгэл (тестлэгдэнэ): Turnovers-ийн мөрүүдээс данс бүрийн зардлын мөр */
export function buildPlTaxRows(month: string, accounts: Map<string, { code: string; name: string }>, turnovers: Record<string, unknown>[]): PlRow[] {
  const perAccount = new Map<string, number>();
  for (const r of turnovers) {
    const acc = accounts.get(String(r.Account_Key ?? "").toLowerCase());
    if (!acc) continue;
    perAccount.set(acc.code, (perAccount.get(acc.code) ?? 0) + num(r["СуммаTurnoverDr"]) - num(r["СуммаTurnoverCr"]));
  }
  const names = new Map([...accounts.values()].map((a) => [a.code, a.name]));
  return [...perAccount]
    .filter(([, amount]) => Math.abs(amount) >= 0.005)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, amount]) => ({ month, item_code: "", item: names.get(code) ?? "", account: code, group: PL_TAX_GROUP, side: "expense", amount: Math.round(amount * 100) / 100 }));
}

/** 1С-ээс сарын 8xxx-9xxx дансны зардал (бүх хүсэлт GET) */
export function fetchPlTaxRows(month: string, from: string, to: string): Promise<PlRow[]> {
  return withOneCYear(yearOf(month), () => fetchPlTaxRowsIn(month, from, to)); // тухайн сарын оны бааз (ONEC_BASES)
}

async function fetchPlTaxRowsIn(month: string, from: string, to: string): Promise<PlRow[]> {
  const accounts = new Map<string, { code: string; name: string }>();
  for (const prefix of PL_TAX_PREFIXES) {
    const rows = await odataRows(`${enc("ChartOfAccounts_Хозрасчетный")}?$format=json&$select=${enc("Ref_Key,Code,Description")}&$filter=${enc(`startswith(Code,'${prefix}')`)}&$top=500`);
    for (const r of rows) {
      const code = String(r.Code ?? "");
      if (!PL_TAX_EXCLUDED.includes(codeKey(code))) accounts.set(String(r.Ref_Key).toLowerCase(), { code, name: String(r.Description ?? "") });
    }
  }
  if (accounts.size === 0) return [];
  const filter = [...accounts.keys()].map((k) => `Account_Key eq guid'${k}'`).join(" or ");
  const turnovers = await odataRows(
    `${enc(REGISTER)}/Turnovers(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59')?$format=json&$select=${enc("Account_Key,СуммаTurnoverDr,СуммаTurnoverCr")}&$filter=${enc(filter)}&$top=20000`,
    { timeoutMs: 60_000 }
  );
  return buildPlTaxRows(month, accounts, turnovers);
}
