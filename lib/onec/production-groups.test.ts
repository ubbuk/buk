import { describe, expect, it } from "vitest";
import { groupFor, groupRank, isSemiGroup, OTHER_GROUP, PRODUCTION_GROUPS } from "./production-groups";

describe("PRODUCTION_GROUPS (картуудын тохиргоо)", () => {
  it("анхдагч картууд, дарааллаараа", () => {
    expect(PRODUCTION_GROUPS.map((g) => g.name)).toEqual([
      "Бетон дэрний хэсэг",
      "Төмөр бетон хийц эдлэлийн цех",
      "Тенсиланд хэсэг",
      "Вольтамиксийн хэсэг",
      "Бетон зуурмаг (БАЗ-3, БАЗ-4)",
      "Арматурын хэсэг",
      "Бутлан ангилах үйлдвэр",
      "Металл хийц",
    ]);
  });

  it("хэлтэс нэг картанд нэг л удаа (давхар тохиргоо байхгүй)", () => {
    const all = PRODUCTION_GROUPS.flatMap((g) => g.departments.map((d) => d.toLowerCase().replace(/\s+/g, " ")));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("groupFor (1С-ийн хэлтэс -> карт)", () => {
  it("«Төмөр замын төмөр бетон дэрний хэсэг» -> «Бетон дэрний хэсэг»", () => {
    expect(groupFor("Төмөр замын төмөр бетон дэрний хэсэг")).toEqual({ name: "Бетон дэрний хэсэг", configured: true, semi: false });
  });

  it("давхардсан бичлэг (1С-ийн лавлахад ижил нэртэй ×3) нэг картанд: том/жижиг үсэг, илүү зай, цэг тэмдэг үл тооно", () => {
    const names = ["Төмөр замын төмөр бетон дэрний хэсэг", "төмөр замын төмөр бетон  дэрний хэсэг ", "ТӨМӨР ЗАМЫН ТӨМӨР БЕТОН ДЭРНИЙ ХЭСЭГ."];
    expect(new Set(names.map((n) => groupFor(n).name))).toEqual(new Set(["Бетон дэрний хэсэг"]));
    expect(groupFor("Төмөр бетон хийц эдлэлийн цех").name).toBe("Төмөр бетон хийц эдлэлийн цех");
    expect(groupFor("Төмөр бетон хийц эдлэлийн цех ").name).toBe("Төмөр бетон хийц эдлэлийн цех");
  });

  it("БАЗ-3, БАЗ-4 нэг «Бетон зуурмаг» картанд, хагас боловсруулсан гэж тэмдэглэгдэнэ", () => {
    expect(groupFor("БАЗ-3")).toEqual({ name: "Бетон зуурмаг (БАЗ-3, БАЗ-4)", configured: true, semi: true });
    expect(groupFor("БАЗ-4").name).toBe("Бетон зуурмаг (БАЗ-3, БАЗ-4)");
    expect(isSemiGroup("Бетон зуурмаг (БАЗ-3, БАЗ-4)")).toBe(true);
    expect(isSemiGroup("Тенсиланд хэсэг")).toBe(false);
  });

  it("1С-ийн Parent-д найддаггүй: ТБХЭЦ-ийн дэд хэлтэс (Тенсиланд, Вольтамикс) өөр өөрийн карт", () => {
    expect(groupFor("Тенсиланд хэсэг").name).toBe("Тенсиланд хэсэг");
    expect(groupFor("Вольтамиксийн хэсэг").name).toBe("Вольтамиксийн хэсэг");
    expect(groupFor("Металл хийц үйлдвэрлэлийн цех").name).toBe("Металл хийц");
  });

  it("тохиргоонд байхгүй хэлтэс «Бусад»", () => {
    expect(groupFor("Жижиг бетон эдлэлийн үйлдвэр")).toEqual({ name: OTHER_GROUP, configured: false, semi: false });
    expect(groupFor("").name).toBe(OTHER_GROUP);
  });
});

describe("groupRank", () => {
  it("тохиргооны дараалал, «Бусад» хамгийн сүүлд", () => {
    expect(groupRank("Бетон дэрний хэсэг")).toBe(0);
    expect(groupRank("Металл хийц")).toBe(PRODUCTION_GROUPS.length - 1);
    expect(groupRank(OTHER_GROUP)).toBe(PRODUCTION_GROUPS.length);
  });
});
