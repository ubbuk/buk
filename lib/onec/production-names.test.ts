import { describe, expect, it } from "vitest";
import { normalizeDepartment, splitProductName, stageOfAccount } from "./production-names";

describe("splitProductName", () => {
  it("«Зас», «Брак» дагавар (том, жижиг үсэг, илүү зай) -> үндсэн нэр + хувилбар", () => {
    expect(splitProductName("Шон 80*80")).toEqual({ base: "Шон 80*80", variant: "main" });
    expect(splitProductName("Шон 80*80 Зас")).toEqual({ base: "Шон 80*80", variant: "repair" });
    expect(splitProductName("  БУЗ суваг Н-910   зас ")).toEqual({ base: "БУЗ суваг Н-910", variant: "repair" });
    expect(splitProductName("Шон 80*80 БРАК")).toEqual({ base: "Шон 80*80", variant: "defect" });
  });
  it("нэрийн дунд, эсвэл зөвхөн «Брак» гэсэн нэрийг хөндөхгүй", () => {
    expect(splitProductName("Засвар хийх шон")).toEqual({ base: "Засвар хийх шон", variant: "main" });
    expect(splitProductName("Брак")).toEqual({ base: "Брак", variant: "main" });
    expect(splitProductName("(брак)")).toEqual({ base: "(брак)", variant: "main" });
  });
  it("зайгүй наалдсан дагавар: «БУЗ суваг Н-810зас» -> Засвар, «…Н-810брак», «…Н-810(Зас)», том үсэг", () => {
    expect(splitProductName("БУЗ суваг Н-810зас")).toEqual({ base: "БУЗ суваг Н-810", variant: "repair" });
    expect(splitProductName("БУЗ суваг Н-810ЗАС")).toEqual({ base: "БУЗ суваг Н-810", variant: "repair" });
    expect(splitProductName("БУЗ суваг Н-810брак")).toEqual({ base: "БУЗ суваг Н-810", variant: "defect" });
    expect(splitProductName("БУЗ суваг Н-810Брак")).toEqual({ base: "БУЗ суваг Н-810", variant: "defect" });
    expect(splitProductName("БУЗ суваг Н-810(Зас)")).toEqual({ base: "БУЗ суваг Н-810", variant: "repair" });
    expect(splitProductName("БУЗ суваг Н-810 (брак)")).toEqual({ base: "БУЗ суваг Н-810", variant: "defect" });
    expect(splitProductName("Шон 80*80брак")).toEqual({ base: "Шон 80*80", variant: "defect" });
    expect(splitProductName("Дэр R-50 - зас")).toEqual({ base: "Дэр R-50", variant: "repair" });
    expect(splitProductName("Шон 80*80 БРАК.")).toEqual({ base: "Шон 80*80", variant: "defect" });
  });
  it("үсгийн дараа наалдсан (үгийн төгсгөл) болон «засвар», «засварт» бүтэн үгийг хөндөхгүй", () => {
    expect(splitProductName("Базас")).toEqual({ base: "Базас", variant: "main" });
    expect(splitProductName("Хэвний засвар /Р-50/")).toEqual({ base: "Хэвний засвар /Р-50/", variant: "main" });
    expect(splitProductName("БАЗ-3-ын тоног төхөөрөмжийн засварт")).toEqual({ base: "БАЗ-3-ын тоног төхөөрөмжийн засварт", variant: "main" });
    expect(splitProductName("Лоткины таг Л-9 эргэлтийн таг засвар")).toEqual({ base: "Лоткины таг Л-9 эргэлтийн таг засвар", variant: "main" });
  });
  it("1С-ийн 2026 оны бодит нэрс", () => {
    const v = (n: string) => splitProductName(n).variant;
    expect(v("БУЗ суваг Н-810зас")).toBe("repair");
    expect(v("БУЗ суваг Н-910 зас")).toBe("repair");
    expect(v("ПШ-22.6-4 зас")).toBe("repair");
    expect(v("Лотки СТ 9*5*30 намхан (брак)")).toBe("defect");
    expect(v("Суман шилжүүлэг R-65 1/11 *42 Брак")).toBe("defect");
    expect(v("Төмөр замын бетон дэр R-65 / Гүүрийн богино нүхтэй/ зас")).toBe("repair");
    expect(v("Лотки Л-9 Эргэлтийн зас")).toBe("repair");
    expect(v("Гүүрэн краны хэсэг засварт")).toBe("main");
    expect(v("7-р пролетийн засвар үйлчилгээ")).toBe("main");
  });
});

describe("stageOfAccount", () => {
  it("1441 бэлэн, 1431 хагас, 1401 бутлуурын түүхий эд; бусад null", () => {
    expect(stageOfAccount("1441")).toBe("finished");
    expect(stageOfAccount("1441.01")).toBe("finished");
    expect(stageOfAccount("1431")).toBe("semi");
    expect(stageOfAccount("1401")).toBe("crusher");
    expect(stageOfAccount("1421")).toBeNull();
    expect(stageOfAccount("")).toBeNull();
  });
});

describe("normalizeDepartment", () => {
  it("том/жижиг үсэг, цэг тэмдэг, зайг жигдрүүлнэ", () => {
    expect(normalizeDepartment("  Тенсиланд   хэсэг. ")).toBe("тенсиланд хэсэг");
    expect(normalizeDepartment("ТБХЦ-1")).toBe("тбхц 1");
  });
});

describe("splitProductName: хаалттай (брак) / (зас)", () => {
  it("«… (брак)», «… (Зас)» нь Брак, Зас хувилбар", () => {
    expect(splitProductName("Лотки СТ 9*5*30 намхан (брак)")).toEqual({ base: "Лотки СТ 9*5*30 намхан", variant: "defect" });
    expect(splitProductName("Шон 80*80 (Зас)")).toEqual({ base: "Шон 80*80", variant: "repair" });
    expect(splitProductName("Шон (брак) 80*80")).toEqual({ base: "Шон (брак) 80*80", variant: "main" });
  });
});
