// «Мөнгөн хөрөнгө»: 12 сарын орлого, зарлага. Сар бүрийн бичилтийг ХӨНГӨН хүсэлтээр (зөвхөн Дт, Кт данс, дүн) татаж нийлбэрлэнэ.
// Сар бүр өөрийн cache түлхүүртэй: хүсэлт дундаа таслагдсан ч дууссан саруудыг дахин татахгүй. 1С-д нэг дор 3-аас илүү хүсэлт явуулахгүй.
import { cachedLoad } from "./odata-cache";
import { asOfDate, currentMonth, monthRange } from "./dates";
import { enc, num, odataRows, OdataError, type Row } from "./odata-read";
import { fetchCashAccounts, orChain } from "./cash";
import { withOneCYear, yearOf } from "./year-context";

const REGISTER = "AccountingRegister_Хозрасчетный";
const TOP = 100_000;
const CONCURRENCY = 3;
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface CashTrendMonth {
  month: string;
  inflow: number;
  outflow: number;
  /** мөнгөний данс хоорондын шилжүүлэг: орлого, зарлагад тооцогдохгүй */
  internal: number;
}

/** Цэвэр (тестлэгдэнэ): Дт мөнгөний данс + Кт өөр = орлого; Кт мөнгөний данс + Дт өөр = зарлага; хоёулаа мөнгөний = шилжүүлэг. */
export function sumMonth(month: string, records: readonly Row[], cashKeys: ReadonlySet<string>): CashTrendMonth {
  let inflow = 0;
  let outflow = 0;
  let internal = 0;
  for (const r of records) {
    const dr = cashKeys.has(String(r.AccountDr_Key).toLowerCase());
    const cr = cashKeys.has(String(r.AccountCr_Key).toLowerCase());
    const a = num(r["Сумма"]);
    if (dr && cr) internal += a;
    else if (dr) inflow += a;
    else if (cr) outflow += a;
  }
  return { month, inflow: round2(inflow), outflow: round2(outflow), internal: round2(internal) };
}

function fetchMonth(month: string): Promise<CashTrendMonth> {
  return withOneCYear(yearOf(month), async () => {
    const accounts = await fetchCashAccounts();
    if (accounts.size === 0) throw new OdataError(502, "Мөнгөний данс 1С-ээс олдсонгүй");
    const keys = [...accounts.keys()];
    const { from, to } = monthRange(month);
    const records = await odataRows(
      `${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Top=${TOP})?$format=json&$select=${enc("AccountDr_Key,AccountCr_Key,Сумма")}&$filter=${enc(`(${orChain("AccountDr_Key", keys)}) or (${orChain("AccountCr_Key", keys)})`)}`,
      { timeoutMs: 60_000 }
    );
    if (records.length >= TOP) throw new OdataError(502, "Мөнгөн хөрөнгийн бичилт хэт олон байна. Админд хандана уу");
    return sumMonth(month, records, new Set(keys));
  });
}

/** 12 сар (ирээдүйн сарыг алгасна). Нэг сар унасан бол `failed` дээр тэмдэглэнэ, бусад нь харагдана. */
export async function loadCashTrend(year: string, refresh = false): Promise<{ months: CashTrendMonth[]; failed: string[]; fetchedAt: number }> {
  const now = currentMonth();
  const list = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= now);
  const months: CashTrendMonth[] = [];
  const failed: string[] = [];
  let fetchedAt = Date.now();
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(list.slice(i, i + CONCURRENCY).map((m) => cachedLoad(`cashmonth:${m}:${asOfDate(m)}`, () => fetchMonth(m), { refresh })));
    results.forEach((res, j) => {
      const m = list[i + j];
      if (res.status === "fulfilled") {
        months.push(res.value.value);
        fetchedAt = Math.min(fetchedAt, res.value.meta.fetchedAt);
      } else failed.push(m);
    });
  }
  return { months: months.sort((a, b) => a.month.localeCompare(b.month)), failed, fetchedAt };
}
