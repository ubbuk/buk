import { beforeEach, describe, expect, it, vi } from "vitest";

const g = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ACC = { f1441: g(1), s1431: g(2), c1401: g(3), m1423: g(4), w1421: g(5) };
const UNIT = g(20);
const P_SHON = g(31);
const P_BRAK = g(32);
const P_KARKAS = g(33);
const P_ELS = g(34);
const P_ZAS = g(35);
const P_BRAK2 = g(36);
const D_TEN = g(41);
const D_ARM = g(42);
const D_CRUSH = g(43);
const D_TBHC = g(44); // Тенсиланд, Арматурын хэсгийн эх хэлтэс
const D_ROOT = g(45); // эх хэлтсийн эх (гурван түвшин)

const state = vi.hoisted(() => ({ calls: [] as string[], docs: [] as Record<string, unknown>[], reclass: [] as Record<string, unknown>[], ledger: [] as Record<string, unknown>[] }));

vi.mock("./odata-read", async (orig) => {
  const actual = await orig<typeof import("./odata-read")>();
  return {
    ...actual,
    odataRows: async (path: string) => {
      const p = decodeURIComponent(path);
      state.calls.push(p);
      if (p.includes("RecordsWithExtDimensions")) return state.ledger;
      if (p.startsWith("Document_КомплектацияНоменклатуры")) return state.reclass;
      if (p.startsWith("Document_")) return state.docs;
      return [];
    },
    lookupRows: async (catalog: string, keys: readonly string[]) => {
      const table: Record<string, Record<string, Record<string, unknown>>> = {
        Catalog_Номенклатура: {
          [P_SHON]: { Description: "Шон 80*80", ЕдиницаИзмерения_Key: UNIT },
          [P_BRAK]: { Description: "Шон 80*80 Брак", ЕдиницаИзмерения_Key: UNIT },
          [P_KARKAS]: { Description: "Каркас", ЕдиницаИзмерения_Key: UNIT },
          [P_ZAS]: { Description: "Шон 80*80 Зас", ЕдиницаИзмерения_Key: UNIT },
          [P_BRAK2]: { Description: "Шон 80*80 (брак)", ЕдиницаИзмерения_Key: UNIT },
          [P_ELS]: { Description: "Элс  (0-3)", ЕдиницаИзмерения_Key: g(21) },
        },
        Catalog_КлассификаторЕдиницИзмерения: { [UNIT]: { Description: "ш" }, [g(21)]: { Description: "м3" } },
        Catalog_ПодразделенияОрганизаций: {
          [D_TEN]: { Description: "Тенсиланд хэсэг", Parent_Key: D_TBHC },
          [D_ARM]: { Description: "Арматурын хэсэг", Parent_Key: "00000000-0000-0000-0000-000000000000" },
          [D_CRUSH]: { Description: "Бутлан ангилах үйлдвэр", Parent_Key: "" },
          [D_TBHC]: { Description: "Төмөр бетон хийц эдлэлийн цех", Parent_Key: D_ROOT },
          [D_ROOT]: { Description: "Үйлдвэр", Parent_Key: "" },
        },
      };
      return new Map(keys.map((k) => [k, table[catalog]?.[k] ?? null]));
    },
  };
});

vi.mock("./accounts", async (orig) => {
  const actual = await orig<typeof import("./accounts")>();
  return {
    ...actual,
    loadAccountBook: async () =>
      actual.buildAccountBook([
        { Ref_Key: ACC.f1441, Code: "1441.00" },
        { Ref_Key: ACC.s1431, Code: "1431.00" },
        { Ref_Key: ACC.c1401, Code: "1401.00" },
        { Ref_Key: ACC.m1423, Code: "1423.00" },
        { Ref_Key: ACC.w1421, Code: "1421.00" },
      ]),
  };
});

import { fetchProductionMonth } from "./production";

const ln = (n: number, product: string, qty: number, account: string, unit = UNIT) => ({ LineNumber: String(n), Номенклатура_Key: product, Количество: qty, ЕдиницаИзмерения_Key: unit, Счет_Key: account });
const rec = (over: Record<string, unknown>) => ({ Recorder_Type: "StandardODATA.Document_ОтчетПроизводстваЗаСмену", ...over });

beforeEach(() => {
  state.calls.length = 0;
  state.reclass = [];
  state.docs = [
    { Ref_Key: g(100), Number: "ТЕН 1102   ", Date: "2098-04-02T22:00:00", Posted: true, ПодразделениеЗатрат_Key: D_TEN, Продукция: [ln(1, P_SHON, 700, ACC.f1441), ln(2, P_BRAK, 3, ACC.f1441), ln(3, P_SHON, 0, ACC.f1441)] },
    { Ref_Key: g(101), Number: "АРМ 1102", Date: "2098-04-03T10:00:00", Posted: false, ПодразделениеЗатрат_Key: D_ARM, Продукция: [ln(1, P_KARKAS, 12, ACC.s1431)] },
    { Ref_Key: g(102), Number: "БУТ 1102", Date: "2098-04-03T17:45:59", Posted: true, ПодразделениеЗатрат_Key: D_CRUSH, Продукция: [ln(1, P_ELS, 79.18, ACC.c1401, g(21))] },
  ];
  state.ledger = [
    rec({ AccountDr_Key: ACC.f1441, AccountCr_Key: ACC.w1421, Сумма: 700, КоличествоDr: 700, ExtDimensionDr1: P_SHON, ПодразделениеCr_Key: D_TEN }),
    rec({ AccountDr_Key: ACC.f1441, AccountCr_Key: ACC.w1421, Сумма: 100, КоличествоDr: 100, ExtDimensionDr1: P_SHON, ПодразделениеCr_Key: D_TEN }),
    rec({ AccountDr_Key: ACC.s1431, AccountCr_Key: ACC.m1423, Сумма: 12, КоличествоDr: 12, ExtDimensionDr1: P_KARKAS, ПодразделениеCr_Key: D_ARM }),
    rec({ AccountDr_Key: ACC.m1423, AccountCr_Key: ACC.c1401, Сумма: 1500.5, ПодразделениеDr_Key: D_ARM }),
    rec({ AccountDr_Key: ACC.m1423, AccountCr_Key: ACC.c1401, Сумма: 499.5, ПодразделениеDr_Key: D_ARM }),
    // Комплектация: үйлдвэрлэл биш, оруулахгүй
    { Recorder_Type: "StandardODATA.Document_КомплектацияНоменклатуры", AccountDr_Key: ACC.f1441, AccountCr_Key: ACC.f1441, Сумма: 9_999_999, КоличествоDr: 5, ExtDimensionDr1: P_SHON, ПодразделениеCr_Key: D_TEN },
  ];
});

const comp = (product: string, qty: number) => ({ Номенклатура_Key: product, Количество: qty });

describe("fetchProductionMonth: Комплектаци (дараа нь брак болсон)", () => {
  it("толгой нь «Брак», эх нь брак БИШ бол reclass мөр (баримтын өдрөөр, цехгүй); брак→бэлэн, зас→бэлэн, брак→брак орохгүй", async () => {
    state.reclass = [
      { Ref_Key: g(200), Number: "УБ00-1", Date: "2098-04-05T13:40:04", Номенклатура_Key: P_BRAK, Количество: 12, Комплектующие: [comp(P_SHON, 12)] },
      { Ref_Key: g(201), Number: "УБ00-2", Date: "2098-04-06T00:00:00", Номенклатура_Key: P_BRAK2, Количество: 4, Комплектующие: [comp(P_ZAS, 4)] },
      { Ref_Key: g(202), Number: "УБ00-3", Date: "2098-04-07T00:00:00", Номенклатура_Key: P_SHON, Количество: 2113, Комплектующие: [comp(P_BRAK, 2113)] },
      { Ref_Key: g(203), Number: "УБ00-4", Date: "2098-04-08T00:00:00", Номенклатура_Key: P_SHON, Количество: 141, Комплектующие: [comp(P_ZAS, 141)] },
      { Ref_Key: g(204), Number: "УБ00-5", Date: "2098-04-09T00:00:00", Номенклатура_Key: P_BRAK, Количество: 9, Комплектующие: [comp(P_BRAK2, 9)] },
    ];
    const r = await fetchProductionMonth("2098-04");
    expect(r.lines.filter((l) => l.stage === "reclass").map((l) => [l.docNumber, l.day, l.department, l.product, l.unit, l.quantity, l.posted])).toEqual([
      ["УБ00-1", "2098-04-05", "", "Шон 80*80 Брак", "ш", 12, true],
      ["УБ00-2", "2098-04-06", "", "Шон 80*80 (брак)", "ш", 4, true],
    ]);
    // гарцын мөрүүд хэвээр
    expect(r.lines.filter((l) => l.stage !== "reclass")).toHaveLength(4);
  });

  it("зөвхөн GET, зөвхөн батлагдсан (Posted), устгагдаагүй, сарын хүрээ; Комментарий уншихгүй", async () => {
    await fetchProductionMonth("2098-04");
    const call = state.calls.find((c) => c.startsWith("Document_КомплектацияНоменклатуры"))!;
    expect(call).toContain("Posted eq true");
    expect(call).toContain("DeletionMark eq false");
    expect(call).toContain("2098-04-01T00:00:00");
    expect(call).not.toContain("Комментарий");
  });
});

describe("fetchProductionMonth", () => {
  it("баримтын мөр: шат нь мөрийн дансаар (1441 бэлэн, 1431 хагас, 1401 бутлуур), тоо 0 мөр алгасна, дугаар цэвэрлэгдэнэ, нэгж 1С-ийн", async () => {
    const r = await fetchProductionMonth("2098-04");
    expect(r.lines.map((l) => [l.docNumber, l.day, l.time, l.posted, l.stage, l.department, l.product, l.unit, l.quantity])).toEqual([
      ["ТЕН 1102", "2098-04-02", "22:00", true, "finished", "Тенсиланд хэсэг", "Шон 80*80", "ш", 700],
      ["ТЕН 1102", "2098-04-02", "22:00", true, "finished", "Тенсиланд хэсэг", "Шон 80*80 Брак", "ш", 3],
      ["АРМ 1102", "2098-04-03", "10:00", false, "semi", "Арматурын хэсэг", "Каркас", "ш", 12],
      ["БУТ 1102", "2098-04-03", "17:45", true, "crusher", "Бутлан ангилах үйлдвэр", "Элс (0-3)", "м3", 79.18],
    ]);
  });

  it("бичилт: Комплектация хасагдана; гарц бүтээгдэхүүн+цех+шатаар, материал цехээр нэгтгэгдэнэ", async () => {
    const r = await fetchProductionMonth("2098-04");
    expect(r.ledger).toEqual([
      { kind: "output", stage: "finished", department: "Тенсиланд хэсэг", productKey: P_SHON, product: "Шон 80*80", unit: "ш", quantity: 800, amount: 800 },
      { kind: "output", stage: "semi", department: "Арматурын хэсэг", productKey: P_KARKAS, product: "Каркас", unit: "ш", quantity: 12, amount: 12 },
      { kind: "material", stage: "", department: "Арматурын хэсэг", productKey: "", product: "", unit: "", quantity: 0, amount: 2000 },
    ]);
    expect(JSON.stringify(r)).not.toContain("9999999");
  });

  it("зөвхөн устгагдаагүй баримт, тухайн сарын хүрээ, хэрэгтэй талбар; «Комментарий» хүсэлтэд огт орохгүй", async () => {
    await fetchProductionMonth("2098-04");
    const docReq = state.calls.find((c) => c.startsWith("Document_ОтчетПроизводстваЗаСмену"))!;
    expect(docReq).toContain("DeletionMark eq false");
    expect(docReq).toContain("Date ge datetime'2098-04-01T00:00:00'");
    expect(docReq).toContain("Date le datetime'2098-04-30T23:59:59'");
    expect(docReq).toContain("$select=Ref_Key,Number,Date,Posted,ПодразделениеЗатрат_Key,Продукция");
    expect(state.calls.join("\n")).not.toContain("Комментарий");
    const ledgerReq = state.calls.find((c) => c.includes("RecordsWithExtDimensions"))!;
    expect(ledgerReq).toContain("StartPeriod=datetime'2098-04-01T00:00:00'");
    expect(ledgerReq).toContain(`AccountDr_Key eq guid'${ACC.f1441}'`);
  });

  it("1С-ийн хэлтсийн Parent (эх хэлтэс) татагдахгүй: картын бүтэц өөрсдийн тохиргооноос (production-groups.ts)", async () => {
    await fetchProductionMonth("2098-04");
    expect(state.calls.join("\n")).not.toContain("Parent_Key");
  });

  it("баримтгүй сар алдаа биш: хоосон", async () => {
    state.docs = [];
    state.ledger = [];
    expect(await fetchProductionMonth("2098-04")).toEqual({ month: "2098-04", lines: [], ledger: [] });
  });
});
