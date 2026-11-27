import { describe, expect, it } from "vitest";
import { buildCash, type CashEntry, type CashResult } from "./cash";
import { activeKeys, findLastMoves, hasMoves, isRealMove, lastMoveIn, type LastMoveDeps } from "./cash-activity";
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

describe("findLastMoves: сараар ухарч хайна, хөдөлгөөнтэй сарыг л бүтнээр уншина", () => {
  const sep = withMoves([entry({ id: "s", date: "2026-08-14", type: "outflow", amount: 30 })], [], "2026-08");
  const mk = (turn: Record<string, string[]>, months: Record<string, CashResult>) => {
    const calls = { turnover: [] as string[], load: [] as string[] };
    const deps: LastMoveDeps = {
      turnoverKeys: async (m) => (calls.turnover.push(m), new Set(turn[m] ?? [])),
      loadMonth: async (m) => (calls.load.push(m), months[m] ?? withMoves([], [], m)),
    };
    return { deps, calls };
  };

  it("сүүлийн гүйлгээтэй сар хүртэл ухарч олно; хоосон сарыг уншихгүй", async () => {
    const { deps, calls } = mk({ "2026-08": ["acct:1"] }, { "2026-08": sep });
    const r = await findLastMoves(["acct:1"], "2026-11-27", deps);
    expect(r.get("acct:1")).toEqual({ date: "2026-08-14", amount: -30 });
    expect(calls.turnover).toEqual(["2026-11", "2026-10", "2026-09", "2026-08"]); // олдоход зогсоно
    expect(calls.load).toEqual(["2026-08"]); // зөвхөн хөдөлгөөнтэй сар
  });
  it("олон данс: тус бүрийн сүүлийн гүйлгээ өөр сард; нэг нь олдохгүй бол null", async () => {
    const oct = withMoves([entry({ id: "o", accountKey: "acct:2", date: "2026-10-02", amount: 9 })], [], "2026-10");
    const { deps } = mk({ "2026-10": ["acct:2"], "2026-08": ["acct:1"] }, { "2026-10": oct, "2026-08": sep });
    const r = await findLastMoves(["acct:1", "acct:2", "acct:3"], "2026-11-27", deps, { maxMonths: 6 });
    expect(r.get("acct:2")).toEqual({ date: "2026-10-02", amount: 9 });
    expect(r.get("acct:1")).toEqual({ date: "2026-08-14", amount: -30 });
    expect(r.get("acct:3")).toBeNull();
  });
  it("зөвхөн ханшийн тохируулгатай сар «сүүлийн гүйлгээ» болохгүй, цааш ухарна", async () => {
    const reg = withMoves([entry({ id: "g", date: "2026-10-31", docType: "РегламентнаяОперация" })], [], "2026-10");
    const { deps } = mk({ "2026-10": ["acct:1"], "2026-08": ["acct:1"] }, { "2026-10": reg, "2026-08": sep });
    expect((await findLastMoves(["acct:1"], "2026-11-27", deps)).get("acct:1")).toEqual({ date: "2026-08-14", amount: -30 });
  });
  it("upTo-оос хойших гүйлгээг тоохгүй (өдрийн хуудас)", async () => {
    const sepCash = withMoves([entry({ id: "a", date: "2026-09-05" }), entry({ id: "b", date: "2026-09-20" })]);
    const { deps } = mk({ "2026-09": ["acct:1"] }, { "2026-09": sepCash });
    expect((await findLastMoves(["acct:1"], "2026-09-10", deps)).get("acct:1")).toEqual({ date: "2026-09-05", amount: 100 });
  });
  it("maxMonths-д олдохгүй бол null; хугацааны төсөв дуусвал зогсоно", async () => {
    const { deps, calls } = mk({}, {});
    const r = await findLastMoves(["acct:1"], "2026-11-27", deps, { maxMonths: 5 });
    expect(r.get("acct:1")).toBeNull();
    expect(calls.turnover).toHaveLength(5);
    let t = 0;
    const slow = mk({}, {});
    const r2 = await findLastMoves(["acct:1"], "2026-11-27", { ...slow.deps, now: () => (t += 20_000) }, { budgetMs: 45_000 });
    expect(r2.has("acct:1")).toBe(false); // хайж дуусаагүй: null биш, үр дүнд оруулахгүй
    expect(slow.calls.turnover.length).toBeLessThan(5);
  });
  it("хайх данс байхгүй бол 1С руу хандахгүй", async () => {
    const { deps, calls } = mk({}, {});
    expect((await findLastMoves([], "2026-11-27", deps)).size).toBe(0);
    expect(calls.turnover).toHaveLength(0);
  });
});
