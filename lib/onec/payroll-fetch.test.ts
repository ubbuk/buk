import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccountBook } from "./accounts";
import { resetNameCache } from "./odata-read";
import { fetchPayrollMonth } from "./payroll";

// 1С руу очих хүсэлтийг шалгана (fetch дуурайлгасан, зөвхөн GET): сарын нийт дүнд ХОЁР хөнгөн хүсэлт, зөвхөн хэрэгтэй талбар, цалингийн дансны шүүлт.
const SAL = "a3a3a3a3-0000-0000-0000-000000000003";
const NDSH = "a4a4a4a4-0000-0000-0000-000000000004";
const BANK = "a1a1a1a1-0000-0000-0000-000000000001";
const WIP = "a8a8a8a8-0000-0000-0000-000000000008";
const AP = "a5a5a5a5-0000-0000-0000-000000000005";
const ENV = { ONEC_ODATA_BASE_URL: "http://1c.test/b/odata/standard.odata", ONEC_ODATA_USER: "u", ONEC_ODATA_PASSWORD: "p" };

const json = (value: unknown[]) => new Response(JSON.stringify({ value }), { status: 200 });
let calls: { url: string; init: RequestInit }[] = [];
let lines: unknown[] = [];
let headers: unknown[] = [];

beforeEach(() => {
  resetAccountBook();
  resetNameCache();
  calls = [];
  headers = [];
  Object.assign(process.env, ENV);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const u = decodeURIComponent(url);
      if (u.includes("ChartOfAccounts_")) return json([{ Ref_Key: SAL, Code: "3342.00", Description: "Цалингийн өглөг" }, { Ref_Key: NDSH, Code: "3450.00", Description: "НДШ" }, { Ref_Key: BANK, Code: "1101.00", Description: "Банк" }, { Ref_Key: WIP, Code: "1424.00", Description: "Үйлдвэрлэл" }, { Ref_Key: AP, Code: "3101.00", Description: "Өглөг" }]);
      if (u.includes("/Balance(")) return json([{ СуммаBalance: -500 }]); // Кт үлдэгдэл 500 = өглөг 500
      if (u.includes("RecordsWithExtDimensions")) return json(lines);
      if (u.includes("Document_ОперацияБух?")) return json(headers);
      return json([]);
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

const data = () => calls.map((c) => decodeURIComponent(c.url)).filter((u) => !u.includes("ChartOfAccounts_"));

describe("fetchPayrollMonth: 1С-ийн ачаалал", () => {
  it("зөвхөн ХОЁР дуудлага (бичилт, сарын эхний Balance), дарааллаар; зөвхөн GET; зөвхөн цалингийн данс, тухайн сар, 3 талбар", async () => {
    lines = [{ AccountDr_Key: WIP, AccountCr_Key: SAL, Сумма: 1000 }, { AccountDr_Key: SAL, AccountCr_Key: BANK, Сумма: 300 }, { AccountDr_Key: WIP, AccountCr_Key: NDSH, Сумма: 120 }];
    const r = await fetchPayrollMonth("2026-09");
    const d = data();
    expect(d).toHaveLength(2);
    for (const c of calls) expect(c.init.method).toBe("GET");
    const [rec, bal] = d;
    expect(rec).toContain("RecordsWithExtDimensions(StartPeriod=datetime'2026-09-01T00:00:00',EndPeriod=datetime'2026-09-30T23:59:59'");
    expect(rec.match(/\$select=([^&]*)/)?.[1]).toBe("Recorder,Recorder_Type,AccountDr_Key,AccountCr_Key,Сумма"); // хэлтэс, хүн, огнооны талбаргүй
    expect(rec).toContain(`AccountDr_Key eq guid'${SAL}'`);
    expect(rec).toContain(`AccountCr_Key eq guid'${NDSH}'`);
    expect(rec).not.toContain(AP); // цалинтай хамааралгүй данс шүүлтэд ороогүй
    // Balance: сарын ЭХНИЙ агшинд (ирээдүй, сарын эцэс биш), зөвхөн 3342, нэг талбар
    expect(bal).toContain("Balance(Period=datetime'2026-09-01T00:00:00')");
    expect(bal).toContain("$select=СуммаBalance");
    expect(bal).toContain(`Account_Key eq guid'${SAL}'`);
    expect(bal).not.toContain(NDSH);
    // эхний өглөг 500 + (Кт 1000 − Дт 300) = 1200
    expect(r).toMatchObject({ month: "2026-09", accrued: 1000, employerNdsh: 120, paidBank: 300, closingPayable: 1200, lines: 3 });
    expect(r.timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("тэтгэмж: нягтлангийн баримтын гарчгийг (Содержание) ГАНЦ нэг GET-ээр уншиж, «тэтгэмж» гарчигтай баримтыг тусад нь ялгана; нийт «бодсон» хэвээр", async () => {
    const BEN = "b1b1b1b1-0000-0000-0000-000000000165";
    const MAIN = "b2b2b2b2-0000-0000-0000-000000000179";
    const J = "StandardODATA.Document_ОперацияБух";
    lines = [
      { AccountDr_Key: WIP, AccountCr_Key: SAL, Сумма: 1000, Recorder: MAIN, Recorder_Type: J },
      { AccountDr_Key: WIP, AccountCr_Key: SAL, Сумма: 70, Recorder: BEN, Recorder_Type: J },
      { AccountDr_Key: WIP, AccountCr_Key: SAL, Сумма: 5, Recorder: "b3b3b3b3-0000-0000-0000-000000000043", Recorder_Type: "StandardODATA.Document_БольничныйЛист" },
    ];
    headers = [{ Ref_Key: BEN, Содержание: "2026 оны 9 сарын тэтгэмжийн мөнгө" }, { Ref_Key: MAIN, Содержание: "2026 оны 9 сарын цалин" }];
    const r = await fetchPayrollMonth("2026-09");
    const d = data();
    expect(d).toHaveLength(3); // бичилт, баримтын гарчиг, Balance
    for (const c of calls) expect(c.init.method).toBe("GET");
    const header = d.find((u) => u.includes("Document_ОперацияБух?"))!;
    expect(header).toContain("$select=Ref_Key,Содержание"); // Комментарий (хүний нэр) уншихгүй
    expect(header).not.toContain("Комментарий");
    expect(header).toContain(`Ref_Key eq guid'${BEN}'`);
    expect(header).not.toContain("b3b3b3b3"); // өвчний хуудас нь баримтын төрлөөр танигдана, гарчиг уншихгүй
    expect(r).toMatchObject({ accrued: 1075, benefit: 70, sickPay: 5 });
  });

  it("одоогийн сард ч ирээдүйн агшинд Balance авахгүй", async () => {
    const month = new Date().toISOString().slice(0, 7);
    lines = [];
    await fetchPayrollMonth(month);
    const bal = data()[1];
    expect(bal).toContain(`Balance(Period=datetime'${month}-01T00:00:00')`);
  });

  it("бодолтгүй сар (бичилт 0): алдаа биш, 0 дүн, өглөг = эхний өглөг", async () => {
    lines = [];
    const r = await fetchPayrollMonth("2026-11");
    expect(r).toMatchObject({ accrued: 0, employerNdsh: 0, employeeNdsh: 0, hhoat: 0, paidBank: 0, paidCash: 0, lines: 0, closingPayable: 500 });
  });

  it("хүсэлтийн хугацааг дамжуулна (sync-ийн үлдсэн хугацаа)", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    lines = [];
    await fetchPayrollMonth("2026-09", { timeoutMs: 12_345 });
    expect(spy.mock.calls.filter((c) => c[0] === 12_345).length).toBeGreaterThanOrEqual(2);
    spy.mockRestore();
  });
});
