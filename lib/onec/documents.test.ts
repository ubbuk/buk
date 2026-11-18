import { beforeEach, describe, expect, it, vi } from "vitest";

// 1С-ийн хариуг (OData) дуурайлгана: сүлжээ, DB хэрэггүй. Бодит УБ00-002244 баримтын бүтэцтэй (2 мөр болгож багасгасан).
const REF = "c498e8ff-df0e-11f1-a380-a036bc2b6c60";
const ITEM_A = "0e00bdcf-eebe-11e7-b296-002170690c3b";
const ITEM_B = "7bebee2d-c2df-11f1-a372-a036bc2b6c60";
const WH = "c039f8f2-ef9d-11e7-a66a-002170690c3b";
const PARTY = "59bfd602-c77c-11e8-8cea-509a4c38f007";
const USER = "84cb0559-f9a6-11eb-80cd-d4ae52ccea60";
const UNIT = "de80b7de-aa22-11dc-a0f4-0011d85708ff";
const ACC_STOCK = "9e80d0d3-834d-4365-bd1e-2ca238fa0d5d";
const ACC_PAYABLE = "a2912351-d8b0-4471-8bb7-faa192adf582";

const catalogs: Record<string, Record<string, Record<string, unknown>>> = {
  Catalog_Номенклатура: {
    [ITEM_A]: { Description: "Үхрийн мах (шөл)", Code: "00-00001640", ЕдиницаИзмерения_Key: UNIT },
    [ITEM_B]: { Description: "Хонины хавирга", Code: "00-00009999", ЕдиницаИзмерения_Key: UNIT },
  },
  Catalog_Склады: { [WH]: { Description: "Цайны газрын агуулах", Code: "00-000008" } },
  Catalog_Контрагенты: { [PARTY]: { Description: "МАХ-ЭКСПОРТ ХХК", Code: "00-001177" } },
  Catalog_Пользователи: { [USER]: { Description: "Г.Болд" } },
  Catalog_КлассификаторЕдиницИзмерения: { [UNIT]: { Description: "кг" } },
};

const doc = {
  Ref_Key: REF,
  Number: "УБ00-002244",
  Date: "2026-11-11T11:03:15",
  Posted: true,
  Склад_Key: WH,
  Контрагент_Key: PARTY,
  Ответственный_Key: USER,
  Комментарий: "Цайны газар мах авав",
  СуммаДокумента: 22_200_000,
  СуммаВключаетНДС: true,
  Товары: [
    { LineNumber: "1", Номенклатура_Key: ITEM_A, Количество: 150, Цена: 32800, Сумма: 4_920_000, СуммаНДС: 447_272.73 },
    { LineNumber: "2", Номенклатура_Key: ITEM_B, Количество: 60, Цена: 23500, Сумма: 17_280_000, СуммаНДС: 1_570_909.1 },
  ],
  Услуги: [],
};

const requisition = {
  Ref_Key: "726b5c3d-bcba-11f1-a371-a036bc2b6c60",
  Number: "УБ00-002244",
  Date: "2026-09-30T23:34:05",
  Posted: true,
  Склад_Key: WH,
  Материалы: [{ LineNumber: "1", Номенклатура_Key: ITEM_A, Количество: 10, Себестоимость: 0 }],
};

const ledger = [
  { Period: "2026-11-11T11:03:15", Recorder: REF, Recorder_Type: "StandardODATA.Document_ПоступлениеТоваровУслуг", LineNumber: "1", AccountDr_Key: ACC_STOCK, AccountCr_Key: ACC_PAYABLE, Сумма: 4_472_727.27, КоличествоDr: 150 },
  { Period: "2026-11-11T11:03:15", Recorder: "other", Recorder_Type: "StandardODATA.Document_ПоступлениеТоваровУслуг", LineNumber: "1", AccountDr_Key: ACC_STOCK, AccountCr_Key: ACC_PAYABLE, Сумма: 1, КоличествоDr: 1 },
];

const requisitionLedger = [
  { Period: "2026-09-30T23:34:05", Recorder: requisition.Ref_Key, Recorder_Type: "StandardODATA.Document_ТребованиеНакладная", LineNumber: "1", Сумма: 96_000.5, КоличествоCr: 10, ExtDimensionCr1: ITEM_A, ExtDimensionCr1_Type: "StandardODATA.Catalog_Номенклатура" },
];

const chart = [
  { Ref_Key: ACC_STOCK, Code: "1401.00", Description: "Түүхий Эд, материал" },
  { Ref_Key: ACC_PAYABLE, Code: "3101.00", Description: "Дансны өглөг (Бэлтгэн нийлүүлэгч)" },
];

const calls: string[] = [];

vi.mock("@/lib/onec-odata/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onec-odata/client")>("@/lib/onec-odata/client");
  return {
    ...actual,
    odataGet: vi.fn(async (path: string) => {
      const p = decodeURIComponent(path);
      calls.push(p);
      if (p.startsWith("Document_ПоступлениеТоваровУслуг(guid'")) return JSON.stringify(p.includes(REF) ? doc : null);
      if (p.startsWith("Document_ТребованиеНакладная(guid'")) return JSON.stringify(requisition);
      if (p.startsWith("Document_ПоступлениеТоваровУслуг?")) return JSON.stringify({ value: [doc] });
      if (p.startsWith("ChartOfAccounts_Хозрасчетный?")) return JSON.stringify({ value: chart });
      if (p.includes("RecordsWithExtDimensions")) return JSON.stringify({ value: p.includes("ТребованиеНакладная") ? requisitionLedger : ledger });
      const cat = Object.keys(catalogs).find((c) => p.startsWith(`${c}?`));
      if (cat) {
        const wanted = [...p.matchAll(/guid'([0-9a-f-]{36})'/g)].map((m) => m[1]);
        return JSON.stringify({ value: wanted.filter((k) => catalogs[cat][k]).map((k) => ({ Ref_Key: k, ...catalogs[cat][k] })) });
      }
      throw new Error(`unexpected path: ${p}`);
    }),
  };
});

import { resetAccountBook } from "./accounts";
import { loadDocumentDetail, loadDocuments } from "./documents";
import { resetNameCache } from "./odata-read";
import { resetOdataCache } from "./odata-cache";

beforeEach(() => {
  resetNameCache();
  resetOdataCache();
  resetAccountBook();
  calls.length = 0;
});

describe("баримтын дэлгэрэнгүй (УБ00-002244)", () => {
  it("толгой, мөрүүд, НӨАТ, нийт 1С-ийн баримттай таарна; техникийн нэр гарахгүй", async () => {
    const { value: d } = await loadDocumentDetail("ПоступлениеТоваровУслуг", REF, { withPostings: true });
    expect(d.number).toBe("УБ00-002244");
    expect(d.label).toBe("Бараа хүлээн авсан");
    expect(d.tone).toBe("in");
    expect(d.fields).toEqual(
      expect.arrayContaining([
        { label: "Харилцагч", value: "МАХ-ЭКСПОРТ ХХК" },
        { label: "Агуулах", value: "Цайны газрын агуулах" },
        { label: "Хариуцагч", value: "Г.Болд" },
      ])
    );
    expect(d.comment).toBe("Цайны газар мах авав");
    expect(d.lines.map((l) => [l.item, l.qty, l.unit, l.price, l.amount])).toEqual([
      ["Үхрийн мах (шөл)", 150, "кг", 32800, 4_920_000],
      ["Хонины хавирга", 60, "кг", 23500, 17_280_000],
    ]);
    // НӨАТ-тай дүн: нийт = СуммаДокумента; НӨАТ нь мөрүүдийн нийлбэр
    expect(d.totals).toMatchObject({ vat: 2_018_181.83, total: 22_200_000, vatIncluded: true });
    // Дэлгэцэнд харагдах бүх текст (ref, itemKey нь зөвхөн дарж нээх нууц лавлагаа, харагдахгүй)
    const visible = JSON.stringify({ ...d, ref: undefined, type: undefined, lines: d.lines.map((l) => ({ ...l, itemKey: undefined })) });
    expect(visible).not.toMatch(/Catalog_|Document_|_Key|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);
  });

  it("бичилт: дансны НЭР, код нь тусдаа (tooltip)", async () => {
    const { value: d } = await loadDocumentDetail("ПоступлениеТоваровУслуг", REF, { withPostings: true });
    expect(d.postings).toHaveLength(1); // өөр баримтын бичилт орохгүй
    expect(d.postings[0].debit).toEqual({ name: "Түүхий Эд, материал", code: "1401" });
    expect(d.postings[0].credit.name).toBe("Дансны өглөг (Бэлтгэн нийлүүлэгч)");
  });

  it("нярав: нягтлангийн бичилт харагдахгүй", async () => {
    const { value: d } = await loadDocumentDetail("ПоступлениеТоваровУслуг", REF, { withPostings: false });
    expect(d.postings).toEqual([]);
  });

  it("өртөг хадгалдаггүй баримт (шаардах хуудас): дүнг нягтлангийн бичилтээс авна", async () => {
    const { value: d } = await loadDocumentDetail("ТребованиеНакладная", requisition.Ref_Key, { withPostings: false });
    expect(d.costFromLedger).toBe(true);
    expect(d.lines[0]).toMatchObject({ qty: 10, amount: 96_000.5, price: 9600.05 });
    expect(d.totals.total).toBe(96_000.5);
  });

  it("буруу лавлагааг 1С руу явуулахгүй", async () => {
    await expect(loadDocumentDetail("Document_X'; drop", REF, { withPostings: false })).rejects.toMatchObject({ status: 400 });
    await expect(loadDocumentDetail("ПоступлениеТоваровУслуг", "not-a-guid", { withPostings: false })).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  it("баримт олдохгүй бол 404", async () => {
    await expect(loadDocumentDetail("ПоступлениеТоваровУслуг", "00000000-0000-0000-0000-00000000dead", { withPostings: false })).rejects.toMatchObject({ status: 404 });
  });
});

describe("баримтын жагсаалт", () => {
  it("карт: огноо, төрөл, харилцагч, агуулах, дүн, мөрийн тоо", async () => {
    const { value } = await loadDocuments({ from: "2026-11-01", to: "2026-11-30", kinds: ["receipt"] });
    expect(value).toHaveLength(1);
    expect(value[0]).toMatchObject({
      kind: "receipt",
      type: "ПоступлениеТоваровУслуг",
      ref: REF,
      number: "УБ00-002244",
      label: "Бараа хүлээн авсан",
      tone: "in",
      party: "МАХ-ЭКСПОРТ ХХК",
      warehouse: "Цайны газрын агуулах",
      warehouseCode: "00-000008",
      amount: 22_200_000,
      lines: 2,
    });
  });

  it("шүүлт 1С руу: зөвхөн батлагдсан, огнооны хүрээ, тогтвортой эрэмбэ", async () => {
    await loadDocuments({ from: "2026-11-01", to: "2026-11-30", kinds: ["receipt"] });
    const q = calls.find((c) => c.startsWith("Document_ПоступлениеТоваровУслуг?")) ?? "";
    expect(q).toContain("Posted eq true");
    expect(q).toContain("Date ge datetime'2026-11-01T00:00:00'");
    expect(q).toContain("Date lt datetime'2026-12-01T00:00:00'");
    expect(q).toContain("$orderby=Date,Ref_Key");
  });

  it("хугацаа 100 хоногоос хэтэрвэл, оныг давбал татахгүй", async () => {
    await expect(loadDocuments({ from: "2026-01-01", to: "2026-06-30", kinds: ["receipt"] })).rejects.toMatchObject({ status: 400 });
    await expect(loadDocuments({ from: "2025-12-20", to: "2026-01-10", kinds: ["receipt"] })).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });
});
