// Мөнгөн хөрөнгийн тулгалт (ЗӨВХӨН УНШИХ): «Мөнгөн хөрөнгө» табын тоог 1С-ийн Balance, Turnovers-тай тулгана.
//   npm run onec:cash-check -- 2026-11
// Данс бүр: эхний үлдэгдэл (Balance) + Дт эргэлт - Кт эргэлт (Turnovers) = эцсийн үлдэгдэл (Balance) мөн эсэх, мөн табын (бичилтээс
// нэгтгэсэн) Дт, Кт нь 1С-ийн Turnovers-тай тэнцэх эсэх. Нууц үг хэвлэхгүй.
import { CASH_PREFIXES, fetchCash } from "../lib/onec/cash";
import { asOfDate, balanceBoundary, currentMonth, isMonth, monthRange } from "../lib/onec/dates";
import { enc, num, odataRows } from "../lib/onec/odata-read";

const f = (v: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round(v * 100) / 100);

async function main() {
  const month = process.argv[2] ?? currentMonth();
  if (!isMonth(month)) throw new Error("Жишээ: onec:cash-check 2026-11");
  const { from, to } = monthRange(month);
  const asOf = asOfDate(month);
  const tab = await fetchCash(month);

  const chart = (
    await Promise.all(CASH_PREFIXES.map((p) => odataRows(`ChartOfAccounts_${enc("Хозрасчетный")}?$format=json&$select=${enc("Ref_Key,Code,Description")}&$filter=${enc(`startswith(Code,'${p}')`)}&$top=500`)))
  ).flat();
  const code = new Map(chart.map((c) => [String(c.Ref_Key).toLowerCase(), String(c.Code).replace(/\..*$/, "")])); // 1101.00 -> 1101 (табын дансны кодтой ижил)
  const filter = enc([...code.keys()].map((k) => `Account_Key eq guid'${k}'`).join(" or "));
  const sumBy = (rows: Record<string, unknown>[], field: string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const c = code.get(String(r.Account_Key).toLowerCase());
      if (c) m.set(c, (m.get(c) ?? 0) + num(r[field]));
    }
    return m;
  };
  const R = enc("AccountingRegister_Хозрасчетный");
  const balance = (period: string) => odataRows(`${R}/Balance(Period=datetime'${period}')?$format=json&$filter=${filter}&$top=20000`, { timeoutMs: 120_000 });
  const open = sumBy(await balance(`${from}T00:00:00`), "СуммаBalance");
  const close = sumBy(await balance(balanceBoundary(asOf)), "СуммаBalance");
  const turn = await odataRows(`${R}/Turnovers(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59')?$format=json&$filter=${filter}&$top=20000`, { timeoutMs: 120_000 });
  const dr = sumBy(turn, "СуммаTurnoverDr");
  const cr = sumBy(turn, "СуммаTurnoverCr");

  // Табын тоо (бичилтээс): данс бүрийн Дт = орлого + шилжүүлэг орсон, Кт = зарлага + шилжүүлэг гарсан (банкны дансуудыг кодоор нэгтгэнэ)
  const tabDr = new Map<string, number>();
  const tabCr = new Map<string, number>();
  for (const a of tab.accounts) {
    tabDr.set(a.code, (tabDr.get(a.code) ?? 0) + a.inflow + a.transfersIn);
    tabCr.set(a.code, (tabCr.get(a.code) ?? 0) + a.outflow + a.transfersOut);
  }

  console.log(`\n${month}: эхний = ${from} 00:00:00 (Balance), эцсийн = ${asOf} өдрийн эцэс (Balance @ ${balanceBoundary(asOf)}), эргэлт = Turnovers ${from}..${to}\n`);
  console.log("Данс      Эхний үлдэгдэл   + Дт эргэлт      − Кт эргэлт      = Тооцсон        Эцсийн (Balance)  Зөрүү   | Табын Дт − 1С Дт | Табын Кт − 1С Кт");
  let bad = 0;
  for (const c of [...new Set([...open.keys(), ...close.keys(), ...dr.keys(), ...cr.keys()])].sort()) {
    const o = open.get(c) ?? 0, d = dr.get(c) ?? 0, k = cr.get(c) ?? 0, cl = close.get(c) ?? 0;
    if (!o && !d && !k && !cl) continue;
    const diff = cl - (o + d - k);
    const dd = (tabDr.get(c) ?? 0) - d, dk = (tabCr.get(c) ?? 0) - k;
    if (Math.abs(diff) >= 0.5 || Math.abs(dd) >= 0.5 || Math.abs(dk) >= 0.5) bad++;
    console.log(`${c.padEnd(8)} ${f(o).padStart(16)} ${f(d).padStart(16)} ${f(k).padStart(16)} ${f(o + d - k).padStart(16)} ${f(cl).padStart(16)} ${f(diff).padStart(8)} | ${f(dd).padStart(14)} | ${f(dk).padStart(14)}`);
  }
  const t = tab.totals;
  console.log(`\nТаб: эхний ${f(t.opening)} + орлого ${f(t.inflow)} − зарлага ${f(t.outflow)} (дотоод шилжүүлэг ${f(t.internal)} тооцоогүй) = ${f(t.expectedClosing)}; эцсийн ${f(t.closing)}; зөрүү ${f(t.difference)}`);
  console.log(bad === 0 ? "ТУЛГАЛТ ТААРСАН: бүх данс дээр зөрүү 0." : `ЗӨРҮҮТЭЙ ${bad} данс`);
  if (bad) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
