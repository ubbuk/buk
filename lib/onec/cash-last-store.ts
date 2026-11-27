// Дансны сүүлийн гүйлгээг хайх 1С-ийн (ЗӨВХӨН GET) хөнгөн хүсэлт: сар бүрийн Turnovers-ээр хөдөлгөөнтэй дансыг л шалгана. Эх логик: lib/onec/cash-activity.ts
import { cachedLoad } from "./odata-cache";
import { fetchCashAccounts, loadCash, orChain } from "./cash";
import type { LastMoveDeps } from "./cash-activity";
import { monthRange } from "./dates";
import { enc, num, odataRows, realKey } from "./odata-read";
import { withOneCYear, yearOf } from "./year-context";

const REGISTER = enc("AccountingRegister_Хозрасчетный");
const BANK = "Catalog_БанковскиеСчета";

/** Тэр сард Дт эсвэл Кт эргэлттэй мөнгөний дансны түлхүүр (`bank:<guid>` | `acct:<код>`) */
async function fetchTurnoverKeys(month: string): Promise<ReadonlySet<string>> {
  return withOneCYear(yearOf(month), async () => {
    const accounts = await fetchCashAccounts();
    const { from, to } = monthRange(month);
    const filter = enc(`(${orChain("Account_Key", [...accounts.keys()])})`);
    const rows = await odataRows(`${REGISTER}/Turnovers(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59')?$format=json&$filter=${filter}&$top=20000`, { timeoutMs: 60_000 });
    const out = new Set<string>();
    for (const r of rows) {
      if (!num(r["СуммаTurnoverDr"]) && !num(r["СуммаTurnoverCr"])) continue;
      const acc = accounts.get(String(r.Account_Key).toLowerCase());
      if (!acc) continue;
      let bank: string | null = null;
      for (const n of [1, 2, 3]) if (String(r[`ExtDimension${n}_Type`] ?? "").endsWith(BANK)) bank = realKey(r[`ExtDimension${n}`]);
      out.add(bank ? `bank:${bank}` : `acct:${acc.code.replace(/\..*$/, "").trim()}`);
    }
    return out;
  });
}

/** Үйлчилгээний анхдагч хайлт: Turnovers (5 минутын cache) + сарын бүтэн мэдээ (loadCash-ийн cache) */
export const defaultLastMoveDeps: LastMoveDeps = {
  turnoverKeys: async (month) => (await cachedLoad(`cashturn:${month}`, () => fetchTurnoverKeys(month))).value,
  loadMonth: async (month) => (await loadCash(month)).value,
};
