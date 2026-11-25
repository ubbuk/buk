import { describe, expect, it } from "vitest";
import type { CashEntry } from "./cash";
import { feeInfoOf, feeMatches, feeReport, isForeignFee, isForeignPayment, linkFees } from "./cash-fees";
import { buildCashReport, withCategories, type ReportEntry } from "./cash-report";

let n = 0;
const KHAN = "5003636128, ХААН банк, MNT";
const entry = (over: Partial<CashEntry>): CashEntry => ({
  id: `e${++n}`,
  accountKey: "acct:test",
  date: "2026-11-17",
  time: "15:00:00",
  type: "outflow",
  account: KHAN,
  counterpart: "Бета ХХК",
  article: "",
  memo: "",
  document: "Банкны зарлага",
  docType: "СписаниеСРасчетногоСчета",
  ref: `r${n}`,
  amount: 1000,
  counterAccount: "3101",
  counterAccountName: "Дансны өглөг",
  ...over,
});
// 17-ны бодит жишээ: 84.07 сая-ын гадаад төлбөр 15:32:49, шимтгэл 15:33:23 ба 15:33:35
const main = (over: Partial<CashEntry> = {}) => entry({ id: "main", time: "15:32:49", counterpart: "MONGOLIA ZHONGZHI TRADE", memo: "154973.3 CNY НИЙТ ҮНЭ 174973,3 CNY", amount: 84_073_015.25, ...over });
const fee = (over: Partial<CashEntry> = {}) => entry({ time: "15:33:23", counterpart: "Удирдлагын зардал", memo: "Гадаад гүйлгээний шимтгэл", article: "Банкны шимтгэл", counterAccount: "7000", counterAccountName: "Удирдлагын зардал", amount: 20_000, ...over });
const rows = (list: CashEntry[]) => withCategories(list, [], true);

describe("linkFees: шимтгэл ба үндсэн төлбөр", () => {
  it("бодит жишээ: 84.07 сая-ын гадаад төлбөр + 20,000 + 27,016.5 шимтгэл = «+ шимтгэл 47.0 мянга (2)»", () => {
    const f1 = fee({ id: "f1", time: "15:33:23", amount: 20_000 });
    const f2 = fee({ id: "f2", time: "15:33:35", amount: 27_016.5 });
    const all = rows([main(), f1, f2]);
    const links = linkFees(all);
    expect(links.mainOf.get("f1")).toBe("main");
    expect(links.mainOf.get("f2")).toBe("main");
    const byId = new Map(all.map((e) => [e.id, e]));
    const info = feeInfoOf(byId.get("main")!, links, byId);
    expect(info.fees).toMatchObject({ count: 2, total: 47_016.5, grandTotal: 84_120_031.75 });
    expect(info.fees!.items.map((i) => i.time)).toEqual(["15:33", "15:33"]);
    expect(feeInfoOf(byId.get("f1")!, links, byId)).toMatchObject({ linkedTo: { id: "main", counterpart: "MONGOLIA ZHONGZHI TRADE" }, foreignFee: true });
  });

  it("ангиллын нийлбэр өөрчлөгдөхгүй: шимтгэл «Банкны шимтгэл»-д хэвээр, нэг ч төгрөг давхар тоологдохгүй", () => {
    const list = [main(), fee({ id: "f1" }), fee({ id: "f2", time: "15:33:35", amount: 27_016.5 })];
    const all = rows(list);
    const cash = { month: "2026-11", asOf: "2026-11-19", totals: { opening: 0, inflow: 0, outflow: 0, internal: 0, closing: 0, expectedClosing: 0, difference: 0, entries: 3 }, accounts: [], daily: [], payroll: { inflow: 0, outflow: 0, byDay: [] }, byCounterpart: [], transfers: [], recent: [], entries: list };
    const without = buildCashReport(cash, all);
    const links = linkFees(all);
    const withFees = buildCashReport(cash, all, feeReport(all, links));
    expect(withFees.outflow).toEqual(without.outflow); // ангилал, нийлбэр, харилцагч бүгд ижил
    expect(withFees.outflow.categories.find((c) => c.id === "bankfee")!.total).toBe(47_016.5);
    expect(withFees.outflow.categories.find((c) => c.id === "suppliers")!.total).toBe(84_073_015.25);
    expect(withFees.outflow.total).toBe(84_120_031.75);
  });

  it("цаг: ±10 минутын дотор; хол бол холбохгүй", () => {
    const near = linkFees(rows([main(), fee({ id: "f", time: "15:42:00" })]));
    expect(near.mainOf.get("f")).toBe("main"); // 9 мин 11 сек
    const far = linkFees(rows([main(), fee({ id: "f", time: "15:43:30" })]));
    expect(far.mainOf.size).toBe(0);
    expect(far.unlinked[0].reason).toBe("none");
  });

  it("шимтгэл түрүүлж бичигдсэн ч (цаг ойрхон бол) холбогдоно", () => {
    expect(linkFees(rows([main(), fee({ id: "f", time: "15:32:30" })])).mainOf.get("f")).toBe("main");
  });

  it("өөр данс, өөр өдөр бол холбохгүй", () => {
    expect(linkFees(rows([main(), fee({ id: "f", account: "5003636139, ХААН банк, MNT" })])).mainOf.size).toBe(0);
    expect(linkFees(rows([main(), fee({ id: "f", date: "2026-11-18" })])).mainOf.size).toBe(0);
  });

  it("үндсэн гүйлгээ нь гадаад биш бол холбохгүй (дотоодын төлбөр, данс хөтөлсний хураамж)", () => {
    const domestic = main({ memo: "Барааны үнэнд", amount: 5_000_000 });
    expect(linkFees(rows([domestic, fee({ id: "f" })])).mainOf.size).toBe(0);
    expect(linkFees(rows([main(), fee({ id: "g", memo: "данс хөтөлсний хураамж", time: "16:29:22" })])).mainOf.size).toBe(0); // 57 мин
  });

  it("валютын данс дээрх төлбөр гадаад (утгад валют байхгүй ч)", () => {
    const usd = main({ account: "8115100314, Голомт банк, USD", memo: "Бараа" });
    const f = fee({ id: "f", account: "8115100314, Голомт банк, USD" });
    expect(isForeignPayment(rows([usd])[0])).toBe(true);
    expect(linkFees(rows([usd, f])).mainOf.get("f")).toBe("main");
  });

  it("ханшийн зөрүү төлбөр биш: 5xxx, 7xxx дансны гүйлгээ үндсэн болохгүй", () => {
    const fx = main({ id: "fx", counterAccount: "5320", counterAccountName: "Гадаад валютын ханшийн зөрүүний гарз", memo: "CNY ханшийн зөрүү", amount: 3_247 });
    expect(linkFees(rows([fx, fee({ id: "f" })])).mainOf.size).toBe(0);
  });

  it("буруу холбохоос холбохгүй нь дээр: хоёр боломжит төлбөр байвал аль нь вэ гэдэг тодорхойгүй", () => {
    const a = main({ id: "a", time: "15:30:00" });
    const b = main({ id: "b", time: "15:32:00", amount: 906_030_720 });
    const links = linkFees(rows([a, b, fee({ id: "f", time: "15:33:00" })]));
    expect(links.mainOf.size).toBe(0);
    expect(links.unlinked[0].reason).toBe("ambiguous");
    // харин нэг нь 10 минутаас хол бол үлдсэн нэг нь холбогдоно
    const c = main({ id: "c", time: "15:10:00" });
    expect(linkFees(rows([c, b, fee({ id: "f", time: "15:33:00" })])).mainOf.get("f")).toBe("b");
  });

  it("цаггүй мөр (цалингийн нэгтгэсэн) холбогдохгүй", () => {
    const all = withCategories([main(), fee({ id: "f", time: undefined })], [], true);
    expect(linkFees(all).unlinked[0].reason).toBe("no-time");
  });
});

describe("feeReport: гадаад гүйлгээний шимтгэл, холбогдсон / холбогдоогүй", () => {
  const list = [
    main(),
    fee({ id: "f1" }),
    fee({ id: "f2", time: "15:33:35", amount: 27_016.5 }),
    fee({ id: "f3", date: "2026-11-19", time: "16:32:38", amount: 144_218.4 }), // холбогдоогүй, гадаад
    fee({ id: "f4", memo: "данс хөтөлсний хураамж", time: "16:29:22", amount: 800 }), // дотоод, холбогдоогүй
  ];
  const all = rows(list);
  const links = linkFees(all);
  const rep = feeReport(all, links);

  it("нийт = ангиллын нийлбэр; гадаад; холбогдсон; холбогдоогүй", () => {
    expect(rep.total).toEqual({ count: 4, total: 192_034.9 });
    expect(rep.foreign).toEqual({ count: 3, total: 191_234.9 });
    expect(rep.linked).toEqual({ count: 2, total: 47_016.5 });
    expect(rep.unlinked).toEqual({ count: 2, total: 145_018.4 });
    expect(rep.linked.total + rep.unlinked.total).toBe(rep.total.total);
    expect(rep.byMain).toEqual([{ id: "main", date: "2026-11-17", counterpart: "MONGOLIA ZHONGZHI TRADE", amount: 84_073_015.25, fee: 47_016.5, count: 2 }]);
  });

  it("шүүлт: холбогдсон / холбогдоогүй / гадаад", () => {
    const byId = new Map<string, ReportEntry>(all.map((e) => [e.id, e]));
    const ids = (k: "linked" | "unlinked" | "foreign") => all.filter((e) => feeMatches(k, e, links, byId)).map((e) => e.id).sort();
    expect(ids("linked")).toEqual(["f1", "f2"]);
    expect(ids("unlinked")).toEqual(["f3", "f4"]);
    expect(ids("foreign")).toEqual(["f1", "f2", "f3"]);
    expect(isForeignFee({ memo: "данс хөтөлсний хураамж" })).toBe(false);
  });
});
