// «Зарцуулалт»: сар бүрийн нийт зарцуулалт (12 сарын график). Сар бүр шаардах хуудасны бичилтийн ХӨНГӨН хүсэлт (зөвхөн дүн, бараа материалын
// төрөл), Posted баримтын бичилт. Сар бүр өөрийн cache түлхүүртэй; 1С-д нэг дор 3-аас илүү хүсэлт явуулахгүй.
import { cachedLoad } from "./odata-cache";
import { asOfDate, currentMonth, monthRange } from "./dates";
import { enc, num, odataRows, OdataError, type Row } from "./odata-read";
import { withOneCYear, yearOf } from "./year-context";

const REGISTER = "AccountingRegister_Хозрасчетный";
const RECORDER_TYPE = "StandardODATA.Document_ТребованиеНакладная";
const ITEM_TYPE = "Catalog_Номенклатура";
const TOP = 100_000;
const CONCURRENCY = 3;
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface UsageTrendMonth {
  month: string;
  amount: number;
}

/** Цэвэр: бараа материалын кредит талын бичилтийн дүнгийн нийлбэр (buildUsage-тай ижил дүрэм) */
export function sumUsage(records: readonly Row[]): number {
  let total = 0;
  for (const r of records) if (String(r.ExtDimensionCr1_Type ?? "").endsWith(ITEM_TYPE)) total += num(r["Сумма"]);
  return round2(total);
}

function fetchMonth(month: string): Promise<number> {
  return withOneCYear(yearOf(month), async () => {
    const { from, to } = monthRange(month);
    const cond = `Recorder_Type eq '${RECORDER_TYPE}'`.replace(/'/g, "''");
    const records = await odataRows(
      `${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Condition='${enc(cond)}',Top=${TOP})?$format=json&$select=${enc("Сумма,ExtDimensionCr1_Type")}`,
      { timeoutMs: 60_000 }
    );
    if (records.length >= TOP) throw new OdataError(502, "Зарцуулалтын бичилт хэт олон байна. Админд хандана уу");
    return sumUsage(records);
  });
}

export async function loadUsageTrend(year: string, refresh = false): Promise<{ months: UsageTrendMonth[]; failed: string[]; fetchedAt: number }> {
  const now = currentMonth();
  const list = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= now);
  const months: UsageTrendMonth[] = [];
  const failed: string[] = [];
  let fetchedAt = Date.now();
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const part = list.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(part.map((m) => cachedLoad(`usagetotal:${m}:${asOfDate(m)}`, () => fetchMonth(m), { refresh })));
    results.forEach((res, j) => {
      if (res.status === "fulfilled") {
        months.push({ month: part[j], amount: res.value.value });
        fetchedAt = Math.min(fetchedAt, res.value.meta.fetchedAt);
      } else failed.push(part[j]);
    });
  }
  return { months: months.sort((a, b) => a.month.localeCompare(b.month)), failed, fetchedAt };
}
