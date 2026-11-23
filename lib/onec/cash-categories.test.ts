import { describe, expect, it } from "vitest";
import { categorize, CATEGORY_IDS, CATEGORY_LABEL, DEFAULT_RULES, type CashRule, type Classifiable } from "./cash-categories";

const e = (over: Partial<Classifiable>): Classifiable => ({ type: "outflow", counterAccount: "", counterAccountName: "", counterpart: "", memo: "", article: "", ...over });

describe("categorize: анхдагч дүрмүүд (бодит дансны бичилтээс)", () => {
  it("орлого: худалдан авагчийн урьдчилгаа, авлага = Борлуулалтын орлого", () => {
    expect(categorize(e({ type: "inflow", counterAccount: "3201" }))).toBe("sales");
    expect(categorize(e({ type: "inflow", counterAccount: "1201" }))).toBe("sales");
  });

  it("зарлага: нийлүүлэгчийн өглөг ба урьдчилж төлсөн = Нийлүүлэгчид (буцаалт ч мөн)", () => {
    expect(categorize(e({ counterAccount: "3101" }))).toBe("suppliers");
    expect(categorize(e({ counterAccount: "1501" }))).toBe("suppliers");
    expect(categorize(e({ type: "inflow", counterAccount: "1501" }))).toBe("suppliers");
  });

  it("цалин, татвар/НДШ дансууд", () => {
    for (const a of ["3342", "3349", "1249", "1295"]) expect(categorize(e({ counterAccount: a })), a).toBe("payroll");
    for (const a of ["3450", "3461", "3462", "3465", "3469", "9102"]) expect(categorize(e({ counterAccount: a })), a).toBe("tax");
  });

  it("цахилгаан, ус, түлш нь нийлүүлэгчийн данс (3101) дотор орсон ч нийлүүлэгчээс өмнө таарна", () => {
    expect(categorize(e({ counterAccount: "3101", counterpart: "Улаанбаатар цахилгаан түгээх сүлжээ" }))).toBe("utilities");
    expect(categorize(e({ counterAccount: "3101", memo: "9 сарын усны төлбөр" }))).toBe("utilities");
    expect(categorize(e({ counterAccount: "3101", counterpart: "Тээврийн ХХК", memo: "тээврийн үйлчилгээ" }))).toBe("suppliers");
  });

  it("банкны шимтгэл (утгаар) ба зээл (дансны нэр, утгаар)", () => {
    expect(categorize(e({ counterAccount: "7000", memo: "Гүйлгээний шимтгэл" }))).toBe("bankfee");
    expect(categorize(e({ type: "inflow", counterAccount: "4101", counterAccountName: "Богино хугацаат зээл" }))).toBe("loan");
    expect(categorize(e({ counterAccount: "3101", memo: "Зээлийн эргэн төлөлт" }))).toBe("loan");
  });

  it("«Банкны шимтгэл» зүйл ба данс хөтөлсний хураамж = банкны шимтгэл; «гаалийн хураамж» нь банкны шимтгэл БИШ (татвар)", () => {
    expect(categorize(e({ counterAccount: "7000", article: "Банкны шимтгэл", memo: "Гадаад гүйлгээний шимтгэл" }))).toBe("bankfee");
    expect(categorize(e({ counterAccount: "7000", memo: "данс хөтөлсний хураамж" }))).toBe("bankfee");
    expect(categorize(e({ counterAccount: "3101", article: "Татварын төлбөр", memo: "гаалийн хураамж Нэхэмжлэх:0221" }))).toBe("tax");
    expect(categorize(e({ counterAccount: "3101", memo: "гаалийн хураамж" }))).toBe("suppliers");
  });

  it("татвар/цалингийн данс утгаас хүчтэй: «НДШ шимтгэл» гэсэн утга банкны шимтгэл биш", () => {
    expect(categorize(e({ counterAccount: "3450", memo: "НДШ шимтгэл" }))).toBe("tax");
  });

  it("таарахгүй нь «Бусад»; дотоод шилжүүлэг үргэлж Дотоод шилжүүлэг", () => {
    expect(categorize(e({ counterAccount: "7400" }))).toBe("other");
    expect(categorize(e({ type: "inflow", counterAccount: "5131" }))).toBe("other"); // хүүгийн орлого
    expect(categorize(e({ type: "internal", counterAccount: "3101", memo: "цахилгаан" }))).toBe("internal");
  });

  it("бүх ангилал нэртэй, анхдагч дүрэм бүр хүчинтэй ангилалтай", () => {
    for (const c of CATEGORY_IDS) expect(CATEGORY_LABEL[c]).toBeTruthy();
    for (const r of DEFAULT_RULES) expect(CATEGORY_IDS).toContain(r.category);
  });
});

describe("categorize: админы дүрэм анхдагчаас өмнө, эрэмбээр", () => {
  const sup: CashRule[] = [{ direction: "OUT", field: "PARTY", pattern: "Альфа", category: "utilities", priority: 50 }];

  it("админы дүрэм анхдагчийг дарна", () => {
    expect(categorize(e({ counterAccount: "3101", counterpart: "Альфа ХХК" }))).toBe("suppliers");
    expect(categorize(e({ counterAccount: "3101", counterpart: "Альфа ХХК" }), sup)).toBe("utilities");
  });

  it("эрэмбэ бага нь түрүүлж, чиглэл таарахгүй бол алгасна, том жижиг үсэг ялгахгүй", () => {
    const rules: CashRule[] = [
      { direction: "ANY", field: "PARTY", pattern: "альфа", category: "loan", priority: 200 },
      { direction: "ANY", field: "PARTY", pattern: "АЛЬФА", category: "sales", priority: 10 },
      { direction: "IN", field: "ACCOUNT", pattern: "3101", category: "tax", priority: 1 },
    ];
    expect(categorize(e({ counterAccount: "3101", counterpart: "Альфа ХХК" }), rules)).toBe("sales");
  });

  it("хоосон үг ямар ч гүйлгээнд таарахгүй", () => {
    expect(categorize(e({ counterAccount: "7400" }), [{ direction: "ANY", field: "MEMO", pattern: "  ", category: "loan" }])).toBe("other");
  });
});
