import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUsage, fetchUsage, type UsageInputs } from "./usage";
import { resetNameCache } from "./odata-read";

const MONTH = "2026-10";
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const D1 = "d1d1d1d1-0000-0000-0000-000000000001";
const D2 = "d2d2d2d2-0000-0000-0000-000000000002";
const DEPT = "c1c1c1c1-0000-0000-0000-000000000009";
const WH = "e1e1e1e1-0000-0000-0000-000000000008";
const ZERO = "00000000-0000-0000-0000-000000000000";

const doc = (id: string, number: string, date: string, extra: Record<string, unknown> = {}) => ({
  Ref_Key: id, Number: number, Date: `${date}T10:00:00`, Склад_Key: WH, ПодразделениеЗатрат_Key: DEPT, ПодразделениеОрганизации_Key: ZERO, Комментарий: "P-50 бэхэлгээ", Получатель: ZERO, Получатель_Type: "StandardODATA.Undefined", ...extra,
});
const rec = (recorder: string, item: string, amount: number, qty: number, period = "2026-10-05T10:00:00", extra: Record<string, unknown> = {}) => ({
  Recorder: recorder, Period: period, Сумма: String(amount), КоличествоCr: String(qty), ExtDimensionCr1: item, ExtDimensionCr1_Type: "StandardODATA.Catalog_Номенклатура", ExtDimensionDr1: "x", ExtDimensionDr1_Type: "StandardODATA.Catalog_НоменклатурныеГруппы", ...extra,
});

const inputs = (over: Partial<UsageInputs> = {}): UsageInputs => ({
  month: MONTH,
  docs: [doc(D1, "УБ00-1", "2026-10-05"), doc(D2, "УБ00-2", "2026-10-07", { Комментарий: "", ПодразделениеЗатрат_Key: ZERO })],
  records: [rec(D1, A, 1000.5, 10), rec(D1, A, 500, 5), rec(D1, B, 250, 2), rec(D2, A, 100, 1, "2026-10-07T09:00:00")],
  names: {
    items: new Map([[A, { name: "Шон 80*80", unit: "ш" }], [B, { name: "Боолт", unit: "кг" }]]),
    departments: new Map([[DEPT, "Үйлдвэр"]]),
    warehouses: new Map([[WH, "Төв агуулах"]]),
    contractors: new Map(),
  },
  ...over,
});

describe("buildUsage (цэвэр нэгтгэл)", () => {
  it("материал бүрийн нийт тоо, дүнг регистрийн бичилтээс нэгтгэнэ (өртөг том тоогоор эрэмбэлэгдсэн)", () => {
    const r = buildUsage(inputs());
    expect(r.byMaterial.map((m) => [m.name, m.quantity, m.amount, m.unit, m.documents])).toEqual([
      ["Шон 80*80", 16, 1600.5, "ш", 2],
      ["Боолт", 2, 250, "кг", 1],
    ]);
    expect(r.totals).toEqual({ amount: 1850.5, documents: 2, materials: 2 });
  });

  it("баримт бүрийн дүн, хэлтэс, агуулах, зориулалт; сүүлийн огноо эхэнд", () => {
    const r = buildUsage(inputs());
    expect(r.documents.map((d) => d.number)).toEqual(["УБ00-2", "УБ00-1"]);
    const d1 = r.documents.find((d) => d.number === "УБ00-1")!;
    expect(d1).toMatchObject({ department: "Үйлдвэр", warehouse: "Төв агуулах", purpose: "P-50 бэхэлгээ", amount: 1750.5 });
    const d2 = r.documents.find((d) => d.number === "УБ00-2")!;
    expect(d2).toMatchObject({ department: "Тодорхойгүй", purpose: "", amount: 100 }); // хоосон GUID = хэлтэс заагаагүй
  });

  it("хэлтсээр нэгтгэнэ", () => {
    const r = buildUsage(inputs());
    expect(r.byDepartment).toEqual([
      { name: "Үйлдвэр", amount: 1750.5, documents: 1 },
      { name: "Тодорхойгүй", amount: 100, documents: 1 },
    ]);
  });

  it("өдрийн график сарын бүх өдрийг агуулна (зарцуулалтгүй өдөр 0)", () => {
    const r = buildUsage(inputs());
    expect(r.daily).toHaveLength(31);
    expect(r.daily[0]).toEqual({ date: "2026-10-01", amount: 0 });
    expect(r.daily.find((d) => d.date === "2026-10-05")!.amount).toBe(1750.5);
    expect(r.daily.find((d) => d.date === "2026-10-07")!.amount).toBe(100);
  });

  it("бараа материалын кредит биш бичилт, хоосон GUID-тай бичилтийг тоолохгүй", () => {
    const r = buildUsage(inputs({ records: [rec(D1, A, 100, 1), rec(D1, A, 999, 9, undefined, { ExtDimensionCr1_Type: "StandardODATA.Catalog_Контрагенты" }), rec(D1, ZERO, 999, 9)] }));
    expect(r.totals.amount).toBe(100);
    expect(r.byMaterial).toHaveLength(1);
  });

  it("нэр нь олдоогүй материал «Тодорхойгүй»; техникийн нэр (Catalog_, _Key, StandardODATA) хэзээ ч гарахгүй", () => {
    const r = buildUsage(inputs({ names: { items: new Map(), departments: new Map(), warehouses: new Map(), contractors: new Map() } }));
    expect(r.byMaterial.every((m) => m.name === "Тодорхойгүй")).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/Catalog_|_Key|StandardODATA|Document_/);
  });

  it("баримт байхгүй сар хоосон үр дүн өгнө", () => {
    const r = buildUsage(inputs({ docs: [], records: [] }));
    expect(r.totals).toEqual({ amount: 0, documents: 0, materials: 0 });
    expect(r.daily.every((d) => d.amount === 0)).toBe(true);
  });
});

describe("fetchUsage (fetch дуурайлгасан; 1С руу зөвхөн GET)", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ENV = { ONEC_ODATA_BASE_URL: "http://1c.test/b/odata/standard.odata", ONEC_ODATA_USER: "svc_user", ONEC_ODATA_PASSWORD: "pw-secret" };
  let docRows: unknown[] = [];
  let lookupRows: Record<string, unknown>[] = [];

  beforeEach(() => {
    resetNameCache();
    calls.length = 0;
    Object.assign(process.env, ENV);
    docRows = [doc(D1, "УБ00-1", "2026-10-05")];
    lookupRows = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const u = decodeURIComponent(url);
        if (u.includes("RecordsWithExtDimensions")) return json([rec(D1, A, 100, 1)]);
        if (u.includes("Document_ТребованиеНакладная?")) {
          const skip = Number(/\$skip=(\d+)/.exec(u)?.[1] ?? 0);
          return json(docRows.slice(skip, skip + 500));
        }
        if (u.includes("Catalog_")) {
          const keys = [...u.matchAll(/guid'([0-9a-f-]{36})'/g)].map((m) => m[1]);
          return json(keys.map((k) => ({ Ref_Key: k, Description: `Нэр-${k.slice(0, 4)}`, ЕдиницаИзмерения_Key: ZERO, ...lookupRows.find((r) => r.Ref_Key === k) })));
        }
        return json([]);
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(ENV)) delete process.env[k];
  });
  const json = (value: unknown[]) => new Response(JSON.stringify({ value }), { status: 200 });

  it("сарын баримт (Posted=true, сарын хүрээ) ба регистрийн хүсэлтийг сервер бүтээж, зөвхөн GET-ээр явуулна", async () => {
    const r = await fetchUsage(MONTH);
    for (const c of calls) {
      expect(c.init.method).toBe("GET");
      expect(c.init.body).toBeUndefined();
      expect(c.url.startsWith("http://1c.test/b/odata/standard.odata/")).toBe(true);
      expect(c.url).not.toContain("pw-secret");
    }
    const docCall = decodeURIComponent(calls.find((c) => c.url.includes(encodeURIComponent("Document_ТребованиеНакладная") + "?"))!.url);
    expect(docCall).toContain("Posted eq true and Date ge datetime'2026-10-01T00:00:00' and Date lt datetime'2026-11-01T00:00:00'");
    const regCall = decodeURIComponent(calls.find((c) => c.url.includes("RecordsWithExtDimensions"))!.url);
    expect(regCall).toContain("StartPeriod=datetime'2026-10-01T00:00:00'");
    expect(regCall).toContain("EndPeriod=datetime'2026-10-31T23:59:59'");
    expect(regCall).toContain("Condition='Recorder_Type eq ''StandardODATA.Document_ТребованиеНакладная'''");
    expect(r.totals.documents).toBe(1);
    expect(r.byMaterial[0].amount).toBe(100);
  });

  it("баримтыг 500-аар хуудаслан бүгдийг нь авна", async () => {
    docRows = Array.from({ length: 620 }, (_, i) => doc(`d${String(i).padStart(7, "0")}-0000-0000-0000-000000000000`, `УБ00-${i}`, "2026-10-05"));
    const r = await fetchUsage(MONTH);
    expect(r.documents).toHaveLength(620);
    expect(calls.filter((c) => decodeURIComponent(c.url).includes("Document_ТребованиеНакладная?"))).toHaveLength(2);
  });

  it("нэрийн лавлахыг 25 түлхүүрээр багцлан асууна; ижил түлхүүрийг дахин асуухгүй (1 цагийн cache)", async () => {
    const many = Array.from({ length: 60 }, (_, i) => `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`);
    docRows = many.map((k, i) => doc(`d${String(i).padStart(7, "0")}-0000-0000-0000-000000000000`, `УБ00-${i}`, "2026-10-05", { ПодразделениеЗатрат_Key: k }));
    await fetchUsage(MONTH);
    const deptCalls = calls.filter((c) => decodeURIComponent(c.url).includes("Catalog_ПодразделенияОрганизаций"));
    expect(deptCalls).toHaveLength(3); // 25 + 25 + 10
    for (const c of deptCalls) expect([...decodeURIComponent(c.url).matchAll(/guid'/g)].length).toBeLessThanOrEqual(25);
    const before = calls.length;
    await fetchUsage(MONTH);
    expect(calls.slice(before).some((c) => decodeURIComponent(c.url).includes("Catalog_ПодразделенияОрганизаций"))).toBe(false);
  });

  it("1С алдаа өгвөл тодорхой алдаа (URL, нэр, нууц үггүй)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret internals", { status: 500 })));
    const err = await fetchUsage(MONTH).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).not.toMatch(/1c\.test|pw-secret|svc_user|internals/);
  });
});
