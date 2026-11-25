// «Мөнгөн хөрөнгө» табын «Данснууд»: данс бүрийн карт (нэр, үлдэгдэл, өнөөдрийн орсон/гарсан) ба нэг дансны сонгосон хугацааны 4 тоо.
// Цэвэр функц (DB, 1С-д хандахгүй): `CashResult` (lib/onec/cash.ts, сарын бүх бичилт) ба админы нэрийн тохиргоогоос. Захирлын харагдац:
// дансны код, «1С», Комментарий гарахгүй; дансны БҮТЭН дугаар зөвхөн ADMIN-д, бусдад сүүлийн 4 орон.
//  * Орсон = орлого + бусад данснаас шилжүүлж ирсэн; Гарсан = зарлага + бусад данс руу шилжүүлсэн. Тиймээс эхний + орсон − гарсан = эцсийн.
//  * Шилжүүлэг (компанийн дотоод) нь «Мөнгөн хөрөнгө» табын нийт орлого/зарлагад ОРОХГҮЙ: тэр нь cash.totals-д өөрчлөгдөөгүй.
import { createHash } from "node:crypto";
import { parseBankAccountName, type CashAccount, type CashEntry, type CashFx, type CashResult } from "./cash";

export interface AccountSetting {
  /** дансны түлхүүр: `bank:<guid>` эсвэл `acct:<код>` */
  key: string;
  /** админы өгсөн нэр («Үндсэн данс»); хоосон бол банк + сүүлийн 4 орон */
  name: string;
  hidden: boolean;
  /** админы дараалал (бага нь эхэнд); null бол үлдэгдлээр */
  sortOrder: number | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Дансны түлхүүрийн богино нийтийн ID (URL-д дансны кодыг ил гаргахгүй) */
export const publicId = (key: string): string => createHash("sha1").update(key).digest("hex").slice(0, 12);

export const last4 = (number: string): string => number.replace(/\D/g, "").slice(-4);

/** «Касс дахь бэлэн мөнгө - MNT» -> «Касс · MNT»; бусад нэр хэвээр */
function cashTitle(name: string): string {
  const m = /^Касс дахь бэлэн мөнгө\s*-\s*(.+)$/.exec(name.trim());
  return m ? `Касс · ${m[1].trim()}` : name.trim();
}

/** «ХААН банк ··6128» (дугааргүй бол банкны нэр) */
function bankPart(a: CashAccount): string {
  const l4 = last4(a.number);
  return [a.bank || "Банк", l4 ? `··${l4}` : ""].filter(Boolean).join(" ");
}

/** Дансны бүтэн тайлбар: «ХААН банк ··6128 · MNT»; кассын хувьд «Касс · MNT» */
export function accountDescription(a: CashAccount): string {
  return a.kind === "bank" ? `${bankPart(a)} · ${a.currency}` : cashTitle(a.name);
}

/** Картын гарчиг (админы нэр байвал тэр, үгүй бол бүтэн тайлбар) ба доорх жижиг мөр (зөвхөн админы нэртэй үед) */
export function accountTitles(a: CashAccount, s?: AccountSetting): { title: string; subtitle: string | null } {
  const named = s?.name.trim();
  const description = accountDescription(a);
  return named ? { title: named, subtitle: description } : { title: description, subtitle: null };
}

/** Шилжүүлгийн жагсаалтад: «Үндсэн данс», «Валютын данс (USD)», нэргүй бол «ХААН банк ··6128 (USD)» */
export function accountShortName(a: CashAccount, s?: AccountSetting): string {
  const base = s?.name.trim() || (a.kind === "bank" ? bankPart(a) : cashTitle(a.name));
  return a.kind === "bank" && a.currency !== "MNT" ? `${base} (${a.currency})` : base;
}

export interface AccountCard {
  /** нийтийн ID (дансны код биш) */
  id: string;
  title: string;
  subtitle: string | null;
  kind: "bank" | "cash";
  bank: string;
  /** сүүлийн 4 орон; ADMIN-д л `number` (бүтэн) */
  last4: string;
  number?: string;
  currency: string;
  /** одоогийн үлдэгдэл (₮) ба валютын данс бол валютаар */
  closing: number;
  closingFx: number | null;
  /** өнөөдөр орсон (орлого + шилжүүлж ирсэн), гарсан (зарлага + шилжүүлсэн), ₮ */
  today: { inflow: number; outflow: number };
  hidden: boolean;
}

export interface AccountCards {
  asOf: string;
  accounts: AccountCard[];
  /** БҮХ дансны (нуусан орно) нийт үлдэгдэл, ₮: «Мөнгөн хөрөнгө» табын эцсийн үлдэгдэлтэй тэнцүү */
  total: number;
  hiddenCount: number;
}

/** Нэг дансны өдрийн орсон, гарсан: бичилт + шилжүүлэг */
function flowsOn(cash: CashResult, key: string, from: string, to: string) {
  let inflow = 0;
  let outflow = 0;
  let transfersIn = 0;
  let transfersOut = 0;
  let fxIn = 0;
  let fxOut = 0;
  let fxTransfersIn = 0;
  let fxTransfersOut = 0;
  const inRange = (e: CashEntry) => e.date >= from && e.date <= to;
  for (const e of cash.entries) {
    if (e.accountKey !== key || !inRange(e)) continue;
    if (e.type === "inflow") {
      inflow += e.amount;
      fxIn += e.fxAmount ?? 0;
    } else if (e.type === "outflow") {
      outflow += e.amount;
      fxOut += e.fxAmount ?? 0;
    }
  }
  for (const t of cash.transfers) {
    if (!inRange(t)) continue;
    if (t.accountKey === key) {
      transfersOut += t.amount;
      fxTransfersOut += t.fxAmount ?? 0;
    }
    if (t.counterKey === key) {
      transfersIn += t.amount;
      fxTransfersIn += t.counterFxAmount ?? 0;
    }
  }
  return { inflow, outflow, transfersIn, transfersOut, fxIn, fxOut, fxTransfersIn, fxTransfersOut };
}

const orderCards = (a: AccountCard, b: AccountCard, order: Map<string, number | null>, idToKey: Map<string, string>) => {
  const oa = order.get(idToKey.get(a.id) ?? "") ?? null;
  const ob = order.get(idToKey.get(b.id) ?? "") ?? null;
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  if (oa !== null && ob === null) return -1;
  if (oa === null && ob !== null) return 1;
  return Math.abs(b.closing) - Math.abs(a.closing) || a.title.localeCompare(b.title, "mn");
};

/** «Данснууд» хэсгийн картууд: нуусан данс гарахгүй (нийт үлдэгдэлд орно); админы дараалал, үгүй бол үлдэгдлээр. */
export function buildAccountCards(cash: CashResult, settings: ReadonlyMap<string, AccountSetting>, opts: { today: string; isAdmin: boolean }): AccountCards {
  const idToKey = new Map<string, string>();
  const order = new Map<string, number | null>();
  const cards: AccountCard[] = [];
  let hiddenCount = 0;
  for (const a of cash.accounts) {
    const s = settings.get(a.key);
    idToKey.set(publicId(a.key), a.key);
    order.set(a.key, s?.sortOrder ?? null);
    if (s?.hidden) {
      hiddenCount++;
      continue;
    }
    const f = flowsOn(cash, a.key, opts.today, opts.today);
    const { title, subtitle } = accountTitles(a, s);
    cards.push({
      id: publicId(a.key),
      title,
      subtitle,
      kind: a.kind,
      bank: a.bank,
      last4: last4(a.number),
      ...(opts.isAdmin && a.number ? { number: a.number } : {}),
      currency: a.currency,
      closing: a.closing,
      closingFx: a.fx ? a.fx.closing : null,
      today: { inflow: round2(f.inflow + f.transfersIn), outflow: round2(f.outflow + f.transfersOut) },
      hidden: false,
    });
  }
  cards.sort((x, y) => orderCards(x, y, order, idToKey));
  return { asOf: cash.asOf, accounts: cards, total: round2(cash.accounts.reduce((s, a) => s + a.closing, 0)), hiddenCount };
}

/** Нийтийн ID-аар дансыг олно (үгүй бол null) */
export const findAccount = (cash: CashResult, id: string): CashAccount | null => cash.accounts.find((a) => publicId(a.key) === id) ?? null;

export interface AccountPeriod {
  from: string;
  to: string;
  opening: number;
  /** орсон = орлого + шилжүүлж ирсэн; гарсан = зарлага + шилжүүлсэн */
  inflow: number;
  outflow: number;
  /** үүнээс дансны хооронд шилжсэн */
  transfersIn: number;
  transfersOut: number;
  closing: number;
  /** валютын данс: валютаар (₮ данс бол null) */
  fx: CashFx | null;
}

/**
 * Нэг дансны сонгосон хугацааны (нэг өдөр эсвэл нэг сар; `from..to` нь `cash.month`-ийн дотор) 4 тоо. Хугацаанаас өмнөх хөдөлгөөнөөр сарын эхний
 * үлдэгдлийг урагшлуулж эхний үлдэгдлийг гаргана: эхний + орсон − гарсан = эцсийн (шилжүүлэг орсон/гарсанд багтана).
 */
export function accountPeriod(cash: CashResult, key: string, from: string, to: string): AccountPeriod | null {
  const a = cash.accounts.find((x) => x.key === key);
  if (!a) return null;
  const monthStart = `${cash.month}-01`;
  const before = from > monthStart ? flowsOn(cash, key, monthStart, prevDay(from)) : null;
  const inP = flowsOn(cash, key, from, to);
  const net = (f: ReturnType<typeof flowsOn>) => f.inflow + f.transfersIn - f.outflow - f.transfersOut;
  const netFx = (f: ReturnType<typeof flowsOn>) => f.fxIn + f.fxTransfersIn - f.fxOut - f.fxTransfersOut;
  const opening = a.opening + (before ? net(before) : 0);
  const inflow = inP.inflow + inP.transfersIn;
  const outflow = inP.outflow + inP.transfersOut;
  let fx: CashFx | null = null;
  if (a.fx) {
    const openingFx = a.fx.opening + (before ? netFx(before) : 0);
    fx = {
      opening: round2(openingFx),
      inflow: round2(inP.fxIn + inP.fxTransfersIn),
      outflow: round2(inP.fxOut + inP.fxTransfersOut),
      transfersIn: round2(inP.fxTransfersIn),
      transfersOut: round2(inP.fxTransfersOut),
      closing: round2(openingFx + netFx(inP)),
    };
  }
  return { from, to, opening: round2(opening), inflow: round2(inflow), outflow: round2(outflow), transfersIn: round2(inP.transfersIn), transfersOut: round2(inP.transfersOut), closing: round2(opening + inflow - outflow), fx };
}

function prevDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Дансны хуудасны гүйлгээ: тэр дансны орлого, зарлага + шилжүүлэг (тухайн дансны талаас нь орсон эсвэл гарсан гэж). Шилжүүлэг нь `transfer: true`,
 * харилцагчийн оронд нөгөө дансны ойлгомжтой нэр («→ Валютын данс (USD)»). Ангилал/цалингийн нууцлалыг дуудагч (withCategories) хариуцна.
 */
export function transferEntriesFor(cash: CashResult, key: string, nameOf: (key: string) => string): (CashEntry & { transfer: true })[] {
  const out: (CashEntry & { transfer: true })[] = [];
  for (const t of cash.transfers) {
    if (t.accountKey === key) out.push({ ...t, id: `${t.id}:out`, type: "outflow", account: nameOf(key), counterpart: `→ ${nameOf(t.counterKey ?? "")}`, accountKey: key, counterKey: undefined, transfer: true });
    if (t.counterKey === key) out.push({ ...t, id: `${t.id}:in`, type: "inflow", account: nameOf(key), counterpart: `← ${nameOf(t.accountKey)}`, accountKey: key, counterKey: undefined, fxAmount: t.counterFxAmount, transfer: true });
  }
  return out;
}

/** Дансны түлхүүр -> ойлгомжтой нэр (шилжүүлгийн жагсаалтад) */
export function accountNames(cash: CashResult, settings: ReadonlyMap<string, AccountSetting>): (key: string) => string {
  const byKey = new Map(cash.accounts.map((a) => [a.key, a]));
  return (key) => {
    const a = byKey.get(key);
    return a ? accountShortName(a, settings.get(key)) : "Бусад данс";
  };
}

/**
 * Дансны бүтэн дугаар зөвхөн ADMIN-д. Бусдад «5003636128, ХААН банк, MNT» -> «ХААН банк ··6128 · MNT». Дугаар олдохгүй (кассын нэр г.м.) нэр хэвээр.
 */
export function maskAccountName(name: string): string {
  const p = parseBankAccountName(name);
  if (!p.number) return name;
  return `${p.bank || "Банк"} ··${last4(p.number)} · ${p.currency}`;
}

/** Хэрэглэгчид харуулах `CashResult`: ADMIN биш бол дансны бүтэн дугаар (accounts[].number, нэр, шилжүүлгийн нэр) далдлагдана. Тоо хэвээр. */
export function maskCashForViewer<T extends CashResult>(cash: T, isAdmin: boolean): T {
  if (isAdmin) return cash;
  const mask = (e: CashEntry): CashEntry => ({ ...e, account: maskAccountName(e.account), ...(e.type === "internal" ? { counterpart: maskAccountName(e.counterpart) } : {}) });
  return {
    ...cash,
    accounts: cash.accounts.map((a) => ({ ...a, name: maskAccountName(a.name), number: last4(a.number) })),
    transfers: cash.transfers.map(mask),
    recent: cash.recent.map(mask),
    entries: cash.entries.map(mask),
  };
}
