import { describe, expect, it } from "vitest";
import { accountRef, buildAccountBook, keysWithPrefix, shortCode } from "./accounts";

const book = buildAccountBook([
  { Ref_Key: "9E80D0D3-834D-4365-BD1E-2CA238FA0D5D", Code: "1401.00", Description: "Түүхий Эд,  материал " },
  { Ref_Key: "786c877d-4c7f-4296-8066-9393ef352fcb", Code: "1415.03", Description: "Түлш шатахуун, ШТМ" },
  { Ref_Key: "09ba0282-8ea4-4d9a-bb3c-57f77483347c", Code: "6101.00", Description: "Борлуулсан барааны өртөг" },
  { Ref_Key: "", Code: "0000", Description: "түлхүүргүй: орохгүй" },
]);

describe("дансны төлөвлөгөө: нэр, код нь tooltip-д", () => {
  it("кодыг богиносгоно: 1101.00 -> 1101, дэд данс хэвээр", () => {
    expect(shortCode("1101.00")).toBe("1101");
    expect(shortCode("1415.03")).toBe("1415.03");
    expect(shortCode("1424")).toBe("1424");
  });

  it("түлхүүрийг том жижиг үсэг үл ялган олно, нэрийн давхар зайг цэвэрлэнэ", () => {
    expect(accountRef(book, "9e80d0d3-834d-4365-bd1e-2ca238fa0d5d")).toEqual({ name: "Түүхий Эд, материал", code: "1401" });
    expect(book.byCode.get("6101")?.name).toBe("Борлуулсан барааны өртөг");
    expect(book.byKey.size).toBe(3);
  });

  it("олдохгүй данс «Данс» гэж харагдана, GUID биш", () => {
    expect(accountRef(book, "00000000-0000-0000-0000-000000000000")).toEqual({ name: "Данс", code: "" });
    expect(accountRef(book, null)).toEqual({ name: "Данс", code: "" });
  });

  it("угтвараар дансууд (14xx = бараа материал)", () => {
    expect(keysWithPrefix(book, "14").sort()).toEqual(["786c877d-4c7f-4296-8066-9393ef352fcb", "9e80d0d3-834d-4365-bd1e-2ca238fa0d5d"]);
  });
});
