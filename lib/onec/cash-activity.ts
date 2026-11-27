// «Мөнгөн хөрөнгө» табын «Данснууд»: данс идэвхтэй (тухайн сард гүйлгээтэй) эсэх, нэг сарын мэдээнээс дансны сүүлийн гүйлгээ. Цэвэр логик: 1С, DB-д хандахгүй.
//  * Гүйлгээ = орлого, зарлага, дансны хоорондын шилжүүлэг (аль ч талаас). Сарын эцсийн ханшийн тохируулга (Тогтмол үйлдэл) болон 0 дүнтэй бичилт гүйлгээ БИШ.
//  * Сар бүрийн сүүлийн гүйлгээг sync бичиж (lib/onec/cash-last-store.ts), хуудас зөвхөн DB-ээс уншина: хэрэглэгчийн хүсэлтээр 1С руу хандахгүй.
import type { CashEntry, CashResult } from "./cash";

/** Дансны талаас: орсон бол +, гарсан бол − */
export interface LastMove {
  date: string;
  amount: number;
}

const REGULATORY = "РегламентнаяОперация";

/** Бодит гүйлгээ: ханшийн тохируулга биш, дүн нь 0 биш */
export const isRealMove = (e: CashEntry): boolean => e.docType !== REGULATORY && e.amount !== 0;

/** Данс бүрийн хөдөлгөөн: [огноо, цаг, тэмдэгтэй дүн] */
function* movesOf(cash: CashResult, key: string): Generator<{ date: string; time: string; amount: number }> {
  for (const e of cash.entries) {
    if (e.accountKey !== key || !isRealMove(e)) continue;
    yield { date: e.date, time: e.time ?? "", amount: e.type === "inflow" ? e.amount : -e.amount };
  }
  for (const t of cash.transfers) {
    if (!isRealMove(t)) continue;
    if (t.counterKey === key) yield { date: t.date, time: t.time ?? "", amount: t.amount };
    if (t.accountKey === key) yield { date: t.date, time: t.time ?? "", amount: -t.amount };
  }
}

/** Данс энэ сард (`upTo` хүртэл) бодит гүйлгээтэй юу */
export function hasMoves(cash: CashResult, key: string, from: string, to: string): boolean {
  for (const m of movesOf(cash, key)) if (m.date >= from && m.date <= to) return true;
  return false;
}

/** `cash.month`-д багтах, `upTo`-аас ихгүй сүүлийн гүйлгээ (олдохгүй бол null). Нэг өдөрт олон бол хамгийн сүүлийн цагтай нь. */
export function lastMoveIn(cash: CashResult, key: string, upTo: string): LastMove | null {
  let best: { date: string; time: string; amount: number } | null = null;
  for (const m of movesOf(cash, key)) {
    if (m.date > upTo) continue;
    if (!best || m.date > best.date || (m.date === best.date && m.time > best.time)) best = m;
  }
  return best ? { date: best.date, amount: best.amount } : null;
}

/** Энэ сард (`upTo` хүртэл) бодит гүйлгээтэй дансуудын түлхүүр */
export function activeKeys(cash: CashResult, upTo: string): Set<string> {
  const from = `${cash.month}-01`;
  return new Set(cash.accounts.filter((a) => hasMoves(cash, a.key, from, upTo)).map((a) => a.key));
}

