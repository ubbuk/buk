// «Мөнгөн хөрөнгө»: сарын график (12 сар) ба сарын тайлан (ангилал) хоёрыг 1С-ийн түүхий бичилттэй тулгана (ЗӨВХӨН УНШИХ, 1С GET).
//   npm run onec:cash-trend-check -- 2026
// Сар бүр: график (орсон, гарсан, дотоод шилжүүлэг) | тайлан (орсон, гарсан, ангиллын нийлбэр) | 1С-ийн түүхий Дт/Кт-аар тусад нь тоолсон (шилжүүлэггүй).
import { fetchCash } from "../lib/onec/cash";
import { loadCashTrend } from "../lib/onec/cash-trend";
import { currentMonth } from "../lib/onec/dates";
import { enc, odataRows } from "../lib/onec/odata-read";
import { fetchCashAccounts, orChain } from "../lib/onec/cash";
import { monthRange } from "../lib/onec/dates";
import { withOneCYear, yearOf } from "../lib/onec/year-context";
import { buildCashReport, withCategories } from "../lib/onec/cash-report";
import { loadCashRules } from "../lib/onec/cash-rules-store";

const f = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(v));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const year = process.argv[2] ?? currentMonth().slice(0, 4);
  const rules = await loadCashRules();
  const trend = await loadCashTrend(year, true);
  console.log("сар | график орсон | график гарсан | график шилжүүлэг | тайлан орсон | тайлан гарсан | ангилал орсон Σ | ангилал гарсан Σ | 1С түүхий орсон | 1С түүхий гарсан | 1С шилжүүлэг | таарсан");
  for (const m of trend.months) {
    await pause(1500);
    const cash = await fetchCash(m.month);
    const report = buildCashReport(cash, withCategories(cash.entries, rules, true));
    const catIn = report.inflow.categories.reduce((s, c) => s + c.total, 0);
    const catOut = report.outflow.categories.reduce((s, c) => s + c.total, 0);
    await pause(1500);
    const raw = await withOneCYear(yearOf(m.month), async () => {
      const accounts = await fetchCashAccounts();
      const keys = [...accounts.keys()];
      const { from, to } = monthRange(m.month);
      const rows = await odataRows(
        `${enc("AccountingRegister_Хозрасчетный")}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Top=100000)?$format=json&$select=${enc("AccountDr_Key,AccountCr_Key,Сумма")}&$filter=${enc(`(${orChain("AccountDr_Key", keys)}) or (${orChain("AccountCr_Key", keys)})`)}`,
        { timeoutMs: 90_000 }
      );
      const set = new Set(keys.map((k) => k.toLowerCase()));
      let inflow = 0;
      let outflow = 0;
      let internal = 0;
      for (const r of rows) {
        const dr = set.has(String(r.AccountDr_Key).toLowerCase());
        const cr = set.has(String(r.AccountCr_Key).toLowerCase());
        const a = Number(r["Сумма"]) || 0;
        if (dr && cr) internal += a;
        else if (dr) inflow += a;
        else if (cr) outflow += a;
      }
      return { inflow, outflow, internal };
    });
    const ok = [m.inflow - raw.inflow, m.outflow - raw.outflow, cash.totals.inflow - raw.inflow, cash.totals.outflow - raw.outflow, catIn - raw.inflow, catOut - raw.outflow].every((d) => Math.abs(d) < 1);
    console.log(
      [m.month, f(m.inflow), f(m.outflow), f(m.internal), f(cash.totals.inflow), f(cash.totals.outflow), f(catIn), f(catOut), f(raw.inflow), f(raw.outflow), f(raw.internal), ok ? "✓" : "✗"].join(" | ")
    );
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
