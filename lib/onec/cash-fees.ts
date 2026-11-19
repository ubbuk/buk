// Банкны шимтгэлийг үндсэн гүйлгээтэй холбох. Банк гадаад гүйлгээ хийхэд шимтгэлийг тусдаа баримтаар (өөр минутад) бичдэг тул жагсаалтад
// «84.1 сая₮ төлбөр» ба «20,000₮ шимтгэл» хоёр салангид харагддаг. Энд шимтгэлийг түүний үндсэн төлбөртэй ЗӨВХӨН найдвартай үед холбоно:
//   - ижил банкны данс, ижил өдөр, цаг ойрхон (±10 минут);
//   - үндсэн гүйлгээ нь ГАДААД гүйлгээ: гүйлгээний утгад валют (CNY, USD ...) эсвэл данс нь валютын данс;
//   - үндсэн гүйлгээ нь жинхэнэ төлбөр: харьцсан данс нь орлого, зардлын данс (5xxx, 7xxx, 9xxx: ханшийн зөрүү, шимтгэл өөрөө) БИШ;
//   - яг ХОЁР (эсвэл олон) боломжит үндсэн гүйлгээ байвал (аль нь вэ гэдэг тодорхойгүй) холбохгүй. Буруу холбохоос холбохгүй нь дээр.
// Холбоо нь зөвхөн харагдац: ангилал, нийлбэр өөрчлөгдөхгүй, шимтгэл «Банкны шимтгэл» ангилалдаа хэвээр, нэг ч төгрөг давхар тоологдохгүй.
import type { ReportEntry } from "./cash-report";

export const FEE_WINDOW_SECONDS = 10 * 60;

const CURRENCY = /(?:^|[^A-Za-z])(USD|EUR|CNY|RMB|RUB|JPY|KRW|GBP|AUD|CAD|CHF|INR|TRY|AED|KZT|HKD|SGD)(?![A-Za-z])|юань|доллар|евро|рубль|иен/i;
/** Гадаад гүйлгээний шимтгэлийн утга */
const FOREIGN_FEE_MEMO = /гадаад\s+гүйлгээ/i;

const round2 = (v: number) => Math.round(v * 100) / 100;

const seconds = (time: string | undefined): number | null => {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time ?? "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : null;
};

/** Жинхэнэ төлбөр: харьцсан данс нь орлого, зардлын (5xxx, 7xxx, 9xxx) данс биш. «Гадаад валютын ханшийн зөрүүний гарз» төлбөр биш. */
const isPayment = (e: Pick<ReportEntry, "counterAccount">): boolean => !/^[579]/.test(e.counterAccount ?? "");

/** Банкны шимтгэл: «Банкны шимтгэл» ангилалын зарлага (орлого биш) */
export const isBankFee = (e: Pick<ReportEntry, "category" | "type">): boolean => e.category === "bankfee" && e.type === "outflow";

/** Данс нь валютын данс (нэр нь «…, USD» гэж төгсөнө; MNT биш) */
const foreignAccount = (account: string): boolean => {
  const m = /,\s*([A-Za-z]{3})\s*$/.exec(account.trim());
  return !!m && m[1].toUpperCase() !== "MNT";
};

/** Үндсэн гүйлгээ нь гадаад гүйлгээ эсэх: утгад валют, эсвэл валютын данс */
export const isForeignPayment = (e: Pick<ReportEntry, "memo" | "account" | "article">): boolean => CURRENCY.test(e.memo) || CURRENCY.test(e.article) || foreignAccount(e.account);

/** Шимтгэл нь гадаад гүйлгээний шимтгэл эсэх: утгаар, эсвэл гадаад үндсэн гүйлгээтэй холбогдсон. */
export const isForeignFee = (fee: Pick<ReportEntry, "memo">, main?: Pick<ReportEntry, "memo" | "account" | "article"> | null): boolean => FOREIGN_FEE_MEMO.test(fee.memo) || (!!main && isForeignPayment(main));

export interface FeeLinks {
  /** шимтгэлийн id -> үндсэн гүйлгээний id */
  mainOf: Map<string, string>;
  /** үндсэн гүйлгээний id -> түүний шимтгэлүүд (цагаар) */
  feesOf: Map<string, ReportEntry[]>;
  /** холбоогүй үлдсэн шимтгэлүүд, шалтгаантай */
  unlinked: { fee: ReportEntry; reason: "none" | "ambiguous" | "no-time" }[];
}

export function linkFees(entries: readonly ReportEntry[], windowSeconds = FEE_WINDOW_SECONDS): FeeLinks {
  const mainOf = new Map<string, string>();
  const feesOf = new Map<string, ReportEntry[]>();
  const unlinked: FeeLinks["unlinked"] = [];

  // боломжит үндсэн гүйлгээ: данс|өдрөөр, зөвхөн цагтай, шимтгэл биш, цалингийн нэгтгэсэн биш, гадаад
  const mains = new Map<string, { e: ReportEntry; t: number }[]>();
  for (const e of entries) {
    if (e.type !== "outflow" || isBankFee(e) || e.payroll || !isPayment(e) || !isForeignPayment(e)) continue;
    const t = seconds(e.time);
    if (t === null) continue;
    const key = `${e.account}|${e.date}`;
    mains.set(key, [...(mains.get(key) ?? []), { e, t }]);
  }

  for (const fee of entries) {
    if (!isBankFee(fee)) continue;
    const t = seconds(fee.time);
    if (t === null) {
      unlinked.push({ fee, reason: "no-time" });
      continue;
    }
    const near = (mains.get(`${fee.account}|${fee.date}`) ?? []).filter((m) => Math.abs(m.t - t) <= windowSeconds);
    if (near.length === 1) {
      mainOf.set(fee.id, near[0].e.id);
      feesOf.set(near[0].e.id, [...(feesOf.get(near[0].e.id) ?? []), fee]);
    } else unlinked.push({ fee, reason: near.length === 0 ? "none" : "ambiguous" });
  }
  for (const list of feesOf.values()) list.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  return { mainOf, feesOf, unlinked };
}

export interface FeeSummary {
  count: number;
  total: number;
}
const sum = (list: readonly { amount: number }[]): FeeSummary => ({ count: list.length, total: round2(list.reduce((s, e) => s + e.amount, 0)) });

export interface FeeReport {
  /** бүх банкны шимтгэл (ангилалын нийлбэртэй ижил) */
  total: FeeSummary;
  /** сарын «Гадаад гүйлгээний шимтгэл» */
  foreign: FeeSummary;
  /** үүнээс үндсэн гүйлгээтэй холбогдсон, холбогдоогүй */
  linked: FeeSummary;
  unlinked: FeeSummary;
  /** аль гүйлгээнд хамаарах: үндсэн гүйлгээ бүрээр, шимтгэлээр нь эрэмбэлсэн */
  byMain: { id: string; date: string; counterpart: string; amount: number; fee: number; count: number }[];
}

export function feeReport(entries: readonly ReportEntry[], links: FeeLinks): FeeReport {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const fees = entries.filter(isBankFee);
  const foreign = fees.filter((f) => isForeignFee(f, byId.get(links.mainOf.get(f.id) ?? "")));
  const linked = fees.filter((f) => links.mainOf.has(f.id));
  const byMain = [...links.feesOf].map(([id, list]) => {
    const main = byId.get(id)!;
    return { id, date: main.date, counterpart: main.counterpart, amount: main.amount, fee: sum(list).total, count: list.length };
  });
  byMain.sort((a, b) => b.fee - a.fee || b.date.localeCompare(a.date));
  return { total: sum(fees), foreign: sum(foreign), linked: sum(linked), unlinked: sum(fees.filter((f) => !links.mainOf.has(f.id))), byMain };
}

export type FeeFilter = "linked" | "unlinked" | "foreign";
export const isFeeFilter = (v: unknown): v is FeeFilter => v === "linked" || v === "unlinked" || v === "foreign";

/** Шимтгэлийн шүүлт (зөвхөн банкны шимтгэл): холбогдсон / холбогдоогүй / гадаад гүйлгээний. */
export function feeMatches(kind: FeeFilter, e: ReportEntry, links: FeeLinks, byId: ReadonlyMap<string, ReportEntry>): boolean {
  if (!isBankFee(e)) return false;
  if (kind === "linked") return links.mainOf.has(e.id);
  if (kind === "unlinked") return !links.mainOf.has(e.id);
  return isForeignFee(e, byId.get(links.mainOf.get(e.id) ?? ""));
}

export interface EntryFeeInfo {
  /** үндсэн гүйлгээний шимтгэлүүд ба «Нийт зарлага» (төлбөр + шимтгэл) */
  fees?: { count: number; total: number; grandTotal: number; items: { id: string; amount: number; time: string; memo: string }[] };
  /** шимтгэл нь аль үндсэн гүйлгээнд хамаарах (null = холбогдоогүй) */
  linkedTo?: { id: string; counterpart: string; amount: number; date: string } | null;
  /** шимтгэл: гадаад гүйлгээний эсэх */
  foreignFee?: boolean;
}

/** Нэг гүйлгээний шимтгэлийн мэдээлэл (хуудасны мөр бүрт) */
export function feeInfoOf(e: ReportEntry, links: FeeLinks, byId: ReadonlyMap<string, ReportEntry>): EntryFeeInfo {
  const mine = links.feesOf.get(e.id);
  if (mine?.length) {
    const total = round2(mine.reduce((s, f) => s + f.amount, 0));
    return { fees: { count: mine.length, total, grandTotal: round2(e.amount + total), items: mine.map((f) => ({ id: f.id, amount: f.amount, time: (f.time ?? "").slice(0, 5), memo: f.memo })) } };
  }
  if (isBankFee(e)) {
    const main = byId.get(links.mainOf.get(e.id) ?? "");
    return { linkedTo: main ? { id: main.id, counterpart: main.counterpart, amount: main.amount, date: main.date } : null, foreignFee: isForeignFee(e, main) };
  }
  return {};
}
