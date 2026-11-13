import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCash, fetchCash, type CashInputs } from "./cash";
import { resetNameCache } from "./odata-read";

const MONTH = "2026-09";
const A1 = "a1a1a1a1-0000-0000-0000-000000000001"; // 1101 банкны данс
const A2 = "a2a2a2a2-0000-0000-0000-000000000002"; // 1102 валютын данс
const OTHER = "a3a3a3a3-0000-0000-0000-000000000003"; // 3101 өглөг
const REC = "a4a4a4a4-0000-0000-0000-000000000004"; // 1501 авлага
const K1 = "a5a5a5a5-0000-0000-0000-000000000005"; // 1001 касс
const B1 = "b1b1b1b1-0000-0000-0000-000000000001";
const B2 = "b2b2b2b2-0000-0000-0000-000000000002";
const P1 = "c1c1c1c1-0000-0000-0000-00000000000a";
const P2 = "c2c2c2c2-0000-0000-0000-00000000000b";
const F1 = "f1f1f1f1-0000-0000-0000-000000000001";
const T = "StandardODATA.Catalog_";

// Бичилт: нэг талд мөнгөний данс (банкны данс + зүйл), нөгөө талд харьцсан данс (харилцагч)
const entry = (id: string, date: string, dr: [string, ...string[]], cr: [string, ...string[]], amount: number, extra: Record<string, unknown> = {}) => {
  const side = (p: "Dr" | "Cr", [acct, ...dims]: string[]) => ({
    [`Account${p}_Key`]: acct,
    [`ExtDimension${p}1`]: dims[0] ?? "00000000-0000-0000-0000-000000000000",
    [`ExtDimension${p}1_Type`]: dims[0] ? (dims[0] === P1 || dims[0] === P2 ? `${T}Контрагенты` : `${T}БанковскиеСчета`) : "StandardODATA.Undefined",
    [`ExtDimension${p}2`]: dims[1] ?? "00000000-0000-0000-0000-000000000000",
    [`ExtDimension${p}2_Type`]: dims[1] ? `${T}СтатьиДвиженияДенежныхСредств` : "StandardODATA.Undefined",
  });
  return { Recorder: id, LineNumber: "1", Period: `${date}T23:59:59`, Recorder_Type: "StandardODATA.Document_ПоступлениеНаРасчетныйСчет", Сумма: amount, Содержание: "тест", ...side("Dr", dr), ...side("Cr", cr), ...extra };
};
const bal = (acct: string, bank: string | null, amount: number) => ({ Account_Key: acct, ExtDimension1: bank ?? "00000000-0000-0000-0000-000000000000", ExtDimension1_Type: bank ? `${T}БанковскиеСчета` : "StandardODATA.Undefined", СуммаBalance: amount });

const inputs = (over: Partial<CashInputs> = {}): CashInputs => ({
  month: MONTH,
  asOf: "2026-09-30",
  accounts: new Map([[A1, { code: "1101.00", name: "Банкин дах мөнгө - MNT" }], [A2, { code: "1102.00", name: "Банкин дах мөнгө - валют" }]]),
  records: [
    entry("d1", "2026-09-05", [A1, B1, F1], [REC, P1], 1000), // орлого
    entry("d2", "2026-09-07", [OTHER, P2], [A1, B1, F1], 300), // зарлага
    entry("d3", "2026-09-07", [A2, B2], [A1, B1], 200), // дотоод шилжүүлэг (хоёулаа мөнгөний данс)
  ],
  opening: [bal(A1, B1, 500), bal(A2, B2, 100)],
  closing: [bal(A1, B1, 1000), bal(A2, B2, 300)],
  names: {
    banks: new Map([[B1, "Хаан банк MNT"], [B2, "Хаан банк USD"]]),
    flows: new Map([[F1, "Борлуулалтын орлого"]]),
    parties: new Map([[P1, "Альфа ХХК"], [P2, "Бета ХХК"]]),
    chart: new Map([[A1, { code: "1101.00", name: "Банкин дах мөнгө - MNT" }], [A2, { code: "1102.00", name: "Банкин дах мөнгө - валют" }], [OTHER, { code: "3101.00", name: "Өглөг" }], [REC, { code: "1501.00", name: "Авлага" }]]),
  },
  ...over,
});

describe("buildCash: орлого, зарлага, дотоод шилжүүлэг", () => {
  const r = buildCash(inputs());

  it("Дт мөнгөний данс = орлого; Кт мөнгөний данс = зарлага; хоёулаа мөнгөний данс = дотоод шилжүүлэг (орлого, зарлагад тооцогдохгүй)", () => {
    expect(r.totals).toMatchObject({ inflow: 1000, outflow: 300, internal: 200, entries: 3 });
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0]).toMatchObject({ type: "internal", account: "Хаан банк MNT", counterpart: "Хаан банк USD", amount: 200 });
    expect(r.recent.map((e) => e.type)).toEqual(["outflow", "inflow"]); // шилжүүлэг энд орохгүй
  });

  it("эхний + орлого − зарлага = эцсийн үлдэгдэл (шилжүүлэг нийтдээ 0), зөрүү 0", () => {
    expect(r.totals).toMatchObject({ opening: 600, closing: 1300, expectedClosing: 1300, difference: 0 });
  });

  it("банкны данс тус бүрээр (эхний, орлого, зарлага, шилжүүлэг, эцсийн), данс бүрт зөрүү 0", () => {
    const by = Object.fromEntries(r.accounts.map((a) => [a.name, a]));
    expect(by["Хаан банк MNT"]).toMatchObject({ code: "1101", opening: 500, inflow: 1000, outflow: 300, transfersIn: 0, transfersOut: 200, closing: 1000, difference: 0 });
    expect(by["Хаан банк USD"]).toMatchObject({ code: "1102", opening: 100, inflow: 0, outflow: 0, transfersIn: 200, transfersOut: 0, closing: 300, difference: 0 });
  });

  it("өдөр бүрээр (сарын бүх өдөр), харьцсан харилцагчаар, зүйлээр", () => {
    expect(r.daily).toHaveLength(30);
    expect(r.daily.find((d) => d.date === "2026-09-05")).toEqual({ date: "2026-09-05", inflow: 1000, outflow: 0 });
    expect(r.daily.find((d) => d.date === "2026-09-07")).toEqual({ date: "2026-09-07", inflow: 0, outflow: 300 });
    expect(r.byCounterpart.map((c) => [c.name, c.account, c.inflow, c.outflow])).toEqual([["Альфа ХХК", "1501", 1000, 0], ["Бета ХХК", "3101", 0, 300]]);
    expect(r.recent.find((e) => e.type === "inflow")).toMatchObject({ article: "Борлуулалтын орлого", counterpart: "Альфа ХХК", document: "Банкны орлого", account: "Хаан банк MNT" });
  });

  it("техникийн нэр (Catalog_, _Key, StandardODATA) гарахгүй", () => {
    expect(JSON.stringify(r)).not.toMatch(/Catalog_|_Key|StandardODATA/);
  });

  it("үлдэгдэл таарахгүй бол зөрүүг харуулна (хаасан, нуугаагүй)", () => {
    const x = buildCash(inputs({ closing: [bal(A1, B1, 1000), bal(A2, B2, 310.5)] }));
    expect(x.totals.difference).toBe(10.5);
    expect(x.accounts.find((a) => a.name === "Хаан банк USD")?.difference).toBe(10.5);
  });

  it("банкны данс заагаагүй бичилт дансны кодоор бүлэглэгдэнэ; харьцсан харилцагч байхгүй бол харьцсан данс", () => {
    const x = buildCash(inputs({ records: [entry("d9", "2026-09-10", [A1], [REC], 50)], opening: [], closing: [bal(A1, null, 50)] }));
    expect(x.accounts).toHaveLength(1);
    expect(x.accounts[0]).toMatchObject({ key: "acct:1101", name: "Банкин дах мөнгө - MNT", inflow: 50, closing: 50 });
    expect(x.byCounterpart[0]).toMatchObject({ name: "Авлага", account: "1501" });
  });

  it("мөнгөний бус бичилт, 0 үлдэгдэл данс орохгүй; хоосон сар", () => {
    const x = buildCash(inputs({ records: [entry("d8", "2026-09-10", [OTHER], [REC], 999)], opening: [bal(A1, B1, 0)], closing: [] }));
    expect(x.totals).toMatchObject({ inflow: 0, outflow: 0, internal: 0, entries: 0, opening: 0, closing: 0 });
    expect(x.accounts).toEqual([]);
  });
});

describe("fetchCash (fetch дуурайлгасан; 1С руу зөвхөн GET)", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ENV = { ONEC_ODATA_BASE_URL: "http://1c.test/b/odata/standard.odata", ONEC_ODATA_USER: "svc_user", ONEC_ODATA_PASSWORD: "pw-secret" };

  beforeEach(() => {
    resetNameCache();
    calls.length = 0;
    Object.assign(process.env, ENV);
    const json = (value: unknown[]) => new Response(JSON.stringify({ value }), { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const u = decodeURIComponent(url);
        if (u.includes("startswith(Code,'10')")) return json([{ Ref_Key: K1, Code: "1001.00", Description: "Касс дахь бэлэн мөнгө - MNT" }]);
        if (u.includes("startswith(Code,'11')")) return json([{ Ref_Key: A1, Code: "1101.00", Description: "Банкин дах мөнгө - MNT" }, { Ref_Key: A2, Code: "1102.00", Description: "Банкин дах мөнгө - валют" }]);
        if (u.includes("ChartOfAccounts_")) return json([{ Ref_Key: REC, Code: "1501.00", Description: "Авлага" }, { Ref_Key: OTHER, Code: "3101.00", Description: "Өглөг" }]);
        if (u.includes("/Balance(")) return json(u.includes("Period=datetime'2026-09-01T00:00:00'") ? inputs().opening : inputs().closing);
        if (u.includes("RecordsWithExtDimensions")) return json(inputs().records);
        if (u.includes("Catalog_БанковскиеСчета")) return json([{ Ref_Key: B1, Description: "Хаан банк MNT", НомерСчета: "5003" }, { Ref_Key: B2, Description: "", НомерСчета: "5004" }]);
        if (u.includes("Catalog_Контрагенты")) return json([{ Ref_Key: P1, Description: "Альфа ХХК" }, { Ref_Key: P2, Description: "Бета ХХК" }]);
        if (u.includes("Catalog_СтатьиДвиженияДенежныхСредств")) return json([{ Ref_Key: F1, Description: "Борлуулалтын орлого" }]);
        return json([]);
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  it("10xx (касс), 11xx дансыг серверийн шүүлтээр; бичилт: сарын эхнээс (00:00:00) сарын эцэс (23:59:59) хүртэл; эхний үлдэгдэл сарын 1-ний 00:00:00, эцсийн нь дараа өдрийн 00:00:00 (23:59:59-ийн бичилтийг оруулна)", async () => {
    const r = await fetchCash(MONTH);
    for (const c of calls) {
      expect(c.init.method).toBe("GET");
      expect(c.init.body).toBeUndefined();
      expect(c.url).not.toContain("pw-secret");
    }
    const urls = calls.map((c) => decodeURIComponent(c.url));
    expect(urls.some((u) => u.includes("ChartOfAccounts_") && u.includes("startswith(Code,'11')"))).toBe(true);
    expect(urls.some((u) => u.includes("ChartOfAccounts_") && u.includes("startswith(Code,'10')"))).toBe(true); // касс
    const rec = urls.find((u) => u.includes("RecordsWithExtDimensions"))!;
    expect(rec).toContain("StartPeriod=datetime'2026-09-01T00:00:00'");
    expect(rec).toContain("EndPeriod=datetime'2026-09-30T23:59:59'");
    expect(rec).toContain(`AccountDr_Key eq guid'${A1}'`);
    expect(rec).toContain(`AccountCr_Key eq guid'${A2}'`);
    expect(rec).toContain(`AccountDr_Key eq guid'${K1}'`);
    const balances = urls.filter((u) => u.includes("/Balance("));
    expect(balances).toHaveLength(2);
    expect(balances.some((u) => u.includes("Period=datetime'2026-09-01T00:00:00'"))).toBe(true);
    expect(balances.some((u) => u.includes("Period=datetime'2026-10-01T00:00:00'"))).toBe(true); // өнгөрсөн сар: сарын эцэс 09-30 -> 10-01 00:00:00
    expect(r.asOf).toBe("2026-09-30");
    expect(r.totals).toMatchObject({ opening: 600, inflow: 1000, outflow: 300, internal: 200, closing: 1300, difference: 0 });
    expect(r.accounts.map((a) => a.name).sort()).toEqual(["Хаан банк MNT", "5004"].sort()); // нэргүй банкны данс -> дансны дугаар
  });

  it("мөнгөний данс 1С-ээс олдохгүй бол ойлгомжтой алдаа (URL, нэр, нууц үггүй)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ value: [] }), { status: 200 })));
    const err = await fetchCash(MONTH).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).not.toMatch(/1c\.test|pw-secret|svc_user/);
  });
});

describe("касс (10xx) ба банк (11xx) хоорондын шилжүүлэг", () => {
  const KASS = "a5a5a5a5-0000-0000-0000-000000000005";
  const accounts = new Map([[A1, { code: "1101.00", name: "Банкин дах мөнгө - MNT" }], [KASS, { code: "1001.00", name: "Касс дахь бэлэн мөнгө - MNT" }]]);
  const base = inputs({ accounts, records: [entry("k1", "2026-09-08", [A1, B1], [KASS], 400), entry("k2", "2026-09-09", [OTHER, P2], [KASS], 150)], opening: [bal(A1, B1, 0), bal(KASS, null, 1000)], closing: [bal(A1, B1, 400), bal(KASS, null, 450)] });
  const r = buildCash(base);

  it("касс → банк нь орлого, зарлага биш дотоод шилжүүлэг; кассаас гарсан бусад нь зарлага", () => {
    expect(r.totals).toMatchObject({ inflow: 0, outflow: 150, internal: 400, opening: 1000, closing: 850, difference: 0 });
    expect(r.transfers[0]).toMatchObject({ account: "Касс дахь бэлэн мөнгө - MNT", counterpart: "Хаан банк MNT", amount: 400 });
    expect(r.accounts.find((a) => a.code === "1001")).toMatchObject({ key: "acct:1001", opening: 1000, outflow: 150, transfersOut: 400, closing: 450, difference: 0 });
  });
});
