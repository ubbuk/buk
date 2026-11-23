// «Цалин» таб: цалингийн нийт дүн, хэлтсээр, ажилтнаар. Зөвхөн 1С-ээс УНШИНА (OData GET, AccountingRegister_Хозрасчетный).
// Цалин 1С-д «ЗУП» модулиар биш, нягтлангийн бичилтээр (Document_ОперацияБух) бүртгэгддэг тул цалингийн дансны бичилтээс тооцно:
//   бодсон              = Кт 3342, Дт нь цалингийн данс БИШ, мөнгөний данс БИШ (1424, 2xxx, 7xxx ... зардал, өртөг)
//   ажил олгогчийн НДШ  = Кт 3450, Дт нь цалингийн данс БИШ
//   суутгасан НДШ       = Дт 3342, Кт 3450
//   ХХОАТ               = Дт 3342, Кт 3462
//   олгосон             = Дт 3342, Кт 11xx (банк) эсвэл 10xx (касс)
// Бодсоны задаргаа (нийт нь өөрчлөгдөхгүй): өвчний тэтгэмж = баримтын төрөл Document_БольничныйЛист; тэтгэмж = нягтлангийн баримтын гарчигт «тэтгэмж»
// (жишээ «2026 оны 9 сарын тэтгэмжийн мөнгө»); бусад нь үндсэн цалин. ТУЗ-ийн урамшуулал = Кт 3349 (Дт нь цалингийн данс БИШ), түүний суутгал Дт 3349.
//   сарын эцсийн өглөг  = 3342-ийн Balance (Кт үлдэгдэл = өглөг; Дт үлдэгдэл бол сөрөг = урьдчилж олгосон / бодолт хараахан бүртгэгдээгүй)
// Бодсон цалинг ажилтнаар 1С-д БҮРТГЭДЭГГҮЙ (бодолтын бичилт хэлтсээр нэгтгэгдсэн, ФизЛицо субконтогүй): ажилтнаар зөвхөн олгосон, үлдэгдэл.
// ХҮНИЙ ТҮВШНИЙ мэдээлэл ERP баазад хадгалагдахгүй: нээх бүрд 1С-ээс шууд уншина (5 минутын санах ойн cache). Зөвхөн байгууллагын сарын нийт
// дүн Postgres-д (lib/onec/payroll-store.ts). Хэлтсийн задаргаа ч хадгалагдахгүй (жижиг хэлтэст хүнийг таниулж болзошгүй).
import { loadAccountBook, shortCode, type AccountBook } from "./accounts";
import { asOfDate, balanceBoundary, currentMonth, monthRange, monthsBetween } from "./dates";
import { cachedLoad, type CacheMeta } from "./odata-cache";
import { chunks, enc, lookupRows, num, odataRows, OdataError, realKey, type Row } from "./odata-read";
import { NO_DEPARTMENT, UNATTRIBUTED } from "./payroll-labels";
import { isPayrollAccount } from "./payroll-guard";
import { withOneCYear, yearOf } from "./year-context";

const REGISTER = "AccountingRegister_Хозрасчетный";
const PERSON = "Catalog_ФизическиеЛица";
const DEPARTMENT = "Catalog_ПодразделенияОрганизаций";
const TOP = 100_000;
const SALARY = "3342";
const NDSH = "3450";
const HHOAT = "3462";
const BOARD = "3349";
const SICK_DOC = "Document_БольничныйЛист";
const JOURNAL_DOC = "Document_ОперацияБух";

export { NO_DEPARTMENT, UNATTRIBUTED };

const round2 = (v: number) => Math.round(v * 100) / 100;
const lower = (v: unknown) => String(v ?? "").toLowerCase();
const base = (code: string) => shortCode(code).replace(/\..*$/, ""); // "3450.01" -> "3450"

export interface PayrollContext {
  /** GUID -> дансны үндсэн код ("3342") */
  codeOf: Map<string, string>;
  /** цалингийн бүх дансны GUID (lib/onec/payroll-guard.ts) */
  payroll: Set<string>;
  /** 3342 дансны GUID-ууд */
  salary: string[];
}

export function payrollContext(book: AccountBook): PayrollContext {
  const codeOf = new Map<string, string>();
  const payroll = new Set<string>();
  const salary: string[] = [];
  for (const a of book.byKey.values()) {
    codeOf.set(a.key, base(a.code));
    if (isPayrollAccount(a.code)) payroll.add(a.key);
    if (base(a.code) === SALARY) salary.push(a.key);
  }
  return { codeOf, payroll, salary };
}

const orChain = (field: string, keys: Iterable<string>) => [...keys].map((k) => `${field} eq guid'${k}'`).join(" or ");
const isCashCode = (code: string) => code.startsWith("10") || code.startsWith("11");

// ---------------------------------------------------------------- сарын нийт дүн

export interface PayrollMonth {
  month: string;
  accrued: number;
  employerNdsh: number;
  employeeNdsh: number;
  hhoat: number;
  paidBank: number;
  paidCash: number;
  /** сарын эцсийн өглөг (3342): эерэг = өглөг, сөрөг = урьдчилж олгосон */
  closingPayable: number;
  lines: number;
  /** «бодсон»-д багтсан тэтгэмж (нийгмийн, нэг удаагийн) */
  benefit: number;
  /** «бодсон»-д багтсан ажил олгогчоос олгосон өвчний тэтгэмж */
  sickPay: number;
  /** ТУЗ-ийн урамшуулал (Кт 3349); «бодсон»-д ОРООГҮЙ */
  board: number;
  /** ТУЗ-ийн урамшуулалаас суутгасан НДШ, ХХОАТ */
  boardNdsh: number;
  boardHhoat: number;
  /** ТУЗ-ийн урамшууллыг банк, кассаар олгосон */
  boardPaid: number;
  /** бусад суутгал: цалин, урамшуулал (Дт 3342/3349) мөнгө, НДШ, ХХОАТ, цалингийн данс биш рүү (авлага, зээл г.м.) */
  otherDeductions: number;
}

/** «Тэтгэмж»-ийн нягтлангийн баримтыг баримтын гарчгаас таних (гарчиг нь ажилтны нэр агуулдаггүй, тайланд гаргахгүй) */
export const isBenefitText = (text: unknown): boolean => /тэтгэмж/i.test(String(text ?? ""));

const recorderOf = (r: Row) => lower(r.Recorder);
const isSickLine = (r: Row) => String(r.Recorder_Type ?? "").endsWith(SICK_DOC);

/** Цэвэр (тестлэгдэнэ): цалингийн дансны бичилтүүдээс сарын нийт дүн. `benefitDocs`: гарчигт «тэтгэмж» бүхий нягтлангийн баримтуудын GUID (жижиг үсгээр). */
export function buildPayrollMonth(month: string, lines: readonly Row[], ctx: PayrollContext, closingPayable: number, benefitDocs: ReadonlySet<string> = new Set()): PayrollMonth {
  const t = { accrued: 0, employerNdsh: 0, employeeNdsh: 0, hhoat: 0, paidBank: 0, paidCash: 0, benefit: 0, sickPay: 0, board: 0, boardNdsh: 0, boardHhoat: 0, boardPaid: 0, otherDeductions: 0 };
  for (const r of lines) {
    const drKey = lower(r.AccountDr_Key);
    const crKey = lower(r.AccountCr_Key);
    const dr = ctx.codeOf.get(drKey) ?? "";
    const cr = ctx.codeOf.get(crKey) ?? "";
    const amount = num(r["Сумма"]);
    const drPayroll = ctx.payroll.has(drKey);
    if (cr === SALARY && !drPayroll && !isCashCode(dr)) {
      t.accrued += amount;
      if (isSickLine(r)) t.sickPay += amount;
      else if (benefitDocs.has(recorderOf(r))) t.benefit += amount;
    }
    if (cr === BOARD && !drPayroll && !isCashCode(dr)) t.board += amount;
    if (dr === BOARD && cr === NDSH) t.boardNdsh += amount;
    if (dr === BOARD && cr === HHOAT) t.boardHhoat += amount;
    if (dr === BOARD && isCashCode(cr)) t.boardPaid += amount;
    if ((dr === SALARY || dr === BOARD) && cr !== "" && !isCashCode(cr) && ![SALARY, BOARD, NDSH, HHOAT].includes(cr)) t.otherDeductions += amount;
    if (cr === NDSH && !drPayroll) t.employerNdsh += amount;
    if (dr === SALARY && cr === NDSH) t.employeeNdsh += amount;
    if (dr === SALARY && cr === HHOAT) t.hhoat += amount;
    if (dr === SALARY && cr.startsWith("11")) t.paidBank += amount;
    if (dr === SALARY && cr.startsWith("10")) t.paidCash += amount;
  }
  return {
    month,
    accrued: round2(t.accrued),
    employerNdsh: round2(t.employerNdsh),
    employeeNdsh: round2(t.employeeNdsh),
    hhoat: round2(t.hhoat),
    paidBank: round2(t.paidBank),
    paidCash: round2(t.paidCash),
    closingPayable: round2(closingPayable),
    lines: lines.length,
    benefit: round2(t.benefit),
    sickPay: round2(t.sickPay),
    board: round2(t.board),
    boardNdsh: round2(t.boardNdsh),
    boardHhoat: round2(t.boardHhoat),
    boardPaid: round2(t.boardPaid),
    otherDeductions: round2(t.otherDeductions),
  };
}

/** 1С руу нэг хүсэлтийн анхдагч хугацаа (sync-д үлдсэн хугацаагаар богиносно) */
export const REQUEST_TIMEOUT_MS = 45_000;

async function fetchLines(ctx: PayrollContext, from: string, to: string, select: string, timeoutMs = 90_000): Promise<Row[]> {
  const filter = `(${orChain("AccountDr_Key", ctx.payroll)}) or (${orChain("AccountCr_Key", ctx.payroll)})`;
  const rows = await odataRows(`${enc(REGISTER)}/RecordsWithExtDimensions(StartPeriod=datetime'${from}T00:00:00',EndPeriod=datetime'${to}T23:59:59',Top=${TOP})?$format=json&$select=${enc(select)}&$filter=${enc(`(${filter})`)}`, { timeoutMs });
  if (rows.length >= TOP) throw new OdataError(502, "Цалингийн бичилт хэт олон байна. Админд хандана уу");
  return rows;
}

/** Сарын нийт дүнд зөвхөн Дт, Кт данс, дүн, баримт (задаргаанд) хэрэгтэй (хэлтэс, хүний талбаргүй: хариу хамгийн хөнгөн) */
const TOTALS_SELECT = "Recorder,Recorder_Type,AccountDr_Key,AccountCr_Key,Сумма";
const LINE_SELECT = "Period,AccountDr_Key,AccountCr_Key,Сумма,ПодразделениеDr_Key";
const PERSON_SELECT = `${LINE_SELECT},ExtDimensionDr1,ExtDimensionDr1_Type,ExtDimensionCr1,ExtDimensionCr1_Type`;

/** 3342-ийн Balance(Period) мөрүүд (ExtDimension1 = ФизЛицо). Дт үлдэгдэл сөрөг (СуммаBalance = Дт − Кт). */
async function fetchSalaryBalance(ctx: PayrollContext, period: string, select = "СуммаBalance", timeoutMs = 60_000): Promise<Row[]> {
  const rows = await odataRows(`${enc(REGISTER)}/Balance(Period=datetime'${period}')?$format=json&$select=${enc(select)}&$filter=${enc(`(${orChain("Account_Key", ctx.salary)})`)}&$top=20000`, { timeoutMs });
  if (rows.length >= 20_000) throw new OdataError(502, "Цалингийн өглөгийн мөр хэт олон байна. Админд хандана уу");
  return rows;
}

const payable = (rows: readonly Row[]) => -rows.reduce((s, r) => s + num(r["СуммаBalance"]), 0);

async function contextFor(year: string): Promise<PayrollContext> {
  const ctx = payrollContext(await withOneCYear(year, () => loadAccountBook()));
  if (ctx.payroll.size === 0 || ctx.salary.length === 0) throw new OdataError(502, "Цалингийн данс 1С-ээс олдсонгүй");
  return ctx;
}

/** Бодолтын бичилттэй нягтлангийн баримтуудын гарчгийг уншиж, «тэтгэмж»-ийн баримтуудыг олно (баримт бүрт 1 удаа, 1 цаг cache) */
async function loadBenefitDocs(lines: readonly Row[], ctx: PayrollContext): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const r of lines) {
    const drKey = lower(r.AccountDr_Key);
    if (ctx.codeOf.get(lower(r.AccountCr_Key)) !== SALARY || ctx.payroll.has(drKey) || isCashCode(ctx.codeOf.get(drKey) ?? "")) continue;
    const doc = realKey(r.Recorder);
    if (doc && String(r.Recorder_Type ?? "").endsWith(JOURNAL_DOC)) keys.add(doc);
  }
  if (keys.size === 0) return new Set();
  const rows = await lookupRows(JOURNAL_DOC, [...keys], "Содержание");
  return new Set([...rows].filter(([, row]) => isBenefitText(row?.["Содержание"])).map(([k]) => k));
}

/** Дт 3342 болон Кт 3342-ийн цэвэр хөдөлгөөн (Кт − Дт): өглөг нэмэгдэх нь эерэг. Хоёр тал нь 3342 бол тэг. */
export function salaryNetMovement(lines: readonly Row[], ctx: PayrollContext): number {
  let net = 0;
  for (const r of lines) {
    const amount = num(r["Сумма"]);
    if (ctx.codeOf.get(lower(r.AccountCr_Key)) === SALARY) net += amount;
    if (ctx.codeOf.get(lower(r.AccountDr_Key)) === SALARY) net -= amount;
  }
  return net;
}

export interface PayrollMonthTimings {
  linesMs: number;
  balanceMs: number;
  totalMs: number;
}

/**
 * Нэг сарын нийт дүн (1С-ээс): ХОЁР хөнгөн хүсэлт. (1) сарын цалингийн дансны бичилт (зөвхөн Дт, Кт данс, дүн), (2) 3342-ийн Balance САРЫН ЭХНИЙ
 * агшинд (00:00:00 = өмнөх сарын эцэс: 1С-ийн тооцоолсон дүнгийн хилэнд). Сарын эцсийн өглөг = эхний өглөг + (Кт − Дт 3342).
 * Өмнө нь Balance-ийг сарын ЭЦСИЙН (одоогийн сард ирээдүйн) агшинд авдаг байсан нь 1С-д хамгийн хүнд, 60 сек-д багтдаггүй дуудлага байлаа.
 * Бодолтгүй сар (бичилт 0) алдаа биш: 0 дүнтэй буцна. `timeoutMs`: хүсэлт тус бүрийн дээд хугацаа (sync-д үлдсэн хугацаагаар).
 */
export function fetchPayrollMonth(month: string, opts: { timeoutMs?: number } = {}): Promise<PayrollMonth & { timings: PayrollMonthTimings }> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return withOneCYear(yearOf(month), async () => {
    const started = Date.now();
    const ctx = await contextFor(yearOf(month));
    const { from, to } = monthRange(month);
    const timed = async <T,>(f: () => Promise<T>): Promise<[T, number]> => {
      const s = Date.now();
      const v = await f();
      return [v, Date.now() - s];
    };
    // Дарааллаар (зэрэг биш): 1С-д нэг дор нэг л хүсэлт
    const [lines, linesMs] = await timed(() => fetchLines(ctx, from, to, TOTALS_SELECT, timeoutMs));
    const [opening, balanceMs] = await timed(() => fetchSalaryBalance(ctx, `${from}T00:00:00`, "СуммаBalance", timeoutMs));
    const [benefitDocs, docsMs] = await timed(() => loadBenefitDocs(lines, ctx));
    const closing = payable(opening) + salaryNetMovement(lines, ctx);
    return { ...buildPayrollMonth(month, lines, ctx, closing, benefitDocs), timings: { linesMs: linesMs + docsMs, balanceMs, totalMs: Date.now() - started } };
  });
}

// ---------------------------------------------------------------- хэлтсээр (хадгалахгүй)

export interface PayrollDepartment {
  key: string;
  name: string;
  total: number;
  byMonth: Record<string, number>;
}
export interface PayrollDepartments {
  year: string;
  months: string[];
  departments: PayrollDepartment[];
  /** сар бүрийн нийт бодсон цалин (сарын нэгтгэлийн «бодсон»-той ижил) */
  totals: Record<string, number>;
}

export const yearMonths = (year: string, now = currentMonth()): string[] => monthsBetween(`${year}-01`, now.startsWith(year) ? now : `${year}-12`);

/** Цэвэр: бодолтын бичилтүүдийг (Кт 3342, Дт цалин биш) хэлтсээр (ПодразделениеDr) нэгтгэнэ */
export function buildDepartments(year: string, months: string[], linesByMonth: Record<string, readonly Row[]>, ctx: PayrollContext, names: Map<string, string>): PayrollDepartments {
  const per = new Map<string, PayrollDepartment>();
  const totals: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  for (const m of months) {
    for (const r of linesByMonth[m] ?? []) {
      const drKey = lower(r.AccountDr_Key);
      if (ctx.codeOf.get(lower(r.AccountCr_Key)) !== SALARY || ctx.payroll.has(drKey) || isCashCode(ctx.codeOf.get(drKey) ?? "")) continue;
      const dept = realKey(r["ПодразделениеDr_Key"]) ?? "";
      const cur = per.get(dept) ?? { key: dept, name: dept ? names.get(dept) || "Хэлтэс" : NO_DEPARTMENT, total: 0, byMonth: {} };
      const a = num(r["Сумма"]);
      cur.total += a;
      cur.byMonth[m] = (cur.byMonth[m] ?? 0) + a;
      totals[m] += a;
      per.set(dept, cur);
    }
  }
  const departments = [...per.values()].map((d) => ({ ...d, total: round2(d.total), byMonth: Object.fromEntries(Object.entries(d.byMonth).map(([m, v]) => [m, round2(v)])) })).sort((a, b) => b.total - a.total);
  return { year, months, departments, totals: Object.fromEntries(Object.entries(totals).map(([m, v]) => [m, round2(v)])) };
}

async function linesByMonth(ctx: PayrollContext, months: string[], select: string): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  for (const group of chunks(months, 2)) {
    // 1С-ийг ачаалахгүйн тулд 2 сараар зэрэг
    await Promise.all(group.map(async (m) => (out[m] = await fetchLines(ctx, monthRange(m).from, monthRange(m).to, select))));
  }
  return out;
}

export function loadPayrollDepartments(year: string, refresh = false): Promise<{ value: PayrollDepartments; meta: CacheMeta }> {
  return cachedLoad(
    `payroll-dept:${year}`,
    () =>
      withOneCYear(year, async () => {
        const ctx = await contextFor(year);
        const months = yearMonths(year);
        const lines = await linesByMonth(ctx, months, LINE_SELECT);
        const keys = [...new Set(Object.values(lines).flat().map((r) => realKey(r["ПодразделениеDr_Key"])).filter((k): k is string => !!k))];
        const rows = await lookupRows(DEPARTMENT, keys, "Description");
        return buildDepartments(year, months, lines, ctx, new Map([...rows].map(([k, r]) => [k, String(r?.Description ?? "").trim()])));
      }),
    { refresh }
  );
}

// ---------------------------------------------------------------- ажилтнаар (хадгалахгүй)

export interface PayrollEmployeeMonth {
  month: string;
  /** олгосон: Дт 3342, Кт 10xx/11xx */
  paid: number;
  /** Кт 3342 (ажилтанд бүртгэсэн: өвчний тэтгэмж, залруулга г.м.) */
  credited: number;
  /** Дт 3342, мөнгө биш (суутгал, шилжүүлэг, залруулга) */
  otherDebits: number;
  /** сарын эцсийн өглөг (эерэг = өглөг) */
  closing: number;
}
export interface PayrollEmployee {
  /** хоосон = ажилтан тодорхойгүй (нэгтгэсэн) */
  key: string;
  name: string;
  opening: number;
  paid: number;
  credited: number;
  otherDebits: number;
  closing: number;
  months: PayrollEmployeeMonth[];
}
export interface PayrollEmployees {
  year: string;
  asOf: string;
  months: string[];
  employees: PayrollEmployee[];
  totals: { opening: number; paid: number; credited: number; otherDebits: number; closing: number };
  /** жилийн эхний үлдэгдэл + бичилтүүдийн цэвэр хөдөлгөөн = 1С-ийн өнөөдрийн үлдэгдэл (Balance); зөрүү 0 байх ёстой */
  check: { closing1c: number; difference: number };
}

const personOf = (r: Row, side: "Dr" | "Cr"): string => (String(r[`ExtDimension${side}1_Type`] ?? "").endsWith(PERSON) ? (realKey(r[`ExtDimension${side}1`]) ?? "") : "");
const personsOf = (rows: readonly Row[]) => {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = String(r.ExtDimension1_Type ?? "").endsWith(PERSON) ? (realKey(r.ExtDimension1) ?? "") : "";
    out.set(k, (out.get(k) ?? 0) + -num(r["СуммаBalance"]));
  }
  return out;
};

/** Цэвэр (тестлэгдэнэ): ажилтан бүрийн олгосон, үлдэгдэл, сар бүрийн задаргаа. Ажилтангүй мөр «тодорхойгүй» (key "") нэг мөрөнд. */
export function buildEmployees(input: { year: string; asOf: string; months: string[]; linesByMonth: Record<string, readonly Row[]>; opening: readonly Row[]; closingNow: readonly Row[]; ctx: PayrollContext; names: Map<string, string> }): PayrollEmployees {
  const { year, asOf, months, ctx, names } = input;
  const opening = personsOf(input.opening);
  type Acc = { paid: number; credited: number; otherDebits: number };
  const moves = new Map<string, Map<string, Acc>>();
  const acc = (person: string, month: string): Acc => {
    let m = moves.get(person);
    if (!m) moves.set(person, (m = new Map()));
    let a = m.get(month);
    if (!a) m.set(month, (a = { paid: 0, credited: 0, otherDebits: 0 }));
    return a;
  };
  for (const month of months) {
    for (const r of input.linesByMonth[month] ?? []) {
      const dr = ctx.codeOf.get(lower(r.AccountDr_Key)) ?? "";
      const cr = ctx.codeOf.get(lower(r.AccountCr_Key)) ?? "";
      const amount = num(r["Сумма"]);
      if (dr === SALARY) {
        const a = acc(personOf(r, "Dr"), month);
        if (isCashCode(cr)) a.paid += amount;
        else a.otherDebits += amount;
      }
      if (cr === SALARY) acc(personOf(r, "Cr"), month).credited += amount;
    }
  }
  const people = new Set<string>([...opening.keys(), ...moves.keys()]);
  const employees: PayrollEmployee[] = [];
  for (const key of people) {
    let running = opening.get(key) ?? 0;
    const rows: PayrollEmployeeMonth[] = months.map((month) => {
      const a = moves.get(key)?.get(month) ?? { paid: 0, credited: 0, otherDebits: 0 };
      running += a.credited - a.paid - a.otherDebits;
      return { month, paid: round2(a.paid), credited: round2(a.credited), otherDebits: round2(a.otherDebits), closing: round2(running) };
    });
    const sum = (f: (m: PayrollEmployeeMonth) => number) => round2(rows.reduce((s, m) => s + f(m), 0));
    const e: PayrollEmployee = { key, name: key ? names.get(key) || "Ажилтан" : UNATTRIBUTED, opening: round2(opening.get(key) ?? 0), paid: sum((m) => m.paid), credited: sum((m) => m.credited), otherDebits: sum((m) => m.otherDebits), closing: round2(running), months: rows };
    if (e.opening || e.paid || e.credited || e.otherDebits || e.closing) employees.push(e);
  }
  employees.sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : b.paid - a.paid || a.name.localeCompare(b.name, "mn")));
  const total = (f: (e: PayrollEmployee) => number) => round2(employees.reduce((s, e) => s + f(e), 0));
  const totals = { opening: total((e) => e.opening), paid: total((e) => e.paid), credited: total((e) => e.credited), otherDebits: total((e) => e.otherDebits), closing: total((e) => e.closing) };
  const closing1c = round2([...personsOf(input.closingNow).values()].reduce((s, v) => s + v, 0));
  return { year, asOf, months, employees, totals, check: { closing1c, difference: round2(totals.closing - closing1c) } };
}

export function loadPayrollEmployees(year: string, refresh = false): Promise<{ value: PayrollEmployees; meta: CacheMeta }> {
  return cachedLoad(
    `payroll-emp:${year}`,
    () =>
      withOneCYear(year, async () => {
        const ctx = await contextFor(year);
        const months = yearMonths(year);
        const asOf = asOfDate(months[months.length - 1]);
        const lines = await linesByMonth(ctx, months, PERSON_SELECT);
        const [opening, closingNow] = await Promise.all([fetchSalaryBalance(ctx, `${year}-01-01T00:00:00`), fetchSalaryBalance(ctx, balanceBoundary(asOf))]);
        const keys = [...new Set([...personsOf(opening).keys(), ...personsOf(closingNow).keys(), ...Object.values(lines).flat().flatMap((r) => [personOf(r, "Dr"), personOf(r, "Cr")])].filter(Boolean))];
        const rows = await lookupRows(PERSON, keys, "Description");
        return buildEmployees({ year, asOf, months, linesByMonth: lines, opening, closingNow, ctx, names: new Map([...rows].map(([k, r]) => [k, String(r?.Description ?? "").trim()])) });
      }),
    { refresh }
  );
}
