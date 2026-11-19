import { describe, expect, it } from "vitest";
import type { CashEntry, CashResult } from "./cash";
import { buildCashReport, filterEntries, paginate, parseQuery, withCategories } from "./cash-report";

let n = 0;
const entry = (over: Partial<CashEntry>): CashEntry => ({
  id: `e${++n}`,
  date: "2026-11-17",
  type: "outflow",
  account: "5003636128, ХААН банк, MNT",
  counterpart: "Бета ХХК",
  article: "",
  memo: "",
  document: "Банкны зарлага",
  docType: "СписаниеСРасчетногоСчета",
  ref: `ref${n}`,
  amount: 1000,
  counterAccount: "3101",
  counterAccountName: "Дансны өглөг (Бэлтгэн нийлүүлэгч)",
  ...over,
});

const cash = (entries: CashEntry[], transfers: CashEntry[] = []): CashResult => ({
  month: "2026-11",
  asOf: "2026-11-19",
  totals: { opening: 0, inflow: 0, outflow: 0, internal: transfers.reduce((s, t) => s + t.amount, 0), closing: 0, expectedClosing: 0, difference: 0, entries: entries.length + transfers.length },
  accounts: [],
  daily: [],
  payroll: { inflow: 0, outflow: 0, byDay: [] },
  byCounterpart: [],
  transfers,
  recent: [],
  entries,
});

describe("buildCashReport: ангилал, харилцагчаар задрал", () => {
  const entries = [
    entry({ type: "inflow", counterpart: "Альфа ХХК", counterAccount: "3201", amount: 600 }),
    entry({ type: "inflow", counterpart: "Гамма ХХК", counterAccount: "1201", amount: 200 }),
    entry({ type: "inflow", counterpart: "Хүүний орлого", counterAccount: "5131", amount: 200 }),
    entry({ counterpart: "Бета ХХК", amount: 300 }),
    entry({ counterpart: "Бета ХХК", amount: 100 }),
    entry({ counterpart: "Дельта ХХК", amount: 50, counterAccount: "3101" }),
    entry({ counterpart: "Татварын газар", counterAccount: "3465", amount: 500 }),
  ];
  const c = cash(entries, [entry({ type: "internal", counterpart: "ХААН банк 2", amount: 1_000_000, counterAccount: "" })]);
  const report = buildCashReport(c, withCategories(entries, [], true));

  it("орж ирсэн нь ангилалаар, том нь эхэлж, «Бусад» хамгийн сүүлд", () => {
    expect(report.inflow.total).toBe(1000);
    expect(report.inflow.categories.map((x) => [x.id, x.total])).toEqual([
      ["sales", 800],
      ["other", 200],
    ]);
    expect(report.inflow.categories[0].share).toBeCloseTo(0.8);
    expect(report.otherShare.inflow).toBeCloseTo(0.2);
  });

  it("гарсан нь ангилал, харилцагчаар задарна (нэг харилцагчийн гүйлгээ нийлнэ)", () => {
    const sup = report.outflow.categories.find((x) => x.id === "suppliers")!;
    expect(sup.total).toBe(450);
    expect(sup.parties).toEqual([
      { name: "Бета ХХК", total: 400, count: 2 },
      { name: "Дельта ХХК", total: 50, count: 1 },
    ]);
    expect(report.outflow.categories.find((x) => x.id === "tax")!.total).toBe(500);
  });

  it("дотоод шилжүүлэг тусад нь, орлого зарлагад орохгүй", () => {
    expect(report.internal).toMatchObject({ total: 1_000_000, count: 1 });
    expect(report.inflow.total + report.outflow.total).toBe(1950);
  });

  it("8-аас олон харилцагчийг «бусад N харилцагч» болгоно", () => {
    const many = Array.from({ length: 12 }, (_, i) => entry({ counterpart: `Х${i}`, amount: 100 + i }));
    const r = buildCashReport(cash(many), withCategories(many, [], true));
    const sup = r.outflow.categories[0];
    expect(sup.parties).toHaveLength(8);
    expect(sup.moreParties.count).toBe(4);
    expect(sup.parties.reduce((s, p) => s + p.total, 0) + sup.moreParties.total).toBe(sup.total);
  });
});

describe("цалингийн нууцлал", () => {
  const SECRET = "Дорж Болд цалин 9 сар";
  const entries = [
    entry({ counterpart: "Дорж Болд", memo: SECRET, counterAccount: "3342", counterAccountName: "Цалингийн өглөг", amount: 700, payroll: true }),
    entry({ counterpart: "Саран Цэцэг", memo: SECRET, counterAccount: "3342", amount: 300, payroll: true }),
    entry({ counterpart: "Бета ХХК", amount: 50 }),
  ];

  it("эрхгүй: нэр, утга, данс, баримт гарахгүй, нийт дүн ба ангилал ижил", () => {
    const rows = withCategories(entries, [], false);
    const json = JSON.stringify(rows);
    expect(json).not.toContain("Дорж");
    expect(json).not.toContain("Саран");
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("3342");
    const payroll = rows.filter((r) => r.payroll);
    expect(payroll).toHaveLength(1); // өдөр/данс/ангилалаар нэг мөр
    expect(payroll[0]).toMatchObject({ amount: 1000, counterpart: "Цалин олголт (нэгтгэсэн)", docType: "", ref: "", category: "payroll" });
    const report = buildCashReport(cash(entries), rows);
    expect(report.outflow.categories.find((c) => c.id === "payroll")!.total).toBe(1000);
    expect(JSON.stringify(report)).not.toContain("Дорж");
  });

  it("эрхтэй: бүгд харагдана", () => {
    const rows = withCategories(entries, [], true);
    expect(rows.filter((r) => r.payroll)).toHaveLength(2);
    expect(JSON.stringify(rows)).toContain("Дорж Болд");
  });

  it("эрхгүй хүн цалингийн гүйлгээг утгаар нь хайж олохгүй", () => {
    const rows = withCategories(entries, [], false);
    expect(filterEntries(rows, { q: "Дорж" })).toHaveLength(0);
    expect(filterEntries(rows, { q: "цалин олголт" })).toHaveLength(1);
  });
});

describe("parseQuery / filterEntries: харилцагч, утга, дүн, огноо", () => {
  const rows = withCategories(
    [
      entry({ date: "2026-11-17", counterpart: "Гамма ХХК", memo: "Захиалга 15 төлбөр", amount: 84_073_015.25 }),
      entry({ date: "2026-11-17", counterpart: "Бета ХХК", memo: "тээвэр", amount: 84_900_000 }),
      entry({ date: "2026-11-13", counterpart: "Бета ХХК", memo: "түрээс", amount: 1_186_176_000, type: "inflow", counterAccount: "3201" }),
      entry({ date: "2026-11-19", counterpart: "Дельта", memo: "", amount: 165_000 }),
    ],
    [],
    true
  );

  it("«84 сая» нь 84.0–84.99 сая-ыг олно; «84.1 сая» нарийвчилна", () => {
    expect(filterEntries(rows, { q: "84 сая" }).map((r) => r.counterpart)).toEqual(["Бета ХХК", "Гамма ХХК"]); // өдөр ижил бол том дүн түрүүлнэ
    expect(filterEntries(rows, { q: "84.1 сая" })).toHaveLength(0);
    expect(filterEntries(rows, { q: "84.0 сая" }).map((r) => r.counterpart)).toEqual(["Гамма ХХК"]);
    expect(filterEntries(rows, { q: "1.18 тэрбум" })).toHaveLength(1);
  });

  it("тоо: 84073015, 84,073,015.25, 165000", () => {
    expect(filterEntries(rows, { q: "84073015" })).toHaveLength(1);
    expect(filterEntries(rows, { q: "84,073,015.25" })).toHaveLength(1);
    expect(filterEntries(rows, { q: "165000" })).toHaveLength(1);
    expect(filterEntries(rows, { q: "84073016" })).toHaveLength(0);
  });

  it("огноо: 2026-11-17 ба 11-17", () => {
    expect(filterEntries(rows, { q: "2026-11-17" })).toHaveLength(2);
    expect(filterEntries(rows, { q: "11-13" })).toHaveLength(1);
    expect(filterEntries(rows, { q: "11-19" })).toHaveLength(1);
  });

  it("үг: харилцагч, утга, ангилал; бүх үг таарна; хослуулж болно", () => {
    expect(filterEntries(rows, { q: "бета" })).toHaveLength(2);
    expect(filterEntries(rows, { q: "захиалга төлбөр" })).toHaveLength(1);
    expect(filterEntries(rows, { q: "борлуулалтын орлого" })).toHaveLength(1); // ангиллын нэрээр
    expect(filterEntries(rows, { q: "бета 84 сая" })).toHaveLength(1);
    expect(filterEntries(rows, { q: "   " })).toHaveLength(4);
  });

  it("чиглэл, ангилал, харилцагчийн шүүлт", () => {
    expect(filterEntries(rows, { flow: "inflow" })).toHaveLength(1);
    expect(filterEntries(rows, { category: "suppliers", party: "Бета ХХК" })).toHaveLength(1);
  });

  it("parseQuery: 84 сая-ыг үг гэж үзэхгүй", () => {
    const p = parseQuery("гамма 84 сая 11-17");
    expect(p.words).toEqual(["гамма"]);
    expect(p.ranges).toEqual([{ min: 84e6, max: 85e6 }]);
    expect(p.dates).toEqual([{ monthDay: "11-17" }]);
  });
});

describe("200 мөрийн хязгаар байхгүй", () => {
  it("500 гүйлгээ бүгд хайгдаж, хуудаслагдана", () => {
    const many = Array.from({ length: 500 }, (_, i) => entry({ date: `2026-11-${String((i % 28) + 1).padStart(2, "0")}`, counterpart: `Харилцагч ${i}`, amount: 1000 + i }));
    const rows = withCategories(many, [], true);
    const all = filterEntries(rows, {});
    expect(all).toHaveLength(500);
    const last = paginate(all, 17, 30);
    expect(last).toMatchObject({ page: 17, pages: 17, total: 500 });
    expect(last.items).toHaveLength(20);
    expect(filterEntries(rows, { q: "харилцагч 499" })).toHaveLength(1); // 200-аас хойших мөрөнд хүртэл
    expect(paginate(all, 99, 30).page).toBe(17); // хэт том хуудас сүүлийнх рүү
  });
});
