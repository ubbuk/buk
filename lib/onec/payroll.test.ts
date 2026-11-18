import { describe, expect, it } from "vitest";
import { buildAccountBook } from "./accounts";
import { buildDepartments, buildEmployees, buildPayrollMonth, NO_DEPARTMENT, payrollContext, salaryNetMovement, UNATTRIBUTED, yearMonths } from "./payroll";

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ACC = { cash: G(1), bank: G(2), sal: G(3), ndsh: G(4), hhoat: G(5), adv: G(6), sick: G(7), wip: G(8), exp: G(9), ap: G(11) };
const book = buildAccountBook([
  { Ref_Key: ACC.cash, Code: "1001.00", Description: "Касс" },
  { Ref_Key: ACC.bank, Code: "1101.00", Description: "Банк" },
  { Ref_Key: ACC.sal, Code: "3342.00", Description: "Цалингийн өглөг" },
  { Ref_Key: ACC.ndsh, Code: "3450.00", Description: "НДШ" },
  { Ref_Key: ACC.hhoat, Code: "3462.00", Description: "ХХОАТ" },
  { Ref_Key: ACC.adv, Code: "1249.00", Description: "Суутгалын авлага" },
  { Ref_Key: ACC.sick, Code: "1295.00", Description: "Тэтгэмжийн авлага" },
  { Ref_Key: ACC.wip, Code: "1424.00", Description: "Дуусаагүй үйлдвэрлэл" },
  { Ref_Key: ACC.exp, Code: "7000.00", Description: "Үйл ажиллагааны зардал" },
  { Ref_Key: ACC.ap, Code: "3101.00", Description: "Өглөг" },
]);
const ctx = payrollContext(book);
const D1 = G(101);
const D2 = G(102);
const P1 = G(201);
const P2 = G(202);
const ZERO = "00000000-0000-0000-0000-000000000000";
const PT = "StandardODATA.Catalog_ФизическиеЛица";

const line = (dr: string, cr: string, amount: number, extra: Record<string, unknown> = {}) => ({ AccountDr_Key: dr, AccountCr_Key: cr, Сумма: amount, ...extra });

describe("buildPayrollMonth: сарын нийт дүн", () => {
  const lines = [
    line(ACC.wip, ACC.sal, 600, { ПодразделениеDr_Key: D1 }), // бодсон
    line(ACC.exp, ACC.sal, 400, { ПодразделениеDr_Key: D2 }), // бодсон
    line(ACC.sick, ACC.sal, 50), // өвчний тэтгэмж: бодсонд ороогүй
    line(ACC.adv, ACC.sal, 5), // суутгалын авлагыг буцаасан: бодсонд ороогүй
    line(ACC.cash, ACC.sal, 7), // кассаас буцаасан: бодсонд ороогүй
    line(ACC.wip, ACC.ndsh, 120), // ажил олгогчийн НДШ
    line(ACC.exp, ACC.ndsh, 30), // ажил олгогчийн НДШ
    line(ACC.sal, ACC.ndsh, 110), // суутгасан НДШ
    line(ACC.adv, ACC.ndsh, 3), // ажил олгогчийнх биш (цалингийн данснаас)
    line(ACC.sal, ACC.hhoat, 90),
    line(ACC.sal, ACC.bank, 800),
    line(ACC.sal, ACC.cash, 20),
    line(ACC.sal, ACC.adv, 40), // суутгал: олгосонд ороогүй
    line(ACC.ap, ACC.bank, 999), // цалинтай хамааралгүй
  ];

  it("бодсон, ажил олгогчийн НДШ, суутгасан НДШ, ХХОАТ, олгосон (банк, касс) тус тусад", () => {
    expect(buildPayrollMonth("2026-09", lines, ctx, 250)).toEqual({ month: "2026-09", accrued: 1000, employerNdsh: 150, employeeNdsh: 110, hhoat: 90, paidBank: 800, paidCash: 20, closingPayable: 250, lines: lines.length });
  });

  it("хоосон сар: бүгд 0", () => {
    expect(buildPayrollMonth("2026-10", [], ctx, -80)).toMatchObject({ accrued: 0, employerNdsh: 0, employeeNdsh: 0, hhoat: 0, paidBank: 0, paidCash: 0, closingPayable: -80 });
  });
});

describe("сарын эцсийн өглөг = эхний өглөг + (Кт − Дт 3342)", () => {
  it("3342-ийн цэвэр хөдөлгөөн: Кт нэмнэ, Дт хасна, хоёр тал нь 3342 бол тэг, цалингийн бус мөр орохгүй", () => {
    const lines = [line(ACC.wip, ACC.sal, 1000), line(ACC.sick, ACC.sal, 50), line(ACC.sal, ACC.bank, 800), line(ACC.sal, ACC.ndsh, 110), line(ACC.sal, ACC.sal, 40), line(ACC.ap, ACC.bank, 999)];
    expect(salaryNetMovement(lines, ctx)).toBe(1000 + 50 - 800 - 110);
  });

  it("сарын эцсийн өглөг (1С-ийн Balance-тай ижил): эхний 583 + (1184 − 1352) шиг", () => {
    const opening = 500; // сарын эхний өглөг (Кт)
    const lines = [line(ACC.wip, ACC.sal, 1000), line(ACC.sal, ACC.bank, 700), line(ACC.sal, ACC.hhoat, 90)];
    const closing = opening + salaryNetMovement(lines, ctx);
    expect(buildPayrollMonth("2026-09", lines, ctx, closing).closingPayable).toBe(710);
  });
});

describe("buildDepartments: хэлтсээр бодсон цалин", () => {
  const lines = {
    "2026-08": [line(ACC.wip, ACC.sal, 600, { ПодразделениеDr_Key: D1 }), line(ACC.sal, ACC.bank, 500)],
    "2026-09": [line(ACC.exp, ACC.sal, 400, { ПодразделениеDr_Key: D2 }), line(ACC.wip, ACC.sal, 100, { ПодразделениеDr_Key: D1 }), line(ACC.wip, ACC.sal, 7, { ПодразделениеDr_Key: ZERO })],
  };
  const r = buildDepartments("2026", ["2026-08", "2026-09"], lines, ctx, new Map([[D1, "Цех"], [D2, "Захиргаа"]]));

  it("хэлтэс бүрээр, нийт дүн сарын «бодсон»-той тэнцүү; хэлтэсгүй нь тусдаа", () => {
    expect(r.departments.map((d) => [d.name, d.total])).toEqual([["Цех", 700], ["Захиргаа", 400], [NO_DEPARTMENT, 7]]);
    expect(r.departments[0].byMonth).toEqual({ "2026-08": 600, "2026-09": 100 });
    expect(r.totals).toEqual({ "2026-08": 600, "2026-09": 507 });
    expect(buildPayrollMonth("2026-09", lines["2026-09"], ctx, 0).accrued).toBe(r.totals["2026-09"]);
  });

  it("төлбөр, суутгал, НДШ-ийн мөр орохгүй", () => {
    expect(r.totals["2026-08"]).toBe(600); // 500-ын төлбөр ороогүй
  });
});

describe("buildEmployees: ажилтнаар олгосон, үлдэгдэл, сар бүрийн задаргаа", () => {
  const months = ["2026-08", "2026-09"];
  const dim = (p: string | null) => ({ type: p ? PT : "StandardODATA.Undefined", key: p ?? ZERO });
  const dr = (cr: string, amount: number, p: string | null) => line(ACC.sal, cr, amount, { ExtDimensionDr1: dim(p).key, ExtDimensionDr1_Type: dim(p).type });
  const cr = (drAcc: string, amount: number, p: string | null) => line(drAcc, ACC.sal, amount, { ExtDimensionCr1: dim(p).key, ExtDimensionCr1_Type: dim(p).type });
  const bal = (p: string | null, v: number) => ({ Account_Key: ACC.sal, ExtDimension1: dim(p).key, ExtDimension1_Type: dim(p).type, СуммаBalance: v });
  const lines = {
    "2026-08": [cr(ACC.wip, 1000, null), cr(ACC.sick, 100, P1), dr(ACC.bank, 300, P1), dr(ACC.bank, 400, null)],
    "2026-09": [dr(ACC.bank, 200, P1), dr(ACC.cash, 50, P2), dr(ACC.adv, 20, P1), dr(ACC.ndsh, 10, null)],
  };
  // Кт үлдэгдэл = сөрөг СуммаBalance. Жилийн эхэнд P2: өглөг 100
  const opening = [bal(P2, -100)];
  // Өнөөдөр: P1 = 100 − 300 − 200 − 20 = −420 (урьдчилж олгосон), P2 = 100 − 50 = 50, тодорхойгүй = 1000 − 400 − 10 = 590
  const closingNow = [bal(P1, 420), bal(P2, -50), bal(null, -590)];
  const r = buildEmployees({ year: "2026", asOf: "2026-11-18", months, linesByMonth: lines, opening, closingNow, ctx, names: new Map([[P1, "Нэг"], [P2, "Хоёр"]]) });

  it("ажилтан бүрийн олгосон, бусад Дт, Кт, үлдэгдэл; ажилтангүй мөр «тодорхойгүй» нэг мөр (хамгийн сүүлд)", () => {
    expect(r.employees.map((e) => e.name)).toEqual(["Нэг", "Хоёр", UNATTRIBUTED]);
    const [one, two, unk] = r.employees;
    expect(one).toMatchObject({ paid: 500, credited: 100, otherDebits: 20, opening: 0, closing: -420 });
    expect(two).toMatchObject({ paid: 50, opening: 100, closing: 50 });
    expect(unk).toMatchObject({ key: "", paid: 400, credited: 1000, otherDebits: 10, closing: 590 });
  });

  it("сар бүрийн задаргаа: сарын эцсийн үлдэгдэл урсаж, сүүлийн сар = эцсийн үлдэгдэл", () => {
    const one = r.employees[0];
    expect(one.months.map((m) => [m.month, m.paid, m.credited, m.otherDebits, m.closing])).toEqual([["2026-08", 300, 100, 0, -200], ["2026-09", 200, 0, 20, -420]]);
    for (const e of r.employees) expect(e.months[e.months.length - 1].closing).toBe(e.closing);
  });

  it("нийт дүн ба 1С-ийн Balance-тай тулгалт: зөрүү 0 (өгөгдөл таарахгүй бол зөрүүг харуулна)", () => {
    expect(r.totals).toMatchObject({ opening: 100, paid: 950, closing: 220 });
    expect(r.check).toEqual({ closing1c: 220, difference: 0 });
    const off = buildEmployees({ year: "2026", asOf: "2026-11-18", months, linesByMonth: lines, opening, closingNow: [bal(P1, 400)], ctx, names: new Map() });
    expect(off.check.difference).not.toBe(0);
  });

  it("хөдөлгөөн, үлдэгдэлгүй ажилтан орохгүй; нэр олдохгүй бол «Ажилтан»", () => {
    const e = buildEmployees({ year: "2026", asOf: "2026-11-18", months, linesByMonth: { "2026-08": [], "2026-09": [] }, opening: [bal(P1, 0)], closingNow: [], ctx, names: new Map() });
    expect(e.employees).toEqual([]);
    const named = buildEmployees({ year: "2026", asOf: "2026-11-18", months, linesByMonth: { "2026-08": [dr(ACC.bank, 5, P1)], "2026-09": [] }, opening: [], closingNow: [], ctx, names: new Map() });
    expect(named.employees[0].name).toBe("Ажилтан");
  });
});

describe("yearMonths", () => {
  it("энэ жил: 1-р сараас одоогийн сар хүртэл; өнгөрсөн жил: 12 сар", () => {
    expect(yearMonths("2026", "2026-11")).toHaveLength(11);
    expect(yearMonths("2026", "2026-11")[0]).toBe("2026-01");
    expect(yearMonths("2025", "2026-11")).toHaveLength(12);
  });
});
