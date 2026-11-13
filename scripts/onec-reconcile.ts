// Табуудыг 1С-ийн нягтлан бодох бүртгэлийн регистртэй тулгах тайлан (ЗӨВХӨН УНШИХ; код засахгүй, зөвхөн хэвлэнэ).
//   npm run onec:reconcile -- 2026-10
// Агуулах, Борлуулалт, Зардал, Зарцуулалт табын эх сурвалж (1С HTTP-сервис /hs/dash/*, баримтын OData) тус бүрийг
// AccountingRegister_Хозрасчетный-ийн Balance (үлдэгдэл), Turnovers (эргэлт)-тэй дансаар нь харьцуулна. Мөнгөн хөрөнгө: `npm run onec:cash-check`.
// Нууц үг хэвлэхгүй. Зөрүүтэй мөрийг «<<» тэмдэглэнэ.
import { fetchPl, fetchSales, fetchStock } from "../lib/onec/client";
import { fetchPlTaxRows, PL_TAX_EXCLUDED } from "../lib/onec/pl-tax";
import { asOfDate, balanceBoundary, currentMonth, isMonth, monthRange } from "../lib/onec/dates";
import { enc, fetchPaged, num, odataRows, type Row } from "../lib/onec/odata-read";
import { fetchUsage } from "../lib/onec/usage";

const R = enc("AccountingRegister_Хозрасчетный");
const f = (v: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round(v * 100) / 100);
const pad = (v: string | number, n: number) => String(v).padStart(n);
const TOL = 0.5; // ₮ (1С-ийн бүхэлчлэл)
const section = (t: string) => console.log(`\n${"=".repeat(8)} ${t}`);
const flag = (d: number) => (Math.abs(d) >= TOL ? "  <<" : "");

interface Account {
  key: string;
  code: string;
  name: string;
}

/** Дансны төлөвлөгөө (608 данс): эрэмбэтэй хуудаслана, эрэмбэгүй бол 1С мөр давхардуулж, алдагдуулдаг */
async function loadChart(): Promise<Account[]> {
  const rows = await fetchPaged("ChartOfAccounts_Хозрасчетный", `$select=${enc("Ref_Key,Code,Description")}&$orderby=${enc("Code")}`, 500, 6);
  return rows.map((r) => ({ key: String(r.Ref_Key).toLowerCase(), code: String(r.Code ?? ""), name: String(r.Description ?? "") }));
}

const orChain = (keys: string[]) => keys.map((k) => `Account_Key eq guid'${k}'`).join(" or ");

async function balances(accounts: Account[], date: string): Promise<Map<string, number>> {
  const byKey = new Map(accounts.map((a) => [a.key, a.code]));
  const rows = await odataRows(`${R}/Balance(Period=datetime'${balanceBoundary(date)}')?$format=json&$select=${enc("Account_Key,СуммаBalance")}&$filter=${enc(orChain(accounts.map((a) => a.key)))}&$top=20000`, { timeoutMs: 120_000 });
  const m = new Map<string, number>();
  for (const r of rows) {
    const code = byKey.get(String(r.Account_Key).toLowerCase());
    if (code) m.set(code, (m.get(code) ?? 0) + num(r["СуммаBalance"]));
  }
  return m;
}

/** Turnovers: данс бүрийн Дт, Кт эргэлт. accounts өгөхгүй бол бүх данс (хязгаар 20000 мөр) */
async function turnovers(chart: Account[], from: string, to: string, accounts?: Account[]): Promise<Map<string, { dr: number; cr: number }>> {
  const byKey = new Map(chart.map((a) => [a.key, a.code]));
  const filter = accounts ? `&$filter=${enc(orChain(accounts.map((a) => a.key)))}` : "";
  const rows = await odataRows(`${R}/Turnovers(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59')?$format=json&$select=${enc("Account_Key,СуммаTurnoverDr,СуммаTurnoverCr")}${filter}&$top=20000`, { timeoutMs: 170_000 });
  if (rows.length >= 20000) throw new Error("Turnovers хэт олон мөр буцаав");
  const m = new Map<string, { dr: number; cr: number }>();
  for (const r of rows) {
    const code = byKey.get(String(r.Account_Key).toLowerCase());
    if (!code) continue;
    const cur = m.get(code) ?? { dr: 0, cr: 0 };
    cur.dr += num(r["СуммаTurnoverDr"]);
    cur.cr += num(r["СуммаTurnoverCr"]);
    m.set(code, cur);
  }
  return m;
}

let issues = 0;
const mark = (d: number) => {
  if (Math.abs(d) >= TOL) issues++;
};

// ---------------------------------------------------------------- 1. Агуулах
async function stock(chart: Account[], month: string) {
  const date = asOfDate(month);
  section(`1. АГУУЛАХ: /hs/dash/stock?asof=${date} ба 14xx дансны Balance (${balanceBoundary(date)})`);
  const hubRows = await fetchStock(date);
  const hub = new Map<string, { amount: number; n: number }>();
  for (const r of hubRows) {
    const cur = hub.get(r.account) ?? { amount: 0, n: 0 };
    cur.amount += r.amount;
    cur.n++;
    hub.set(r.account, cur);
  }
  const acc14 = chart.filter((a) => a.code.startsWith("14"));
  const bal = await balances(acc14, date);
  console.log("Данс      Дансны нэр                        Hub мөр   Hub (stock)         Balance (регистр)   Зөрүү (Hub−Balance)");
  let th = 0, tb = 0;
  for (const code of [...new Set([...hub.keys(), ...[...bal].filter(([, v]) => Math.abs(v) >= TOL).map(([k]) => k)])].sort()) {
    const h = hub.get(code)?.amount ?? 0, b = bal.get(code) ?? 0, d = h - b;
    const wipAccount = code.startsWith("142"); // Дуусаагүй үйлдвэрлэл: Агуулах табд тусдаа KPI (lib/onec/wip.ts)
    if (!wipAccount) mark(d);
    th += h; tb += b;
    console.log(`${code.padEnd(9)} ${(acc14.find((a) => a.code === code)?.name ?? "").slice(0, 32).padEnd(33)} ${pad(hub.get(code)?.n ?? 0, 6)} ${pad(f(h), 20)} ${pad(f(b), 20)} ${pad(f(d), 20)}${wipAccount && Math.abs(d) >= TOL ? "  (тайлбартай: Дуусаагүй үйлдвэрлэл, тусдаа KPI)" : flag(d)}`);
  }
  console.log(`НИЙТ      ${"".padEnd(33)} ${pad(hubRows.length, 6)} ${pad(f(th), 20)} ${pad(f(tb), 20)} ${pad(f(th - tb), 20)}`);
  // 142x (дуусаагүй үйлдвэрлэл, үйлдвэрлэлийн зардал) нь бараа, агуулахгүй хуримтлагдсан зардал тул /hs/dash/stock-д ордоггүй: зөрүүг тусад нь тайлбарлана
  const wip = [...bal].filter(([c]) => c.startsWith("142")).reduce((s, [, v]) => s + v, 0);
  console.log(`Үүнээс 142x (Дуусаагүй үйлдвэрлэл, агуулахын бараа биш; Агуулах табд тусдаа KPI) Balance ${f(wip)}; 142x-гүй үлдсэн зөрүү ${f(th - (tb - wip))}${flag(th - (tb - wip))}`);
  mark(th - (tb - wip));
}

// ---------------------------------------------------------------- 2. Борлуулалт
async function sales(chart: Account[], month: string, turn: Map<string, { dr: number; cr: number }>) {
  const { from, to } = monthRange(month);
  section(`2. БОРЛУУЛАЛТ: /hs/dash/sales ${from}..${to} ба орлого, өртгийн дансны Turnovers`);
  const rows = await fetchSales(from, to);
  const sum = (pick: (r: (typeof rows)[number]) => number, type?: string) => rows.filter((r) => !type || r.row_type === type).reduce((s, r) => s + pick(r), 0);
  const types = [...new Set(rows.map((r) => r.row_type))];
  console.log(`Hub: ${rows.length} мөр; row_type: ${types.map((t) => `${t}=${rows.filter((r) => r.row_type === t).length}`).join(", ")}`);
  for (const t of types) console.log(`  ${t.padEnd(10)} борлуулалт ${pad(f(sum((r) => r.amount, t)), 20)}  НӨАТ ${pad(f(sum((r) => r.vat, t)), 18)}  өртөг ${pad(f(sum((r) => r.cost, t)), 20)}`);
  // Борлуулалтын орлого = 5100-5119 (5111 бараа, 5112 ажил үйлчилгээ). 5131 «Хүүний орлого», 5310/5320 ханшийн зөрүү нь борлуулалт биш
  const revenue = chart.filter((a) => /^511\d|^5100/.test(a.code));
  const contra = chart.filter((a) => /^60[1-4]0/.test(a.code));
  const cogs = chart.filter((a) => /^610\d/.test(a.code));
  console.log("Тулгах дансууд (ChartOfAccounts): орлого " + revenue.map((a) => `${a.code} ${a.name}`).join("; "));
  console.log("  орлогын хасагдуулга (6010-6040): " + contra.map((a) => `${a.code} ${a.name}`).join("; "));
  console.log("  өртөг: " + cogs.map((a) => `${a.code} ${a.name}`).join("; "));
  const net = (code: string, side: "cr" | "dr") => (side === "cr" ? (turn.get(code)?.cr ?? 0) - (turn.get(code)?.dr ?? 0) : (turn.get(code)?.dr ?? 0) - (turn.get(code)?.cr ?? 0));
  const revAccts = revenue.filter((a) => (turn.get(a.code)?.cr ?? 0) || (turn.get(a.code)?.dr ?? 0));
  console.log("Данс      Нэр                          Дт эргэлт           Кт эргэлт           Цэвэр (орлого = Кт−Дт)");
  for (const a of revAccts) console.log(`${a.code.padEnd(9)} ${a.name.slice(0, 28).padEnd(29)} ${pad(f(turn.get(a.code)!.dr), 19)} ${pad(f(turn.get(a.code)!.cr), 19)} ${pad(f(net(a.code, "cr")), 19)}`);
  const regRevenue = revAccts.reduce((s, a) => s + net(a.code, "cr"), 0);
  const hubRevenue = sum((r) => r.amount);
  console.log(`БОРЛУУЛАЛТ (орлого):  Hub ${f(hubRevenue)}   Регистр (5100-5119 цэвэр) ${f(regRevenue)}   Зөрүү ${f(hubRevenue - regRevenue)}${flag(hubRevenue - regRevenue)}`);
  mark(hubRevenue - regRevenue);
  const cogsAccts = cogs.filter((a) => (turn.get(a.code)?.dr ?? 0) || (turn.get(a.code)?.cr ?? 0));
  for (const a of cogsAccts) console.log(`${a.code.padEnd(9)} ${a.name.slice(0, 28).padEnd(29)} ${pad(f(turn.get(a.code)!.dr), 19)} ${pad(f(turn.get(a.code)!.cr), 19)} ${pad(f(net(a.code, "dr")), 19)}`);
  const regCogs = cogsAccts.reduce((s, a) => s + net(a.code, "dr"), 0);
  const hubCost = sum((r) => r.cost);
  console.log(`Өртгийн задаргаа (Борлуулалт табд 2 мөр): баримтаар ${f(sum((r) => r.cost, "sale") + sum((r) => r.cost, "reversal"))}; шаардах хуудсаар шууд өртөгт ${f(sum((r) => r.cost, "cost_only"))}; нийт ${f(hubCost)}`);
  console.log(`ӨРТӨГ:               Hub ${f(hubCost)}   Регистр (6100-6109 цэвэр) ${f(regCogs)}   Зөрүү ${f(hubCost - regCogs)}${flag(hubCost - regCogs)}`);
  mark(hubCost - regCogs);
  return { hubRevenue, hubCost };
}

// ---------------------------------------------------------------- 3. Зардал (P&L)
async function pnl(chart: Account[], month: string, turn: Map<string, { dr: number; cr: number }>) {
  const { from, to } = monthRange(month);
  section(`3. ЗАРДАЛ (P&L): /hs/dash/pl ${from}..${to} ба данс бүрийн Turnovers`);
  const rows = [...(await fetchPl(from, to)), ...(await fetchPlTaxRows(month, from, to))]; // 5xxx-7xxx: /hs/dash/pl; 8xxx-9xxx: OData (lib/onec/pl-tax.ts), sync-тэй ижил
  const hub = new Map<string, { amount: number; side: string; group: string; n: number }>();
  for (const r of rows) {
    const cur = hub.get(r.account) ?? { amount: 0, side: r.side, group: r.group, n: 0 };
    cur.amount += r.amount;
    cur.n++;
    hub.set(r.account, cur);
  }
  console.log("Данс      Нэр                          Тал     Бүлэг    Hub мөр Hub                 Регистр (зардал Дт−Кт, орлого Кт−Дт)  Зөрүү");
  let issuesHere = 0;
  for (const [code, h] of [...hub].sort(([a], [b]) => a.localeCompare(b))) {
    const t = turn.get(code) ?? { dr: 0, cr: 0 };
    const reg = h.side === "income" ? t.cr - t.dr : t.dr - t.cr;
    const d = h.amount - reg;
    mark(d);
    if (Math.abs(d) >= TOL) issuesHere++;
    console.log(`${code.padEnd(9)} ${(chart.find((a) => a.code === code)?.name ?? "").slice(0, 28).padEnd(29)} ${h.side.padEnd(7)} ${h.group.padEnd(8)} ${pad(h.n, 6)} ${pad(f(h.amount), 20)} ${pad(f(reg), 22)} (Дт ${f(t.dr)} / Кт ${f(t.cr)}) ${pad(f(d), 18)}${flag(d)}`);
  }
  // Регистрт эргэлттэй боловч Hub-д ороогүй ашиг, алдагдлын дансууд (5xxx-9xxx)
  const missing = [...turn]
    .filter(([code, t]) => /^[5-9]/.test(code) && !hub.has(code) && !PL_TAX_EXCLUDED.includes(code.replace(/\..*$/, "")) && (Math.abs(t.dr) >= TOL || Math.abs(t.cr) >= TOL))
    .sort(([a], [b]) => a.localeCompare(b));
  console.log(`\nРегистрт эргэлттэй, Hub-д ОРООГҮЙ 5xxx-9xxx данс: ${missing.length}`);
  for (const [code, t] of missing) console.log(`  ${code.padEnd(9)} ${(chart.find((a) => a.code === code)?.name ?? "").slice(0, 38).padEnd(39)} Дт ${pad(f(t.dr), 20)}  Кт ${pad(f(t.cr), 20)}`);
  const hubExpense = [...hub.values()].filter((h) => h.side === "expense").reduce((s, h) => s + h.amount, 0);
  // Регистр: 6101-9199 (6010-6040 орлогын хасагдуулга, 9200 хаалтын данс биш), Дт−Кт
  const regExpense = [...turn].filter(([code]) => /^[6-9]/.test(code) && !/^60/.test(code) && !PL_TAX_EXCLUDED.includes(code.replace(/\..*$/, ""))).reduce((s, [, t]) => s + (t.dr - t.cr), 0);
  console.log(`НИЙТ ЗАРДАЛ:  Hub+OData ${f(hubExpense)}   Регистр (6101-9199, Дт−Кт) ${f(regExpense)}   Зөрүү ${f(hubExpense - regExpense)}${flag(hubExpense - regExpense)}`);
  mark(hubExpense - regExpense);
  issues += missing.length;
  const closing = turn.get("9200.00");
  if (closing) console.log(`(9200 Орлого зарлагын нэгдсэн данс: Дт ${f(closing.dr)} / Кт ${f(closing.cr)}: хаалтын данс, зардал биш тул оруулаагүй)`);
  if (issuesHere || missing.length) console.log(`Зөрүүтэй данс: ${issuesHere}; Hub-д дутуу данс: ${missing.length}`);
}

// ---------------------------------------------------------------- 4. Зарцуулалт
async function usage(chart: Account[], month: string, turn: Map<string, { dr: number; cr: number }>) {
  const { from, to } = monthRange(month);
  section(`4. ЗАРЦУУЛАЛТ: шаардах хуудас (OData, табын тоо) ба 14xx дансны кредит эргэлт ${from}..${to}`);
  const u = await fetchUsage(month);
  const acc14 = chart.filter((a) => a.code.startsWith("14"));
  const key14 = new Set(acc14.map((a) => a.key));
  const code = new Map(chart.map((a) => [a.key, a]));
  const recs = await odataRows(
    `${R}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Top=100000)?$format=json&$filter=${enc(`(${acc14.map((a) => `AccountCr_Key eq guid'${a.key}'`).join(" or ")})`)}`,
    { timeoutMs: 170_000 }
  );
  const isReq = (r: Row) => String(r.Recorder_Type ?? "").endsWith("Document_ТребованиеНакладная");
  let reqCr = 0, otherCr = 0;
  const byDr = new Map<string, number>();
  const byDoc = new Map<string, number>();
  for (const r of recs) {
    if (!key14.has(String(r.AccountCr_Key).toLowerCase())) continue;
    const a = num(r["Сумма"]);
    const docType = String(r.Recorder_Type ?? "").replace("StandardODATA.Document_", "");
    byDoc.set(docType, (byDoc.get(docType) ?? 0) + a);
    if (isReq(r)) {
      reqCr += a;
      const dr = code.get(String(r.AccountDr_Key).toLowerCase());
      const k = `${dr?.code ?? "?"} ${dr?.name ?? ""}`;
      byDr.set(k, (byDr.get(k) ?? 0) + a);
    } else otherCr += a;
  }
  const turnCr = acc14.reduce((s, a) => s + (turn.get(a.code)?.cr ?? 0), 0);
  console.log(`Шаардах хуудас: ${u.totals.documents} баримт; табын нийт зарцуулалт ${f(u.totals.amount)}`);
  console.log(`14xx Кт эргэлт (Turnovers, бүх баримт)      ${f(turnCr)}`);
  console.log(`14xx Кт бичилт (Records) нийт                ${f(reqCr + otherCr)}   (Turnovers-тай зөрүү ${f(reqCr + otherCr - turnCr)}${flag(reqCr + otherCr - turnCr)})`);
  console.log(`  үүнээс Шаардах хуудас (Recorder)           ${f(reqCr)}   Табын дүнтэй зөрүү ${f(u.totals.amount - reqCr)}${flag(u.totals.amount - reqCr)}`);
  mark(u.totals.amount - reqCr);
  console.log(`  үүнээс бусад баримт                        ${f(otherCr)}`);
  console.log("Шаардах хуудасны Дт дансууд (үйлдвэрлэл, зардал):");
  for (const [k, v] of [...byDr].sort((a, b) => b[1] - a[1])) console.log(`  ${k.slice(0, 44).padEnd(45)} ${pad(f(v), 20)}`);
  console.log("14xx кредитийн баримтын төрлөөр:");
  for (const [k, v] of [...byDoc].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(45)} ${pad(f(v), 20)}`);
}

async function main() {
  const month = process.argv[2] ?? currentMonth();
  if (!isMonth(month)) throw new Error("Жишээ: onec:reconcile 2026-10");
  const { from, to } = monthRange(month);
  console.log(`1С тулгалт: ${month} (${from}..${to}); үлдэгдлийн өдөр ${asOfDate(month)}`);
  const chart = await loadChart();
  console.log(`Дансны төлөвлөгөө: ${chart.length} данс`);
  const turn = await turnovers(chart, from, to);
  console.log(`Turnovers: ${turn.size} данс эргэлттэй`);
  for (const [name, run] of [
    ["stock", () => stock(chart, month)],
    ["sales", () => sales(chart, month, turn)],
    ["pnl", () => pnl(chart, month, turn)],
    ["usage", () => usage(chart, month, turn)],
  ] as const) {
    try {
      await run();
    } catch (e) {
      console.log(`\n!! ${name} тулгалт унав: ${e instanceof Error ? e.message : e}`);
      issues++;
    }
  }
  console.log(`\nДүгнэлт: ${issues === 0 ? "бүх тулгалт таарсан" : `${issues} зөрүүтэй мөр/алдаа (« << » тэмдэглэсэн)`}`);
  if (issues) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
