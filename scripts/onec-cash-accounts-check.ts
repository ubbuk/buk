// «Мөнгөн хөрөнгө» табын «Данснууд»-ыг 1С-тэй тулгана (ЗӨВХӨН УНШИХ, 1С GET). Нууц үг, бүтэн дансны дугаар хэвлэхгүй (сүүлийн 4 орон).
//   npm run onec:cash-accounts-check -- 2026-10 2026-11
// Сар бүр, данс (банкны данс эсвэл кассын дансны код) бүрээр: 1С-ийн Balance (сарын эхэнд, эцэст) ба Turnovers (Дт, Кт) -ийг ШУУД уншиж,
// табын тоотой тулгана:  эхний + орсон − гарсан = эцсийн (орсон = орлого + шилжүүлж ирсэн, гарсан = зарлага + шилжүүлсэн).
// Валютын данс бол валютаар (ВалютнаяСумма) мөн. Одоогийн сар бол «өнөөдөр»-ийн байдлаар.
import { asOfDate, balanceBoundary, isMonth, monthRange } from "../lib/onec/dates";
import { CASH_PREFIXES, fetchCash, fetchCashAccounts, orChain, parseBankAccountName } from "../lib/onec/cash";
import { last4 } from "../lib/onec/cash-accounts";
import { enc, lookupRows, num, odataRows, realKey } from "../lib/onec/odata-read";
import { withOneCYear, yearOf } from "../lib/onec/year-context";

const REGISTER = enc("AccountingRegister_Хозрасчетный");
const BANK = "Catalog_БанковскиеСчета";
const f = (v: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round(v * 100) / 100);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
void CASH_PREFIXES;

interface Raw {
  opening: number;
  closing: number;
  dr: number;
  cr: number;
  fxOpening: number;
  fxClosing: number;
  fxDr: number;
  fxCr: number;
}

async function check(month: string): Promise<number> {
  const { from, to } = monthRange(month);
  const asOf = asOfDate(month);
  const tab = await fetchCash(month);
  let bad = 0;
  await withOneCYear(yearOf(month), async () => {
    const accounts = await fetchCashAccounts();
    const keys = [...accounts.keys()];
    const filter = enc(`(${orChain("Account_Key", keys)})`);
    const balance = (period: string) => odataRows(`${REGISTER}/Balance(Period=datetime'${period}')?$format=json&$filter=${filter}&$top=20000`, { timeoutMs: 120_000 });
    const opening = await balance(`${from}T00:00:00`);
    await pause(1500);
    const closing = await balance(balanceBoundary(asOf));
    await pause(1500);
    const turn = await odataRows(`${REGISTER}/Turnovers(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59')?$format=json&$filter=${filter}&$top=20000`, { timeoutMs: 120_000 });

    const bankGuid = (r: Record<string, unknown>): string | null => {
      for (const n of [1, 2, 3]) if (String(r[`ExtDimension${n}_Type`] ?? "").endsWith(BANK)) return realKey(r[`ExtDimension${n}`]);
      return null;
    };
    const keyOf = (r: Record<string, unknown>) => {
      const acc = accounts.get(String(r.Account_Key).toLowerCase());
      if (!acc) return null;
      const b = bankGuid(r);
      return b ? `bank:${b}` : `acct:${acc.code.replace(/\..*$/, "").trim()}`;
    };
    const raw = new Map<string, Raw>();
    const row = (k: string) => raw.get(k) ?? raw.set(k, { opening: 0, closing: 0, dr: 0, cr: 0, fxOpening: 0, fxClosing: 0, fxDr: 0, fxCr: 0 }).get(k)!;
    for (const r of opening) { const k = keyOf(r); if (k) { const x = row(k); x.opening += num(r["СуммаBalance"]); x.fxOpening += num(r["ВалютнаяСуммаBalance"]); } }
    for (const r of closing) { const k = keyOf(r); if (k) { const x = row(k); x.closing += num(r["СуммаBalance"]); x.fxClosing += num(r["ВалютнаяСуммаBalance"]); } }
    for (const r of turn) { const k = keyOf(r); if (k) { const x = row(k); x.dr += num(r["СуммаTurnoverDr"]); x.cr += num(r["СуммаTurnoverCr"]); x.fxDr += num(r["ВалютнаяСуммаTurnoverDr"]); x.fxCr += num(r["ВалютнаяСуммаTurnoverCr"]); } }

    const banks = await lookupRows(BANK, [...raw.keys()].filter((k) => k.startsWith("bank:")).map((k) => k.slice(5)), "Description");
    const label = (k: string) => {
      if (!k.startsWith("bank:")) return `касс/данс ${k.slice(5)}`;
      const p = parseBankAccountName(String(banks.get(k.slice(5))?.Description ?? ""));
      return `${p.bank || "Банк"} ··${last4(p.number)} ${p.currency}`;
    };
    const ours = new Map(tab.accounts.map((a) => [a.key, a]));
    console.log(`\n=== ${month}: эхний = ${from} 00:00, эцсийн = ${asOf} өдрийн эцэс; эргэлт = Turnovers ${from}..${to}`);
    console.log("Данс | Эхний | Орсон (Дт) | Гарсан (Кт) | Эцсийн | эхний+орсон−гарсан | Табын эхний/орсон/гарсан/эцсийн | Төлөв");
    for (const k of [...new Set([...raw.keys(), ...ours.keys()])].sort()) {
      const r = raw.get(k) ?? { opening: 0, closing: 0, dr: 0, cr: 0, fxOpening: 0, fxClosing: 0, fxDr: 0, fxCr: 0 };
      const a = ours.get(k);
      if (!r.opening && !r.closing && !r.dr && !r.cr && !a) continue;
      const calc = r.opening + r.dr - r.cr;
      const tIn = a ? a.inflow + a.transfersIn : 0;
      const tOut = a ? a.outflow + a.transfersOut : 0;
      const okRaw = Math.abs(calc - r.closing) < 0.5;
      const okTab = !!a && Math.abs(a.opening - r.opening) < 0.5 && Math.abs(tIn - r.dr) < 0.5 && Math.abs(tOut - r.cr) < 0.5 && Math.abs(a.closing - r.closing) < 0.5;
      const fxOk = !a?.fx || (Math.abs(a.fx.opening - r.fxOpening) < 0.01 && Math.abs(a.fx.closing - r.fxClosing) < 0.01 && Math.abs(a.fx.inflow + a.fx.transfersIn - r.fxDr) < 0.01 && Math.abs(a.fx.outflow + a.fx.transfersOut - r.fxCr) < 0.01);
      if (!okRaw || !okTab || !fxOk) bad++;
      console.log(
        `${label(k)} | ${f(r.opening)} | ${f(r.dr)} | ${f(r.cr)} | ${f(r.closing)} | ${f(calc)} ${okRaw ? "✓" : "✗"} | ${a ? `${f(a.opening)} / ${f(tIn)} / ${f(tOut)} / ${f(a.closing)}` : "—"} | ${okTab ? "✓ таарсан" : "✗ ЗӨРСӨН"}${a?.fx ? ` · валют ${a.currency}: ${f(r.fxOpening)} + ${f(r.fxDr)} − ${f(r.fxCr)} = ${f(r.fxClosing)} ${fxOk ? "✓" : "✗"}` : ""}`
      );
    }
    const sum = (g: (x: Raw) => number) => [...raw.values()].reduce((s, x) => s + g(x), 0);
    console.log(`НИЙТ: эхний ${f(sum((x) => x.opening))} + ${f(sum((x) => x.dr))} − ${f(sum((x) => x.cr))} = ${f(sum((x) => x.opening + x.dr - x.cr))}; эцсийн (Balance) ${f(sum((x) => x.closing))}; табын эцсийн ${f(tab.totals.closing)}`);
  });
  return bad;
}

async function main() {
  const months = process.argv.slice(2);
  if (months.length === 0 || !months.every(isMonth)) throw new Error("Жишээ: onec:cash-accounts-check -- 2026-10 2026-11");
  let bad = 0;
  for (const m of months) bad += await check(m);
  console.log(bad === 0 ? "\nТУЛГАЛТ ТААРСАН: бүх данс, бүх сард." : `\nЗӨРҮҮТЭЙ ${bad} данс`);
  if (bad) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
