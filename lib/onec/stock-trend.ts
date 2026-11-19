// «Агуулах»: сар бүрийн эцсийн нийт үлдэгдэл (12 сарын график). Сар бүр хөнгөн Balance хүсэлт (зөвхөн дансны түлхүүр, дүн), 14xx дансны
// нийлбэр (142x дуусаагүй үйлдвэрлэлгүй, хүснэгтийн нийттэй ижил). Сар бүр өөрийн cache түлхүүртэй; 1С-д нэг дор 3-аас илүү хүсэлт явуулахгүй.
import { keysWithPrefix, loadAccountBook, type AccountBook } from "./accounts";
import { balanceBoundary, currentMonth, monthRange, today } from "./dates";
import { cachedLoad } from "./odata-cache";
import { enc, num, odataRows, OdataError, type Row } from "./odata-read";
import { STOCK_PREFIX, STOCK_WIP_PREFIX } from "./stock-live";
import { withOneCYear, yearOf } from "./year-context";

const REGISTER = "AccountingRegister_Хозрасчетный";
const TOP = 50_000;
const CONCURRENCY = 3;
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface StockTrendMonth {
  month: string;
  /** сарын эцсийн (одоогийн сард өнөөдрийн) нийт үлдэгдэл */
  amount: number;
  asOf: string;
}

/** Цэвэр: 142x-гүй 14xx Balance мөрүүдийн нийлбэр */
export function sumStock(rows: readonly Row[], book: AccountBook): number {
  let total = 0;
  for (const r of rows) {
    const acc = book.byKey.get(String(r.Account_Key).toLowerCase());
    if (!acc || acc.code.startsWith(STOCK_WIP_PREFIX)) continue;
    total += num(r["СуммаBalance"]);
  }
  return round2(total);
}

function fetchTotal(date: string): Promise<number> {
  return withOneCYear(yearOf(date), async () => {
    const book = await loadAccountBook();
    const keys = keysWithPrefix(book, STOCK_PREFIX);
    if (keys.length === 0) return 0;
    const filter = keys.map((k) => `Account_Key eq guid'${k}'`).join(" or ");
    const rows = await odataRows(`${enc(REGISTER)}/Balance(Period=datetime'${balanceBoundary(date)}')?$format=json&$select=${enc("Account_Key,СуммаBalance")}&$filter=${enc(filter)}&$top=${TOP}`, { timeoutMs: 60_000 });
    if (rows.length >= TOP) throw new OdataError(502, "Агуулахын үлдэгдлийн мөр хэт олон байна");
    return sumStock(rows, book);
  });
}

export async function loadStockTrend(year: string, refresh = false): Promise<{ months: StockTrendMonth[]; failed: string[]; fetchedAt: number }> {
  const now = currentMonth();
  const list = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= now);
  const months: StockTrendMonth[] = [];
  const failed: string[] = [];
  let fetchedAt = Date.now();
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const part = list.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      part.map((m) => {
        const asOf = m === now ? today() : monthRange(m).to;
        return cachedLoad(`stocktotal:${asOf}`, () => fetchTotal(asOf), { refresh }).then((r) => ({ month: m, asOf, ...r }));
      })
    );
    results.forEach((res, j) => {
      if (res.status === "fulfilled") {
        months.push({ month: res.value.month, amount: res.value.value, asOf: res.value.asOf });
        fetchedAt = Math.min(fetchedAt, res.value.meta.fetchedAt);
      } else failed.push(part[j]);
    });
  }
  return { months: months.sort((a, b) => a.month.localeCompare(b.month)), failed, fetchedAt };
}
