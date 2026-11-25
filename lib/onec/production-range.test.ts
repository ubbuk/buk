import { describe, expect, it } from "vitest";
import { activePreset, mondayOf, monthsOfRange, parseRange, presetRange, rangeLabel, resolveRange, shiftRange } from "./production-range";

// 2026-11-25 = Лхагва
const TODAY = "2026-11-25";

describe("presetRange", () => {
  it("Өнөөдөр, Өчигдөр, Энэ 7 хоног (Даваагаас өнөөдөр), Энэ сар (1-нээс өнөөдөр)", () => {
    expect(presetRange("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(presetRange("yesterday", TODAY)).toEqual({ from: "2026-11-24", to: "2026-11-24" });
    expect(presetRange("week", TODAY)).toEqual({ from: "2026-11-23", to: TODAY });
    expect(presetRange("month", TODAY)).toEqual({ from: "2026-11-01", to: TODAY });
  });
  it("Даваа гарагт долоо хоног нэг өдөр; сарын 1-нд өчигдөр өмнөх сард", () => {
    expect(presetRange("week", "2026-11-23")).toEqual({ from: "2026-11-23", to: "2026-11-23" });
    expect(presetRange("yesterday", "2026-12-01")).toEqual({ from: "2026-11-30", to: "2026-11-30" });
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // Ням
  });
  it("activePreset: тохирох товч, гараар сонгосон бол null", () => {
    expect(activePreset(presetRange("yesterday", TODAY), TODAY)).toBe("yesterday");
    expect(activePreset(presetRange("month", TODAY), TODAY)).toBe("month");
    expect(activePreset({ from: "2026-11-10", to: "2026-11-10" }, TODAY)).toBeNull();
  });
});

describe("parseRange", () => {
  it("хүчинтэй хугацааг өөрийг нь буцаана", () => {
    expect(parseRange("2026-11-24", "2026-11-25", TODAY)).toEqual({ from: "2026-11-24", to: TODAY });
  });
  it("буруу огноо, from > to, ирээдүй, 62 хоногоос урт: null", () => {
    expect(parseRange("bad", TODAY, TODAY)).toBeNull();
    expect(parseRange(null, TODAY, TODAY)).toBeNull();
    expect(parseRange("2026-11-25", "2026-11-24", TODAY)).toBeNull();
    expect(parseRange("2026-11-25", "2026-11-26", TODAY)).toBeNull();
    expect(parseRange("2026-09-01", "2026-11-25", TODAY)).toBeNull(); // 86 хоног
    expect(parseRange("2026-09-25", "2026-11-25", TODAY)).not.toBeNull(); // яг 62 хоног
  });
});

describe("shiftRange (◀ ▶)", () => {
  it("өдөр: ±1 хоног; ирээдүй рүү шилжихгүй", () => {
    expect(shiftRange({ from: "2026-11-24", to: "2026-11-24" }, -1, TODAY)).toEqual({ from: "2026-11-23", to: "2026-11-23" });
    expect(shiftRange({ from: "2026-11-24", to: "2026-11-24" }, 1, TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(shiftRange({ from: TODAY, to: TODAY }, 1, TODAY)).toBeNull();
  });
  it("долоо хоног: ±7 хоног (Даваагаас); өнөөдрөөр таслагдана; ирээдүй байхгүй", () => {
    expect(shiftRange({ from: "2026-11-23", to: TODAY }, -1, TODAY)).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(shiftRange({ from: "2026-11-16", to: "2026-11-22" }, 1, TODAY)).toEqual({ from: "2026-11-23", to: TODAY });
    expect(shiftRange({ from: "2026-11-23", to: TODAY }, 1, TODAY)).toBeNull();
  });
  it("сар: ±1 сар (сарын эцэс, одоогийн сард өнөөдөр хүртэл)", () => {
    expect(shiftRange({ from: "2026-11-01", to: TODAY }, -1, TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(shiftRange({ from: "2026-10-01", to: "2026-10-31" }, 1, TODAY)).toEqual({ from: "2026-11-01", to: TODAY });
    expect(shiftRange({ from: "2026-11-01", to: TODAY }, 1, TODAY)).toBeNull();
    expect(shiftRange({ from: "2026-01-01", to: "2026-01-31" }, -1, TODAY)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("бусад (гараар сонгосон): хугацааны урт хэмжээгээр", () => {
    expect(shiftRange({ from: "2026-11-10", to: "2026-11-12" }, -1, TODAY)).toEqual({ from: "2026-11-07", to: "2026-11-09" });
    expect(shiftRange({ from: "2026-11-10", to: "2026-11-12" }, 1, TODAY)).toEqual({ from: "2026-11-13", to: "2026-11-15" });
  });
});

describe("rangeLabel, monthsOfRange", () => {
  it("нэг өдөр «2026-11-24», хугацаа «from – to»", () => {
    expect(rangeLabel({ from: "2026-11-24", to: "2026-11-24" })).toBe("2026-11-24");
    expect(rangeLabel({ from: "2026-11-18", to: "2026-11-24" })).toBe("2026-11-18 – 2026-11-24");
  });
  it("сарын хилийг давсан хугацаа хоёр сар", () => {
    expect(monthsOfRange({ from: "2026-10-28", to: "2026-11-03" })).toEqual(["2026-10", "2026-11"]);
    expect(monthsOfRange({ from: "2026-11-01", to: "2026-11-25" })).toEqual(["2026-11"]);
  });
});

describe("resolveRange: хугацаа байхгүй/буруу бол ЗАВААЛ «Энэ сар»", () => {
  const MONTH = { from: "2026-11-01", to: TODAY };
  it("from/to байхгүй: Энэ сар (Өнөөдөр биш)", () => {
    expect(resolveRange(null, null, TODAY)).toEqual(MONTH);
    expect(resolveRange(undefined, undefined, TODAY)).toEqual(MONTH);
    expect(activePreset(resolveRange(null, null, TODAY), TODAY)).toBe("month");
  });
  it("хагас (зөвхөн from эсвэл to), буруу огноо, ирээдүй, from > to, 62 хоногоос урт: Энэ сар", () => {
    expect(resolveRange("2026-11-24", null, TODAY)).toEqual(MONTH);
    expect(resolveRange(null, TODAY, TODAY)).toEqual(MONTH);
    expect(resolveRange("bad", "worse", TODAY)).toEqual(MONTH);
    expect(resolveRange("2026-11-25", "2026-12-30", TODAY)).toEqual(MONTH);
    expect(resolveRange("2026-11-25", "2026-11-01", TODAY)).toEqual(MONTH);
    expect(resolveRange("2026-01-01", TODAY, TODAY)).toEqual(MONTH);
  });
  it("хүчинтэй хугацааг (өдөр ч бай) хэвээр нь", () => {
    expect(resolveRange("2026-11-24", "2026-11-24", TODAY)).toEqual({ from: "2026-11-24", to: "2026-11-24" });
    expect(resolveRange("2026-10-01", "2026-10-31", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});
