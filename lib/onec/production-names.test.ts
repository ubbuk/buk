import { describe, expect, it } from "vitest";
import { normalizeDepartment, splitProductName, stageOfAccount } from "./production-names";

describe("splitProductName", () => {
  it("«Зас», «Брак» дагавар (том, жижиг үсэг, илүү зай) -> үндсэн нэр + хувилбар", () => {
    expect(splitProductName("Шон 80*80")).toEqual({ base: "Шон 80*80", variant: "main" });
    expect(splitProductName("Шон 80*80 Зас")).toEqual({ base: "Шон 80*80", variant: "repair" });
    expect(splitProductName("  БУЗ суваг Н-910   зас ")).toEqual({ base: "БУЗ суваг Н-910", variant: "repair" });
    expect(splitProductName("Шон 80*80 БРАК")).toEqual({ base: "Шон 80*80", variant: "defect" });
  });
  it("нэрийн дунд, зайгүй наалдсан, эсвэл зөвхөн «Брак» гэсэн нэрийг хөндөхгүй", () => {
    expect(splitProductName("Засвар хийх шон")).toEqual({ base: "Засвар хийх шон", variant: "main" });
    expect(splitProductName("БУЗ суваг Н-810зас")).toEqual({ base: "БУЗ суваг Н-810зас", variant: "main" });
    expect(splitProductName("Брак")).toEqual({ base: "Брак", variant: "main" });
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
