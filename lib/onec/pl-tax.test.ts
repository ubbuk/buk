import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlTaxRows, fetchPlTaxRows, odataConfigured } from "./pl-tax";
import { buildWip } from "./wip";
import { expenseGroupLabel } from "./expense-groups";

const T1 = "a1a1a1a1-0000-0000-0000-000000000001"; // 9102
const T2 = "a2a2a2a2-0000-0000-0000-000000000002"; // 9101 (хаалтаар Дт = Кт)
const accounts = new Map([[T1, { code: "9102.00", name: "Хүүгийн орлогын албан татвар" }], [T2, { code: "9101.00", name: "Нийтлэг хувь хэмжээгээр тогтоосон татвар" }]]);
const turn = (acc: string, dr: number, cr: number) => ({ Account_Key: acc, СуммаTurnoverDr: dr, СуммаTurnoverCr: cr });

describe("buildPlTaxRows: 8xxx-9xxx дансны зардал = Дт − Кт", () => {
  it("данс бүрээр нэг мөр, бүлэг «tax», тал «expense»; Дт = Кт (хаалт) данс 0 тул орохгүй", () => {
    const rows = buildPlTaxRows("2026-10", accounts, [turn(T1, 5388967.93, 0), turn(T2, 567942472.08, 567942472.08)]);
    expect(rows).toEqual([{ month: "2026-10", item_code: "", item: "Хүүгийн орлогын албан татвар", account: "9102.00", group: "tax", side: "expense", amount: 5388967.93 }]);
  });
  it("нэг дансны олон мөрийг нэгтгэнэ; мэдэгдэхгүй данс алгасна; сөрөг (буцаалт) зардал хэвээр", () => {
    const rows = buildPlTaxRows("2026-10", accounts, [turn(T1, 100, 0), turn(T1, 50, 10), turn("ffffffff-0000-0000-0000-000000000000", 999, 0), turn(T2, 0, 25)]);
    expect(rows.map((r) => [r.account, r.amount])).toEqual([["9101.00", -25], ["9102.00", 140]]);
  });
  it("«tax» бүлэг дэлгэцэд «Татвар»; техникийн код гарахгүй", () => {
    expect(expenseGroupLabel("tax")).toBe("Татвар");
  });
  it("OData тохируулсан эсэх", () => {
    expect(odataConfigured({})).toBe(false);
    expect(odataConfigured({ ONEC_ODATA_BASE_URL: "http://x/odata/standard.odata", ONEC_ODATA_USER: "u", ONEC_ODATA_PASSWORD: "p" })).toBe(true);
  });
});

describe("fetchPlTaxRows (fetch дуурайлгасан; GET)", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ENV = { ONEC_ODATA_BASE_URL: "http://1c.test/b/odata/standard.odata", ONEC_ODATA_USER: "u", ONEC_ODATA_PASSWORD: "pw-secret" };
  beforeEach(() => {
    calls.length = 0;
    Object.assign(process.env, ENV);
    const json = (value: unknown[]) => new Response(JSON.stringify({ value }), { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const u = decodeURIComponent(url);
        if (u.includes("startswith(Code,'9')")) return json([{ Ref_Key: T1, Code: "9102.00", Description: "Хүүгийн орлогын албан татвар" }, { Ref_Key: "c9c9c9c9-0000-0000-0000-000000000009", Code: "9200.00", Description: "Орлого зарлагын нэгдсэн данс" }]);
        if (u.includes("startswith(Code,'8')")) return json([]);
        if (u.includes("/Turnovers(")) return json([turn(T1, 5388967.93, 0)]);
        return json([]);
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  it("8, 9 угтвараар (9200 хаалтын данс оролгүй) Turnovers-ийг сарын хүрээгээр, зөвхөн GET-ээр асууна", async () => {
    const rows = await fetchPlTaxRows("2026-10", "2026-10-01", "2026-10-31");
    expect(rows.map((r) => [r.account, r.amount])).toEqual([["9102.00", 5388967.93]]);
    const turnUrl = decodeURIComponent(calls.find((c) => c.url.includes("Turnovers"))!.url);
    expect(turnUrl).toContain("StartPeriod=datetime'2026-10-01T00:00:00'");
    expect(turnUrl).toContain("EndPeriod=datetime'2026-10-31T23:59:59'");
    expect(turnUrl).toContain(`Account_Key eq guid'${T1}'`);
    expect(turnUrl).not.toContain("c9c9c9c9"); // 9200 орохгүй
    for (const c of calls) {
      expect(c.init.method).toBe("GET");
      expect(c.url).not.toContain("pw-secret");
    }
  });
});

describe("buildWip: Дуусаагүй үйлдвэрлэл (142x)", () => {
  const w = new Map([["a1", { code: "1421.00", name: "Үндсэн Үйлдвэрлэл" }], ["a2", { code: "1423.00", name: "Туслах үйлдвэрлэл" }], ["a3", { code: "1424", name: "Нийт үйлдвэрлэлийн зардал" }]]);
  it("данс бүрийн үлдэгдэл, нийт (сөрөг үлдэгдэлтэй, 0 дансыг алгасч)", () => {
    const r = buildWip("2026-10-31", w, [
      { Account_Key: "a1", СуммаBalance: -275576382.65 },
      { Account_Key: "A2", СуммаBalance: 375460895.83 },
      { Account_Key: "a3", СуммаBalance: 302179683.76 },
      { Account_Key: "a3", СуммаBalance: 0 },
      { Account_Key: "zz", СуммаBalance: 1 },
    ]);
    expect(r.total).toBe(402064196.94);
    expect(r.accounts.map((a) => [a.code, a.balance])).toEqual([["1421.00", -275576382.65], ["1423.00", 375460895.83], ["1424", 302179683.76]]);
    expect(JSON.stringify(r)).not.toMatch(/Catalog_|_Key|StandardODATA/);
  });
});
