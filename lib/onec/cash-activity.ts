// «Мөнгөн хөрөнгө» табын «Данснууд»: данс идэвхтэй (тухайн сард гүйлгээтэй) эсэх, дансны СҮҮЛИЙН гүйлгээ. Цэвэр логик: 1С-д шууд хандахгүй, хайлтыг `deps`-ээр авна (тестлэгдэнэ).
//  * Гүйлгээ = орлого, зарлага, дансны хоорондын шилжүүлэг (аль ч талаас). Сарын эцсийн ханшийн тохируулга (Тогтмол үйлдэл) болон 0 дүнтэй бичилт гүйлгээ БИШ.
//  * Дансны сүүлийн гүйлгээг сараар ухарч хайна: сар бүрийн «Turnovers» (хөнгөн) хүсэлтээр тэр сард хөдөлгөөнтэй эсэхийг л шалгаад, хөдөлгөөнтэй сарыг л бүтнээр нь уншина.
import { addMonths } from "./dates";
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

export interface LastMoveDeps {
  /** тэр сард хөдөлгөөнтэй (Дт, Кт эргэлт 0 биш) дансны түлхүүрүүд: хөнгөн хүсэлт */
  turnoverKeys: (month: string) => Promise<ReadonlySet<string>>;
  /** сарын бүтэн мэдээ (cache-тай) */
  loadMonth: (month: string) => Promise<CashResult>;
  now?: () => number;
}

/**
 * Дансуудын сүүлийн гүйлгээг `upTo` огнооноос ухарч хайна. `maxMonths` сар ухараад олдохгүй бол null. Хугацааны төсөв дуустал хайж чадаагүй дансыг үр дүнд ОРУУЛАХГҮЙ
 * (null биш: «хайж дуусаагүй»); дуудагч дахин дуудаж болно (сарын хүсэлтүүд cache-тай тул үргэлжилнэ).
 * Сар бүрт зөвхөн нэг хөнгөн хүсэлт, хөдөлгөөнтэй сарыг л бүтнээр нь уншина.
 */
export async function findLastMoves(keys: readonly string[], upTo: string, deps: LastMoveDeps, opts: { maxMonths?: number; budgetMs?: number } = {}): Promise<Map<string, LastMove | null>> {
  const now = deps.now ?? Date.now;
  const start = now();
  const maxMonths = opts.maxMonths ?? 24;
  const budget = opts.budgetMs ?? 45_000;
  const result = new Map<string, LastMove | null>();
  const unresolved = new Set(keys);
  let month = upTo.slice(0, 7);
  let outOfTime = false;
  for (let i = 0; i < maxMonths && unresolved.size > 0; i++) {
    if (now() - start >= budget) {
      outOfTime = true;
      break;
    }
    const active = await deps.turnoverKeys(month);
    const candidates = [...unresolved].filter((k) => active.has(k));
    if (candidates.length > 0) {
      const cash = await deps.loadMonth(month);
      for (const k of candidates) {
        const m = lastMoveIn(cash, k, upTo);
        if (m) {
          result.set(k, m);
          unresolved.delete(k);
        }
      }
    }
    month = addMonths(month, -1);
  }
  if (!outOfTime) for (const k of unresolved) result.set(k, null);
  return result;
}
