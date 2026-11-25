// Бүтээгдэхүүний тулгалт (ЗӨВХӨН УНШИХ, 1С GET): «Бүтээгдэхүүн» табын 3 тоо (үйлдвэрлэсэн, зарсан, эцсийн үлдэгдэл)-г 1С-ийн
// бэлэн бүтээгдэхүүний дансны (1441) бичилттэй тулгана.
//   npm run onec:product-check -- 2026-10 "Төмөр бетон цагираг Ф-1000 Хүчитгэсэн" "Шон 80*80"
// Бүтээгдэхүүн бүр (Зас/Брак хувилбарууд тусад нь): эхний үлдэгдэл + үйлдвэрлэсэн − зарсан ± бусад хөдөлгөөн = эцсийн үлдэгдэл
// (Balance-тай тулгана). Өдөр бүрийн үйлдвэрлэл (--days). Нууц үг хэвлэхгүй.
import { loadAccountBook, shortCode } from "../lib/onec/accounts";
import { balanceBoundary, isMonth, monthRange } from "../lib/onec/dates";
import { enc, num, odataRows, realKey } from "../lib/onec/odata-read";
import { compactText } from "../lib/onec/product-search";
import { splitProductName } from "../lib/onec/production-names";
import { withOneCYear, yearOf } from "../lib/onec/year-context";

const REGISTER = "AccountingRegister_Хозрасчетный";
const NOMENCLATURE = "Catalog_Номенклатура";
const f = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Math.round(v * 1000) / 1000);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const kindOf = (recorder: string): string => {
  if (recorder.endsWith("ОтчетПроизводстваЗаСмену")) return "production";
  if (recorder.endsWith("РеализацияТоваровУслуг")) return "sale";
  return recorder.replace(/^.*\./, "") || "other";
};

async function findItems(base: string): Promise<{ key: string; name: string }[]> {
  const token = base
    .split(/[\s/*()]+/u)
    .filter((w) => w.length >= 3)
    .sort((a, b) => b.length - a.length)[0] ?? base;
  const rows = await odataRows(`${enc(NOMENCLATURE)}?$format=json&$select=${enc("Ref_Key,Description")}&$filter=${enc(`substringof('${token.replace(/'/g, "''")}',Description)`)}&$top=1000`);
  const want = compactText(splitProductName(base).base);
  return rows
    .map((r) => ({ key: String(r.Ref_Key).toLowerCase(), name: String(r.Description ?? "").replace(/\s+/g, " ").trim() }))
    .filter((r) => compactText(splitProductName(r.name).base) === want);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--days");
  const showDays = process.argv.includes("--days");
  const month = args[0];
  const bases = args.slice(1);
  if (!isMonth(month) || bases.length === 0) throw new Error('Жишээ: onec:product-check -- 2026-10 "Шон 80*80" [--days]');
  const { from, to } = monthRange(month);
  await withOneCYear(yearOf(month), async () => {
    const book = await loadAccountBook();
    const accs = [...book.byKey.values()].filter((a) => shortCode(a.code).replace(/\..*$/, "") === "1441");
    const accKeys = accs.map((a) => a.key);
    const accFilter = (field: string) => accKeys.map((k) => `${field} eq guid'${k}'`).join(" or ");
    // Сарын бүх 1441-ийн бичилт, эхний/эцсийн үлдэгдлийг НЭГ удаа татаж, бүтээгдэхүүн бүрийг санах ойд ялгана (1С-д 3 хүсэлт)
    const accF = (field: string) => accKeys.map((k) => `${field} eq guid'${k}'`).join(" or ");
    const select = "Period,Recorder_Type,AccountDr_Key,AccountCr_Key,КоличествоDr,КоличествоCr,ExtDimensionDr1,ExtDimensionCr1";
    const records = await odataRows(
      `${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Top=50000)?$format=json&$select=${enc(select)}&$filter=${enc(`(${accF("AccountDr_Key")}) or (${accF("AccountCr_Key")})`)}`,
      { timeoutMs: 120_000 }
    );
    const balanceAt = async (date: string) => {
      await pause(1500);
      const rows = await odataRows(`${enc(REGISTER)}/Balance(Period=datetime'${balanceBoundary(date)}')?$format=json&$top=20000&$filter=${enc(`(${accF("Account_Key")})`)}`, { timeoutMs: 90_000 });
      const m = new Map<string, number>();
      for (const r of rows) {
        const k = realKey(r.ExtDimension1);
        if (k) m.set(k, (m.get(k) ?? 0) + num(r["КоличествоBalance"]));
      }
      return m;
    };
    const prev = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const openingMap = await balanceAt(prev);
    const closingMap = await balanceAt(to);
    for (const base of bases) {
      const items = await findItems(base);
      console.log(`
=== ${base} (${items.length} нэр)`);
      for (const it of items) {
        const sum = new Map<string, { dr: number; cr: number }>();
        const days = new Map<string, number>();
        for (const r of records) {
          const drIn = accKeys.includes(String(r.AccountDr_Key).toLowerCase()) && realKey(r.ExtDimensionDr1) === it.key;
          const crIn = accKeys.includes(String(r.AccountCr_Key).toLowerCase()) && realKey(r.ExtDimensionCr1) === it.key;
          if (!drIn && !crIn) continue;
          const k = kindOf(String(r.Recorder_Type ?? ""));
          const s = sum.get(k) ?? { dr: 0, cr: 0 };
          if (drIn) s.dr += num(r["КоличествоDr"]);
          if (crIn) s.cr += num(r["КоличествоCr"]);
          sum.set(k, s);
          const d = String(r.Period).slice(0, 10);
          if (k === "production" && drIn) days.set(d, (days.get(d) ?? 0) + num(r["КоличествоDr"]));
        }
        const opening = openingMap.get(it.key) ?? 0;
        const closing = closingMap.get(it.key) ?? 0;
        const get = (k: string) => sum.get(k) ?? { dr: 0, cr: 0 };
        const prod = get("production").dr - get("production").cr;
        const sold = get("sale").cr - get("sale").dr;
        const others = [...sum].filter(([k]) => k !== "production" && k !== "sale").map(([k, v]) => ({ k, net: v.dr - v.cr }));
        const otherNet = others.reduce((a, o) => a + o.net, 0);
        const calc = opening + prod - sold + otherNet;
        console.log(`  - ${it.name}: эхний ${f(opening)} + үйлдвэрлэсэн ${f(prod)} − зарсан ${f(sold)} ± бусад ${f(otherNet)} [${others.map((o) => `${o.k} ${f(o.net)}`).join(", ") || "—"}] = ${f(calc)} · эцсийн (Balance) ${f(closing)} ${Math.abs(calc - closing) < 0.001 ? "✓" : "✗ зөрсөн"}`);
        if (showDays) console.log(`      өдөр: ${[...days].sort().map(([d, q]) => `${d.slice(5)}: ${f(q)}`).join(", ")}`);
      }
    }
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
