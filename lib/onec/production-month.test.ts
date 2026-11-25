import { describe, expect, it } from "vitest";
import { daysOfMonth, isWeekend, resolveMonth, shiftMonth } from "./production-month";

const CURRENT = "2026-11";

describe("resolveMonth: сар байхгүй/буруу бол ЗАВААЛ энэ сар", () => {
  it("хүчинтэй сар (өнгөрсөн, энэ сар) хэвээр", () => {
    expect(resolveMonth("2026-10", CURRENT)).toBe("2026-10");
    expect(resolveMonth("2026-11", CURRENT)).toBe("2026-11");
    expect(resolveMonth("2025-01", CURRENT)).toBe("2025-01");
  });
  it("байхгүй, буруу, ирээдүй: энэ сар", () => {
    expect(resolveMonth(null, CURRENT)).toBe(CURRENT);
    expect(resolveMonth(undefined, CURRENT)).toBe(CURRENT);
    expect(resolveMonth("", CURRENT)).toBe(CURRENT);
    expect(resolveMonth("2026-13", CURRENT)).toBe(CURRENT);
    expect(resolveMonth("2026-11-05", CURRENT)).toBe(CURRENT);
    expect(resolveMonth("2026-12", CURRENT)).toBe(CURRENT);
  });
});

describe("shiftMonth (◀ ▶)", () => {
  it("өмнөх / дараах сар, оны хил давна", () => {
    expect(shiftMonth("2026-11", -1, CURRENT)).toBe("2026-10");
    expect(shiftMonth("2026-01", -1, CURRENT)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1, CURRENT)).toBe("2026-01");
  });
  it("ирээдүй рүү шилжихгүй (null)", () => {
    expect(shiftMonth("2026-11", 1, CURRENT)).toBeNull();
    expect(shiftMonth("2026-10", 1, CURRENT)).toBe("2026-11");
  });
});

describe("daysOfMonth, isWeekend", () => {
  it("сарын бүх өдөр (28, 29, 30, 31)", () => {
    expect(daysOfMonth("2026-11")).toHaveLength(30);
    expect(daysOfMonth("2026-11")[0]).toBe("2026-11-01");
    expect(daysOfMonth("2026-11").at(-1)).toBe("2026-11-30");
    expect(daysOfMonth("2026-10")).toHaveLength(31);
    expect(daysOfMonth("2026-02")).toHaveLength(28);
    expect(daysOfMonth("2028-02")).toHaveLength(29);
  });
  it("Бямба, Ням амралт; бусад ажлын өдөр (2026-11-01 = Ням)", () => {
    expect(isWeekend("2026-11-01")).toBe(true); // Ням
    expect(isWeekend("2026-11-02")).toBe(false); // Даваа
    expect(isWeekend("2026-11-07")).toBe(true); // Бямба
    expect(isWeekend("2026-11-06")).toBe(false); // Баасан
  });
});
