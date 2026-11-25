import { describe, expect, it } from "vitest";
import { assignReclassDepartments, productDepartments } from "./production-reclass";

const known = [
  { product: "Төмөр замын бетон дэр", department: "Төмөр замын төмөр бетон дэрний хэсэг", quantity: 900 },
  { product: "Төмөр замын бетон дэр Зас", department: "Төмөр замын төмөр бетон дэрний хэсэг", quantity: 50 },
  { product: "Шон 80*80", department: "Тенсиланд хэсэг", quantity: 100 },
  { product: "Шон 80*80", department: "Бусад хэлтэс", quantity: 10 },
];

describe("«Дараа нь брак болсон» мөрийн цех", () => {
  it("үндсэн нэрээр (Зас/Брак/«(брак)»-гүй, том жижиг үсгийн ялгаагүй) хамгийн их гарсан цех", () => {
    const m = productDepartments(known);
    expect(m.get("төмөр замын бетон дэр")).toBe("Төмөр замын төмөр бетон дэрний хэсэг");
    expect(m.get("шон 80*80")).toBe("Тенсиланд хэсэг");
  });
  it("reclass мөрөнд цех оноож, олдоогүйг хасна; бусад мөр хэвээр", () => {
    const lines = [
      { stage: "reclass", product: "Төмөр замын бетон дэр Брак", department: "" },
      { stage: "reclass", product: "ШОН 80*80 (брак)", department: "" },
      { stage: "reclass", product: "Танигдаагүй Брак", department: "" },
      { stage: "finished", product: "Дэр", department: "X" },
    ];
    expect(assignReclassDepartments(lines, known).map((l) => [l.stage, l.department])).toEqual([
      ["reclass", "Төмөр замын төмөр бетон дэрний хэсэг"],
      ["reclass", "Тенсиланд хэсэг"],
      ["finished", "X"],
    ]);
  });
});
