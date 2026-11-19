import { describe, expect, it } from "vitest";
import type { AccountBook } from "./accounts";
import { sumStock } from "./stock-trend";

const book = { byKey: new Map([["a1", { key: "a1", code: "1401.00", name: "Түүхий эд" }], ["a2", { key: "a2", code: "1424.00", name: "Дуусаагүй үйлдвэрлэл" }]]) } as unknown as AccountBook;

describe("sumStock: сарын эцсийн нийт үлдэгдэл", () => {
  it("14xx-ийн нийлбэр, 142x (цехэд хийгдэж буй ажил) орохгүй", () => {
    expect(sumStock([{ Account_Key: "a1", СуммаBalance: 1000.5 }, { Account_Key: "A1", СуммаBalance: 200 }, { Account_Key: "a2", СуммаBalance: 99999 }, { Account_Key: "zz", СуммаBalance: 5 }], book)).toBe(1200.5);
    expect(sumStock([], book)).toBe(0);
  });
});
