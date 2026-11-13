import { describe, expect, it } from "vitest";
import { changePct, expenseGroupLabel } from "./expense-groups";

describe("зардлын бүлгийн нэр", () => {
  it("1С-ийн кодыг монгол нэрээр, үл мэдэгдэх/хоосон бүлгийг «Бусад»", () => {
    expect(expenseGroupLabel("cogs")).toBe("Борлуулсан бүтээгдэхүүний өртөг");
    expect(expenseGroupLabel("admin")).toBe("Удирдлагын зардал");
    expect(expenseGroupLabel(" COGS ")).toBe("Борлуулсан бүтээгдэхүүний өртөг");
    for (const raw of ["", null, undefined, "whatever", "constructor", "__proto__"]) expect(expenseGroupLabel(raw as string), String(raw)).toBe("Бусад");
  });
});

describe("өмнөх сартай харьцуулсан өөрчлөлт", () => {
  it("өсөлт, бууралт, тэг, өмнөх нь 0 (тодорхойгүй)", () => {
    expect(changePct(125, 100)).toBe(25);
    expect(changePct(50, 100)).toBe(-50);
    expect(changePct(100, 100)).toBe(0);
    expect(changePct(100, 0)).toBeNull();
    expect(changePct(0, 0)).toBeNull();
    expect(changePct(1, 3)).toBe(-66.7);
  });
});
