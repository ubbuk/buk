import { describe, expect, it } from "vitest";
import { buildCash, parseBankAccountName } from "./cash";
import { fixtureInputs, K } from "./cash-accounts.fixture";
import type { CashResult } from "./cash";
import { accountDescription, accountNames, accountPeriod, accountShortName, accountTitles, buildAccountCards, findAccount, last4, maskAccountName, maskCashForViewer, publicId, transferEntriesFor, type AccountSetting } from "./cash-accounts";
import { filterEntries, withCategories } from "./cash-report";

const cash: CashResult = buildCash(fixtureInputs());

describe("parseBankAccountName", () => {
  it("«<дугаар>, <банк>, <валют>» -> дугаар, банк, валют", () => {
    expect(parseBankAccountName("5003636128, ХААН банк, MNT")).toEqual({ number: "5003636128", bank: "ХААН банк", currency: "MNT" });
    expect(parseBankAccountName("8115100314, Голомт банк, USD")).toEqual({ number: "8115100314", bank: "Голомт банк", currency: "USD" });
    expect(parseBankAccountName("100030003026, Капитрон банк, RUB").currency).toBe("RUB");
  });
  it("хэлбэр өөр бол боломжит хэсэг; валютгүй бол MNT", () => {
    expect(parseBankAccountName("5003636128, ХААН банк")).toEqual({ number: "5003636128", bank: "ХААН банк", currency: "MNT" });
    expect(parseBankAccountName(", , CNY")).toEqual({ number: "", bank: "", currency: "CNY" });
    expect(parseBankAccountName("Хаан банк MNT")).toEqual({ number: "", bank: "Хаан банк MNT", currency: "MNT" });
  });
});

describe("buildCash: дансны мэдээлэл, валют", () => {
  const by = Object.fromEntries(cash.accounts.map((a) => [a.key, a]));
  it("банк, дугаар, валют, төрөл", () => {
    expect(by[K.main]).toMatchObject({ kind: "bank", bank: "ХААН банк", number: "5003636128", currency: "MNT", fx: null });
    expect(by[K.usd]).toMatchObject({ kind: "bank", currency: "USD" });
    expect(by[K.cash]).toMatchObject({ kind: "cash", number: "", bank: "" });
  });
  it("орсон/гарсан/шилжүүлэг, эцсийн үлдэгдэл тулгагдана (зөрүү 0), валютаар ч", () => {
    expect(by[K.main]).toMatchObject({ opening: 500, inflow: 1000, outflow: 300, transfersIn: 0, transfersOut: 200, closing: 1000, difference: 0 });
    expect(by[K.usd]).toMatchObject({ opening: 100, inflow: 400, outflow: 0, transfersIn: 200, transfersOut: 100, closing: 600, difference: 0 });
    expect(by[K.usd].fx).toEqual({ opening: 25, inflow: 100, outflow: 0, transfersIn: 50, transfersOut: 25, closing: 150 }); // 25 + 100 + 50 - 25 = 150
  });
  it("бичилт бүр дансны түлхүүртэй; шилжүүлэг хоёр талын түлхүүртэй, валютын дүнтэй", () => {
    expect(cash.entries.every((e) => e.accountKey.startsWith("bank:"))).toBe(true);
    const t = cash.transfers.find((x) => x.id.startsWith("d3"))!;
    expect(t).toMatchObject({ accountKey: K.main, counterKey: K.usd, counterFxAmount: 50 });
    expect(t.fxAmount).toBeUndefined();
    expect(cash.transfers.find((x) => x.id.startsWith("d5"))).toMatchObject({ accountKey: K.usd, counterKey: K.cash, fxAmount: 25 });
  });
  it("шилжүүлэг нийт орлого, зарлагад орохгүй (өмнөх үр дүн өөрчлөгдөөгүй)", () => {
    expect(cash.totals).toMatchObject({ inflow: 1400, outflow: 300, internal: 300, difference: 0 });
  });
});

describe("нэр: админы нэр эсвэл банк + сүүлийн 4 орон", () => {
  const main = findAccount(cash, publicId(K.main))!;
  const usd = findAccount(cash, publicId(K.usd))!;
  it("last4, тайлбар", () => {
    expect(last4("5003636128")).toBe("6128");
    expect(accountDescription(main)).toBe("ХААН банк ··6128 · MNT");
    expect(accountDescription(usd)).toBe("ХААН банк ··6139 · USD");
    expect(accountDescription(findAccount(cash, publicId(K.cash))!)).toBe("Касс · MNT");
  });
  it("админы нэр байвал том гарчиг, тайлбар доор; үгүй бол тайлбар нь гарчиг", () => {
    expect(accountTitles(main)).toEqual({ title: "ХААН банк ··6128 · MNT", subtitle: null });
    expect(accountTitles(main, { key: K.main, name: "Үндсэн данс", hidden: false, sortOrder: null })).toEqual({ title: "Үндсэн данс", subtitle: "ХААН банк ··6128 · MNT" });
    expect(accountTitles(main, { key: K.main, name: "   ", hidden: false, sortOrder: null }).subtitle).toBeNull();
  });
  it("шилжүүлгийн нэр: «Үндсэн данс», «Валютын данс (USD)»; нэргүй бол «ХААН банк ··6139 (USD)»", () => {
    const s = new Map<string, AccountSetting>([[K.main, { key: K.main, name: "Үндсэн данс", hidden: false, sortOrder: null }], [K.usd, { key: K.usd, name: "Валютын данс", hidden: false, sortOrder: null }]]);
    expect(accountShortName(main, s.get(K.main))).toBe("Үндсэн данс");
    expect(accountShortName(usd, s.get(K.usd))).toBe("Валютын данс (USD)");
    expect(accountShortName(usd)).toBe("ХААН банк ··6139 (USD)");
    expect(accountNames(cash, s)(K.usd)).toBe("Валютын данс (USD)");
    expect(accountNames(cash, s)("bank:unknown")).toBe("Бусад данс");
  });
  it("нийтийн ID нь тогтвортой, дансны код/дугаар агуулахгүй", () => {
    expect(publicId(K.cash)).toBe(publicId(K.cash));
    expect(publicId(K.cash)).toMatch(/^[0-9a-f]{12}$/);
    expect(publicId(K.cash)).not.toContain("1001");
    expect(new Set(cash.accounts.map((a) => publicId(a.key))).size).toBe(cash.accounts.length);
  });
});

describe("buildAccountCards", () => {
  const settings = new Map<string, AccountSetting>([
    [K.hidden, { key: K.hidden, name: "", hidden: true, sortOrder: null }],
    [K.main, { key: K.main, name: "Үндсэн данс", hidden: false, sortOrder: null }],
  ]);
  const cards = buildAccountCards(cash, settings, { today: "2026-09-07", isAdmin: false });
  it("нуусан данс картад гарахгүй, гэхдээ нийт үлдэгдэлд орно (табын эцсийн үлдэгдэлтэй тэнцүү)", () => {
    expect(cards.accounts.map((c) => c.title)).not.toContain("Капитрон банк ··2132 · MNT");
    expect(cards.accounts).toHaveLength(3);
    expect(cards.hiddenCount).toBe(1);
    expect(cards.total).toBe(cash.totals.closing);
    expect(cards.total).toBe(1000 + 600 + 150 + 7);
  });
  it("үлдэгдэл ихээр эрэмбэлнэ", () => {
    expect(cards.accounts.map((c) => c.closing)).toEqual([1000, 600, 150]);
  });
  it("админы дараалал (бага нь эхэнд) үлдэгдлээс давамгайлна", () => {
    const ordered = buildAccountCards(cash, new Map([[K.cash, { key: K.cash, name: "", hidden: false, sortOrder: 1 }], [K.usd, { key: K.usd, name: "", hidden: false, sortOrder: 2 }]]), { today: "2026-09-07", isAdmin: false });
    expect(ordered.accounts.slice(0, 2).map((c) => c.closing)).toEqual([150, 600]);
  });
  it("өнөөдрийн орсон/гарсан: шилжүүлэг орсон/гарсанд багтана", () => {
    const main = cards.accounts.find((c) => c.title === "Үндсэн данс")!;
    expect(main.today).toEqual({ inflow: 0, outflow: 300 + 200 }); // 09-07: зарлага 300 + валютын данс руу шилжүүлсэн 200
    const usd = cards.accounts.find((c) => c.currency === "USD")!;
    expect(usd.today).toEqual({ inflow: 200, outflow: 0 });
  });
  it("валютын данс: ₮ ба валютаар; ₮ данс: валютгүй", () => {
    const usd = cards.accounts.find((c) => c.currency === "USD")!;
    expect(usd).toMatchObject({ closing: 600, closingFx: 150 });
    expect(cards.accounts.find((c) => c.title === "Үндсэн данс")!.closingFx).toBeNull();
  });
  it("дансны бүтэн дугаар зөвхөн ADMIN-д; бусдад сүүлийн 4 орон; код, «1С» хариунд байхгүй", () => {
    expect(cards.accounts.every((c) => c.number === undefined)).toBe(true);
    expect(JSON.stringify(cards)).not.toContain("5003636128");
    const admin = buildAccountCards(cash, settings, { today: "2026-09-07", isAdmin: true });
    expect(admin.accounts.find((c) => c.title === "Үндсэн данс")!.number).toBe("5003636128");
    const text = JSON.stringify(cards);
    for (const w of ["1С", "1C", "Комментарий", '"code"', "1101", "1102", "1001", "acct:", "bank:"]) expect(text, w).not.toContain(w);
    expect(cards.accounts.find((c) => c.title === "Үндсэн данс")!.last4).toBe("6128");
  });
});

describe("accountPeriod: эхний + орсон − гарсан = эцсийн", () => {
  it("бүтэн сар: сарын эхний/эцсийн үлдэгдэл, шилжүүлэг орсон/гарсанд багтана", () => {
    expect(accountPeriod(cash, K.main, "2026-09-01", "2026-09-30")).toMatchObject({ opening: 500, inflow: 1000, outflow: 500, transfersIn: 0, transfersOut: 200, closing: 1000, fx: null });
    expect(accountPeriod(cash, K.usd, "2026-09-01", "2026-09-30")).toMatchObject({ opening: 100, inflow: 600, outflow: 100, closing: 600, fx: { opening: 25, inflow: 150, outflow: 25, closing: 150 } });
  });
  it("нэг өдөр: эхний үлдэгдэл = өмнөх өдрүүдийн хөдөлгөөнөөр урагшилсан", () => {
    const d = accountPeriod(cash, K.main, "2026-09-07", "2026-09-07")!;
    expect(d).toMatchObject({ opening: 1500, inflow: 0, outflow: 500, closing: 1000 }); // 500 + 1000 (09-05) = 1500; 09-07: -300 -200
    const before = accountPeriod(cash, K.main, "2026-09-05", "2026-09-05")!;
    expect(before).toMatchObject({ opening: 500, inflow: 1000, outflow: 0, closing: 1500 });
  });
  it("өдрүүдийн эцсийн үлдэгдэл дараагийн өдрийн эхний үлдэгдэлтэй таарна; өдөр бүрийн нийлбэр = сар", () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    let prev = 500;
    let inflow = 0;
    let outflow = 0;
    for (const d of days) {
      const p = accountPeriod(cash, K.main, d, d)!;
      expect(p.opening).toBe(prev);
      prev = p.closing;
      inflow += p.inflow;
      outflow += p.outflow;
    }
    expect(prev).toBe(1000);
    expect([inflow, outflow]).toEqual([1000, 500]);
  });
  it("валютын данс нэг өдөр: валютаар ч тулгагдана", () => {
    const p = accountPeriod(cash, K.usd, "2026-09-25", "2026-09-25")!;
    expect(p).toMatchObject({ opening: 700, inflow: 0, outflow: 100, closing: 600, fx: { opening: 175, outflow: 25, closing: 150 } });
  });
  it("данс олдохгүй бол null", () => {
    expect(accountPeriod(cash, "bank:nope", "2026-09-01", "2026-09-30")).toBeNull();
  });
});

describe("шилжүүлэг дансны хуудсанд", () => {
  const names = accountNames(cash, new Map([[K.main, { key: K.main, name: "Үндсэн данс", hidden: false, sortOrder: null }], [K.usd, { key: K.usd, name: "Валютын данс", hidden: false, sortOrder: null }]]));
  it("тухайн дансны талаас: гарсан/орсон, «→/←» нөгөө дансны нэр, шилжүүлэг гэж тэмдэглэгдэнэ", () => {
    const main = transferEntriesFor(cash, K.main, names);
    expect(main).toHaveLength(1);
    expect(main[0]).toMatchObject({ type: "outflow", amount: 200, counterpart: "→ Валютын данс (USD)", account: "Үндсэн данс", transfer: true, accountKey: K.main });
    const usd = transferEntriesFor(cash, K.usd, names);
    expect(usd.map((t) => [t.type, t.amount, t.counterpart])).toEqual([
      ["outflow", 100, "→ Касс · MNT"], // 09-25 (шинэ нь эхэнд)
      ["inflow", 200, "← Үндсэн данс"], // 09-07
    ]);
    expect(usd.find((t) => t.type === "inflow")!.fxAmount).toBe(50);
    expect(usd.find((t) => t.type === "outflow")!.fxAmount).toBe(25);
  });
  it("«Бүх гүйлгээ»-ний шүүлт: accountKey ба хугацаа; энгийн шүүлтүүд хэвээр", () => {
    const base = withCategories(cash.entries, [], true);
    const all = [...base, ...transferEntriesFor(cash, K.usd, names).map((t) => ({ ...t, category: "internal" as const }))];
    expect(filterEntries(all, { accountKey: K.usd })).toHaveLength(3);
    expect(filterEntries(all, { accountKey: K.usd, from: "2026-09-20", to: "2026-09-25" })).toHaveLength(2);
    expect(filterEntries(all, { accountKey: K.usd, flow: "outflow" })).toHaveLength(1);
    expect(filterEntries(all, { accountKey: K.main })).toHaveLength(2); // орлого, зарлага (шилжүүлэг энд орохгүй: all-д зөвхөн USD-ийнх)
  });
});

describe("дансны бүтэн дугаар ADMIN-аас бусдад далдлагдана", () => {
  it("maskAccountName", () => {
    expect(maskAccountName("5003636128, ХААН банк, MNT")).toBe("ХААН банк ··6128 · MNT");
    expect(maskAccountName("Касс дахь бэлэн мөнгө - MNT")).toBe("Касс дахь бэлэн мөнгө - MNT");
  });
  it("maskCashForViewer: нэр, шилжүүлэг, дугаар; тоо хэвээр. ADMIN-д хэвээр", () => {
    const masked = maskCashForViewer(cash, false);
    const json = JSON.stringify(masked);
    expect(json).not.toContain("5003636128");
    expect(json).not.toContain("3096022132");
    expect(masked.accounts.find((a) => a.key === K.main)).toMatchObject({ number: "6128", closing: 1000 });
    expect(masked.totals).toEqual(cash.totals);
    expect(masked.transfers[0].account).toContain("··");
    expect(JSON.stringify(maskCashForViewer(cash, true))).toContain("5003636128");
  });
});
