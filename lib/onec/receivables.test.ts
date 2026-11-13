import { describe, expect, it } from "vitest";
import { asOfDate } from "./dates";
import { buildReceivables, fromSnapshotRows, stageRows } from "./receivables";

const MAIN = "a1a1a1a1-0000-0000-0000-000000000001";
const VAT = "a2a2a2a2-0000-0000-0000-000000000002";
const VAT2 = "a3a3a3a3-0000-0000-0000-000000000003";
const PROVISION = "a4a4a4a4-0000-0000-0000-000000000004";
const A = "c1c1c1c1-0000-0000-0000-00000000000a";
const B = "c2c2c2c2-0000-0000-0000-00000000000b";
const C = "c3c3c3c3-0000-0000-0000-00000000000c";

const accounts = new Map([
  [MAIN, { code: "1201.00", name: "Байгууллагаас авах авлага" }],
  [VAT, { code: "1271.00", name: "НӨАТ-н авлага" }],
  [VAT2, { code: "1272.00", name: "НӨАТ-н авлага - Гаалийн" }],
  [PROVISION, { code: "1209.00", name: "Найдваргүй авлагын хасагдуулга" }],
]);
const names = new Map([[A, "Альфа"], [B, "Бета"]]);
const bal = (acc: string, cust: string, amount: number, type = "StandardODATA.Catalog_Контрагенты") => ({ Account_Key: acc, ExtDimension1: cust, ExtDimension1_Type: type, СуммаBalance: amount });

describe("buildReceivables (цэвэр нэгтгэл)", () => {
  const r = buildReceivables({
    asOf: "2026-10-31",
    accounts,
    names,
    balances: [bal(MAIN, A, 600), bal(MAIN, A, 100), bal(MAIN, B, 300), bal(MAIN, C, -40), bal(VAT, A, 70), bal(VAT2, B, 30), bal(PROVISION, A, -500)],
  });

  it("1201: харилцагч бүрийн үлдэгдэл нийлбэрлэгдэж, өртэй нь эхэнд (хэмжээгээр), урьдчилж төлсөн нь сүүлд", () => {
    expect(r.customers.map((c) => [c.name, c.balance])).toEqual([["Альфа", 700], ["Бета", 300], ["Тодорхойгүй", -40]]);
    expect(r.customers[0].share).toBe(70);
    expect(r.customers[2].share).toBe(0);
  });

  it("нийт нь 1201 (цэвэр), НӨАТ-ын данс (1271, 1272) тусдаа, 1209 тооцогдохгүй", () => {
    expect(r.totals).toEqual({ receivable: 960, debit: 1000, credit: 40, customers: 3, debtors: 2, vat: 100 });
    expect(r.accounts).toEqual([
      { code: "1201", name: "Байгууллагаас авах авлага", balance: 960, customers: 3 },
      { code: "1271", name: "НӨАТ-н авлага", balance: 70, customers: 1 },
      { code: "1272", name: "НӨАТ-н авлага - Гаалийн", balance: 30, customers: 1 },
    ]);
  });

  it("Топ 10 нь зөвхөн өртэй харилцагчид, ихээс нь", () => {
    expect(r.top.map((c) => c.name)).toEqual(["Альфа", "Бета"]);
  });

  it("11-ээс олон өртэй харилцагчаас 10-ыг л авна", () => {
    const many = Array.from({ length: 15 }, (_, i) => bal(MAIN, `c${String(i).padStart(7, "0")}-0000-0000-0000-000000000000`, 100 + i));
    expect(buildReceivables({ asOf: "2026-10-31", accounts, names: new Map(), balances: many }).top).toHaveLength(10);
  });

  it("харилцагч биш (ExtDimension1 өөр төрөл), мэдэгдэхгүй данс, 0 үлдэгдлийг тоолохгүй; техникийн нэр гарахгүй", () => {
    const x = buildReceivables({ asOf: "2026-10-31", accounts, names, balances: [bal(MAIN, A, 50, "StandardODATA.Catalog_Организации"), bal("ffffffff-0000-0000-0000-000000000000", A, 9), bal(MAIN, B, 0), bal(MAIN, A, 10)] });
    expect(x.totals.receivable).toBe(10);
    expect(x.customers).toHaveLength(1);
    expect(JSON.stringify(r)).not.toMatch(/Catalog_|_Key|StandardODATA/);
  });

  it("хоосон хариу", () => {
    const x = buildReceivables({ asOf: "2026-10-31", accounts, names, balances: [] });
    expect(x).toMatchObject({ totals: { receivable: 0, customers: 0 }, accounts: [], customers: [], top: [] });
  });
});

describe("агшин зураг: данс бүрийн шатлалт татаалт Postgres-д хадгалагдаад буцаж уншигдахад ижил тайлан гарна", () => {
  const balances = [bal(MAIN, A, 600), bal(MAIN, A, 100), bal(MAIN, B, 300), bal(MAIN, C, -40), bal(MAIN, B, 0), bal(VAT, A, 70), bal(VAT, B, 5), bal(VAT2, B, 30)];
  const direct = buildReceivables({ asOf: "2026-10-31", accounts, names, balances });
  const stage = (acc: string, code: string) => stageRows(code, accounts.get(acc)!.name, balances.filter((r) => r.Account_Key === acc), names);
  const rows = [...stage(MAIN, "1201"), ...stage(VAT2, "1272"), ...stage(VAT, "1271")];

  it("fromSnapshotRows(stageRows…) нь buildReceivables-тай тэнцүү (дарааллаас үл хамаарна)", () => {
    expect(fromSnapshotRows("2026-10-31", rows)).toEqual(direct);
    expect(fromSnapshotRows("2026-10-31", [...rows].reverse())).toEqual(direct);
  });

  it("НӨАТ-ын данс нэг мөр (харилцагчийн тоотой), 1201 харилцагч бүрээр", () => {
    expect(rows.filter((r) => r.accountCode === "1271")).toEqual([{ accountCode: "1271", accountName: "НӨАТ-н авлага", customerKey: "", customer: "", balance: 75, customers: 2 }]);
    expect(rows.filter((r) => r.accountCode === "1201").map((r) => [r.customer, r.balance])).toEqual([["Альфа", 700], ["Бета", 300], ["", -40]]);
  });

  it("зөвхөн 1271 бичигдсэн (1201 хараахан ирээгүй) үед ч тайлан гарна, 1201 нь 0", () => {
    const r = fromSnapshotRows("2026-10-31", stage(VAT, "1271"));
    expect(r.totals).toMatchObject({ receivable: 0, customers: 0, vat: 75 });
  });

  it("данс хоосон бол 0-тэй тэмдэглэгээ мөр (агшин зураг байхгүй гэж андуурахгүй)", () => {
    expect(stageRows("1201", "Авлага", [], names)).toEqual([{ accountCode: "1201", accountName: "Авлага", customerKey: "", customer: "", balance: 0, customers: 0 }]);
    expect(fromSnapshotRows("2026-10-31", stageRows("1201", "Авлага", [], names)).totals.receivable).toBe(0);
  });
});

describe("asOfDate: сарын эцсийн өдрийн үлдэгдэл", () => {
  it("одоогийн сар бол өнөөдөр, өнгөрсөн сар бол сарын сүүлийн өдөр (хоёрдугаар сар, оны ялгаа)", () => {
    expect(asOfDate("2026-11", "2026-11-13")).toBe("2026-11-13");
    expect(asOfDate("2026-10", "2026-11-13")).toBe("2026-10-31");
    expect(asOfDate("2026-02", "2026-11-13")).toBe("2026-02-28");
    expect(asOfDate("2024-02", "2026-11-13")).toBe("2024-02-29");
    expect(asOfDate("2025-12", "2026-01-01")).toBe("2025-12-31");
  });
});
