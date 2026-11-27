import { describe, expect, it } from "vitest";
import { buildCash, type CashEntry, type CashResult } from "./cash";
import { activeKeys, hasMoves, isRealMove, lastMoveIn } from "./cash-activity";
import { fixtureInputs, K } from "./cash-accounts.fixture";

const cash: CashResult = buildCash(fixtureInputs());

const entry = (over: Partial<CashEntry>): CashEntry => ({
  id: "x",
  date: "2026-09-10",
  type: "inflow",
  account: "A",
  accountKey: "acct:1",
  counterpart: "P",
  article: "",
  memo: "",
  document: "Банкны орлого",
  docType: "ПоступлениеНаРасчетныйСчет",
  ref: "r",
  amount: 100,
  ...over,
});
const withMoves = (entries: CashEntry[], transfers: CashEntry[] = [], month = "2026-09"): CashResult => ({ ...cash, month, entries, transfers });

describe("isRealMove: ханшийн тохируулга (Тогтмол үйлдэл) ба 0 дүн гүйлгээ БИШ", () => {
  it("энгийн бичилт гүйлгээ", () => {
    expect(isRealMove(entry({}))).toBe(true);
    expect(isRealMove(entry({ type: "outflow", amount: 5 }))).toBe(true);
  });
  it("Тогтмол үйлдэл, 0 дүн гүйлгээ биш", () => {
    expect(isRealMove(entry({ docType: "РегламентнаяОперация" }))).toBe(false);
    expect(isRealMove(entry({ amount: 0 }))).toBe(false);
  });
});

describe("lastMoveIn: сүүлийн гүйлгээ (дансны талаас тэмдэгтэй)", () => {
  const key = "acct:1";
  it("хамгийн сүүлийн өдөр; орсон +, гарсан −", () => {
    const c = withMoves([entry({ id: "a", date: "2026-09-05", amount: 100 }), entry({ id: "b", date: "2026-09-12", type: "outflow", amount: 40 }), entry({ id: "c", date: "2026-09-08", amount: 7 })]);
    expect(lastMoveIn(c, key, "2026-09-30")).toEqual({ date: "2026-09-12", amount: -40 });
    expect(lastMoveIn(c, key, "2026-09-10")).toEqual({ date: "2026-09-08", amount: 7 }); // upTo-оос хойших нь орохгүй
    expect(lastMoveIn(c, key, "2026-09-01")).toBeNull();
  });
  it("нэг өдөрт олон бол хамгийн сүүлийн цагтай нь", () => {
    const c = withMoves([entry({ id: "a", amount: 1, time: "09:00:00" }), entry({ id: "b", amount: 2, time: "17:30:00", type: "outflow" }), entry({ id: "c", amount: 3, time: "12:00:00" })]);
    expect(lastMoveIn(c, key, "2026-09-30")).toEqual({ date: "2026-09-10", amount: -2 });
  });
  it("шилжүүлэг: зарлагадсан тал −, хүлээн авсан тал +", () => {
    const t = entry({ id: "t", type: "internal", date: "2026-09-20", accountKey: "acct:1", counterKey: "acct:2", amount: 500 });
    const c = withMoves([], [t]);
    expect(lastMoveIn(c, "acct:1", "2026-09-30")).toEqual({ date: "2026-09-20", amount: -500 });
    expect(lastMoveIn(c, "acct:2", "2026-09-30")).toEqual({ date: "2026-09-20", amount: 500 });
  });
  it("Тогтмол үйлдэл, 0 дүн, өөр данс алгасагдана", () => {
    const c = withMoves([entry({ id: "r", date: "2026-09-30", docType: "РегламентнаяОперация" }), entry({ id: "z", date: "2026-09-29", amount: 0 }), entry({ id: "o", date: "2026-09-28", accountKey: "acct:9" }), entry({ id: "ok", date: "2026-09-03" })]);
    expect(lastMoveIn(c, key, "2026-09-30")).toEqual({ date: "2026-09-03", amount: 100 });
  });
});

describe("hasMoves, activeKeys", () => {
  it("хугацааны дотор бодит гүйлгээтэй эсэх", () => {
    expect(hasMoves(cash, K.main, "2026-09-01", "2026-09-30")).toBe(true);
    expect(hasMoves(cash, K.main, "2026-09-08", "2026-09-30")).toBe(false); // 09-05, 09-07-ны дараа гүйлгээгүй
    expect(hasMoves(cash, K.hidden, "2026-09-01", "2026-09-30")).toBe(false);
  });
  it("энэ сард гүйлгээтэй (шилжүүлгийн аль ч тал) данс идэвхтэй, үлдсэн нь хөдөлгөөнгүй", () => {
    const a = activeKeys(cash, "2026-09-30");
    expect([...a].sort()).toEqual([K.main, K.usd, K.cash].sort()); // кассад зөвхөн шилжүүлж ирсэн: идэвхтэй
    expect(a.has(K.hidden)).toBe(false);
  });
  it("upTo хүртэл л тоолно", () => {
    expect([...activeKeys(cash, "2026-09-05")]).toEqual([K.main]);
  });
});

