import { describe, expect, it } from "vitest";
import { buildCash, redactCash, type CashInputs } from "./cash";
import type { DocCard } from "./doc-kinds";
import { buildAccountBook } from "./accounts";
import { redactPayrollDetail } from "./documents";
import { isPayrollAccount, isPayrollRecord, notPayrollFilter, payrollAccountKeys, PAYROLL_LABEL, redactPayrollCards } from "./payroll-guard";

const NAME = "Бат-Эрдэнэ";
const A1 = "a1a1a1a1-0000-0000-0000-000000000001"; // 1101
const SAL = "a3a3a3a3-0000-0000-0000-000000000003"; // 3342 цалингийн өглөг
const NDSH = "a4a4a4a4-0000-0000-0000-000000000004"; // 3450 НДШ
const AP = "a5a5a5a5-0000-0000-0000-000000000005"; // 3101 өглөг
const P1 = "c1c1c1c1-0000-0000-0000-00000000000a";
const ZERO = "00000000-0000-0000-0000-000000000000";

describe("цалингийн данс", () => {
  it("3340-3349, 3450, 3462, 3463, 1243, 1249, 1295 (дэд данстай нь ч); бусад данс биш", () => {
    for (const c of ["3340", "3342.00", "3343", "3344", "3349", "3450.00", "3450.01", "3462.00", "3463", "1243.00", "1249", "1295.00"]) expect(isPayrollAccount(c), c).toBe(true);
    for (const c of ["3101.00", "3465.01", "3461", "3400.00", "1101.00", "1501", "3350", "34500", "7000", "", null, undefined]) expect(isPayrollAccount(c as string), String(c)).toBe(false);
  });

  it("дансны төлөвлөгөөнөөс түлхүүрүүд; шүүлт нь Дт, Кт хоёр талд; түлхүүргүй бол алдаа (fail-closed)", () => {
    const book = buildAccountBook([{ Ref_Key: SAL, Code: "3342.00", Description: "Цалингийн өглөг" }, { Ref_Key: NDSH, Code: "3450.00", Description: "НДШ" }, { Ref_Key: AP, Code: "3101.00", Description: "Өглөг" }]);
    const keys = payrollAccountKeys(book);
    expect([...keys].sort()).toEqual([SAL, NDSH]);
    const f = notPayrollFilter(keys, ["AccountDr_Key", "AccountCr_Key"]);
    expect(f).toContain(`AccountDr_Key ne guid'${SAL}'`);
    expect(f).toContain(`AccountCr_Key ne guid'${NDSH}'`);
    expect(f).not.toContain(AP);
    expect(() => notPayrollFilter(new Set(), ["AccountDr_Key"])).toThrow();
    expect(isPayrollRecord({ AccountDr_Key: AP, AccountCr_Key: SAL.toUpperCase() }, keys)).toBe(true);
    expect(isPayrollRecord({ AccountDr_Key: AP, AccountCr_Key: A1 }, keys)).toBe(false);
  });
});

const rec = (id: string, date: string, dr: string, cr: string, amount: number, memo: string, drDim?: string) => ({
  Recorder: id,
  LineNumber: "1",
  Period: `${date}T12:00:00`,
  Recorder_Type: "StandardODATA.Document_СписаниеСРасчетногоСчета",
  Сумма: amount,
  Содержание: memo,
  AccountDr_Key: dr,
  AccountCr_Key: cr,
  ExtDimensionDr1: drDim ?? ZERO,
  ExtDimensionDr1_Type: drDim ? "StandardODATA.Catalog_Контрагенты" : "StandardODATA.Undefined",
  ExtDimensionCr1: ZERO,
  ExtDimensionCr1_Type: "StandardODATA.Undefined",
});
const bal = (v: number) => ({ Account_Key: A1, ExtDimension1: ZERO, ExtDimension1_Type: "StandardODATA.Undefined", СуммаBalance: v });

function cashInputs(): CashInputs {
  return {
    month: "2026-09",
    asOf: "2026-09-30",
    accounts: new Map([[A1, { code: "1101.00", name: "Банк" }]]),
    records: [
      rec("d1", "2026-09-10", SAL, A1, 1000, `${NAME} цалин`),
      rec("d2", "2026-09-10", SAL, A1, 500, `Зөвлөх цалин ${NAME}`),
      rec("d3", "2026-09-11", NDSH, A1, 200, "НДШ"),
      rec("d4", "2026-09-12", AP, A1, 300, "Нийлүүлэгч", P1),
      rec("d5", "2026-09-13", A1, AP, 50, "Буцаалт", P1),
    ],
    opening: [bal(5000)],
    closing: [bal(5000 - 1000 - 500 - 200 - 300 + 50)],
    names: {
      banks: new Map(),
      flows: new Map(),
      parties: new Map([[P1, "Бета ХХК"]]),
      chart: new Map([[A1, { code: "1101.00", name: "Банк" }], [SAL, { code: "3342.00", name: "Цалингийн өглөг" }], [NDSH, { code: "3450.00", name: "НДШ-ийн өглөг" }], [AP, { code: "3101.00", name: "Өглөг" }]]),
    },
  };
}

describe("redactCash: цалингийн эрхгүй хүнд хүний нэр 0, нийт дүн ижил", () => {
  const full = buildCash(cashInputs());
  const red = redactCash(full);

  it("эрхтэйд (бүрэн) memo харагдана; эрхгүйд нэр огт гарахгүй", () => {
    expect(JSON.stringify(full)).toContain(NAME);
    expect(JSON.stringify(red)).not.toContain(NAME);
    expect(JSON.stringify(red)).not.toContain("цалин "); // memo-ийн хэсэг ч үгүй
  });

  it("нийт дүн, үлдэгдэл, тулгалт, бичилтийн тоо өөрчлөгдөхгүй", () => {
    expect(red.totals).toEqual(full.totals);
    expect(red.accounts).toEqual(full.accounts);
    expect(red.daily).toEqual(full.daily);
    expect(red.totals).toMatchObject({ outflow: 2000, inflow: 50, difference: 0 });
  });

  it("цалингийн мөрүүд өдөр, данс бүрээр нэг «Цалин олголт (нэгтгэсэн)» мөр: дүнгийн нийлбэр ижил, баримт нээх лавлагаа байхгүй", () => {
    const pay = red.recent.filter((e) => e.counterpart === PAYROLL_LABEL);
    expect(pay.map((e) => [e.date, e.amount, e.ref, e.docType, e.memo])).toEqual([["2026-09-11", 200, "", "", ""], ["2026-09-10", 1500, "", "", ""]]);
    expect(red.recent.filter((e) => e.counterpart !== PAYROLL_LABEL).map((e) => e.amount).sort((a, b) => a - b)).toEqual([50, 300]);
    const sum = (r: typeof full) => r.recent.reduce((s, e) => s + (e.type === "outflow" ? e.amount : -e.amount), 0);
    expect(sum(red)).toBe(sum(full));
  });

  it("харьцсан талуудын жагсаалтад цалин нэг мөр; нийлбэр ижил", () => {
    expect(red.byCounterpart.filter((c) => c.name === PAYROLL_LABEL)).toEqual([{ key: "payroll", name: PAYROLL_LABEL, account: "", inflow: 0, outflow: 1700 }]);
    expect(red.byCounterpart.some((c) => /Цалингийн өглөг|НДШ/.test(c.name))).toBe(false);
    const total = (r: typeof full) => r.byCounterpart.reduce((s, c) => s + c.inflow + c.outflow, 0);
    expect(total(red)).toBe(total(full));
  });
});

const card = (over: Partial<DocCard>): DocCard => ({
  kind: "other", type: "СписаниеСРасчетногоСчета", ref: "", number: "", date: "2026-09-10T10:00:00", label: "Банкны зарлага", tone: "out" as DocCard["tone"],
  party: "", partyCode: "", warehouse: "", warehouseCode: "", warehouseTo: "", warehouseToCode: "", amount: 0, lines: null, comment: "", ...over,
});

describe("redactPayrollCards", () => {
  const cards = [
    card({ ref: "r1", number: "БЗ-1", amount: 1000, comment: `${NAME} цалин`, party: NAME }),
    card({ ref: "r2", number: "БЗ-2", amount: 500, comment: "цалин" }),
    card({ ref: "r3", number: "БЗ-3", amount: 300, comment: "Нийлүүлэгч", party: "Бета ХХК" }),
    card({ ref: "r4", number: "БЗ-4", amount: 70, date: "2026-09-11T10:00:00", comment: "цалин" }),
  ];
  const out = redactPayrollCards(cards, new Set(["r1", "r2", "r4"]));

  it("цалингийн баримтууд өдөр, төрлөөр нэгдэнэ; нэр, дугаар, лавлагаа, коммент гарахгүй; бусад баримт хэвээр", () => {
    expect(out).toHaveLength(3);
    expect(JSON.stringify(out)).not.toContain(NAME);
    const pay = out.filter((c) => c.party === PAYROLL_LABEL);
    expect(pay.map((c) => [c.date.slice(0, 10), c.amount, c.ref, c.number, c.comment])).toEqual([["2026-09-11", 70, "", "", ""], ["2026-09-10", 1500, "", "", ""]]);
    expect(out.find((c) => c.ref === "r3")).toMatchObject({ party: "Бета ХХК", comment: "Нийлүүлэгч" });
  });

  it("нийт дүн өөрчлөгдөхгүй; эх картуудыг өөрчлөхгүй (cache-д хадгалагдсан)", () => {
    expect(out.reduce((s, c) => s + c.amount, 0)).toBe(cards.reduce((s, c) => s + c.amount, 0));
    expect(cards[0].comment).toContain(NAME);
    expect(cards[0].amount).toBe(1000);
  });
});

describe("redactPayrollDetail", () => {
  it("харилцагч, гүйлгээний утга, коммент, хариуцагч гарахгүй; дүн, дугаар, огноо хэвээр", () => {
    const detail = {
      type: "СписаниеСРасчетногоСчета", ref: "r1", kind: "bank_out" as const, label: "Банкны зарлага", tone: "out" as const, number: "БЗ-1", date: "2026-09-10T10:00:00", posted: true,
      fields: [{ label: "Харилцагч", value: NAME }, { label: "Гүйлгээний утга", value: `${NAME} цалин` }, { label: "Хариуцагч", value: NAME }],
      comment: `${NAME} цалин`, lines: [], totals: { amount: 0, vat: 0, total: 1000, vatIncluded: null, qty: 0 },
      postings: [{ n: 1, debit: { name: "Цалингийн өглөг", code: "3342" }, credit: { name: "Банк", code: "1101" }, amount: 1000, qty: null, memo: PAYROLL_LABEL }], costFromLedger: false,
    };
    const out = redactPayrollDetail(detail);
    expect(JSON.stringify(out)).not.toContain(NAME);
    expect(out).toMatchObject({ number: "БЗ-1", totals: { total: 1000 }, comment: "", fields: [{ label: "Төрөл", value: PAYROLL_LABEL }] });
    expect(out.postings[0].amount).toBe(1000);
  });
});
