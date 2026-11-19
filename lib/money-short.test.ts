import { describe, expect, it } from "vitest";
import { formatAxisValue, formatMoneyFull, formatMoneyShort } from "./money-short";

describe("formatMoneyShort / formatMoneyFull", () => {
  it("сая, тэрбум, мянга хэлбэр", () => {
    expect(formatMoneyShort(84_073_015.25)).toBe("84.1 сая₮");
    expect(formatMoneyShort(1_184_609_016.62)).toBe("1.18 тэрбум₮");
    expect(formatMoneyShort(12_400)).toBe("12.4 мянга₮");
    expect(formatMoneyShort(9_500)).toBe("9,500₮");
    expect(formatMoneyShort(0)).toBe("0₮");
  });

  it("сөрөг дүн, хоосон утга", () => {
    expect(formatMoneyShort(-1_186_176_000)).toBe("−1.19 тэрбум₮");
    expect(formatMoneyShort(null)).toBe("—");
    expect(formatMoneyShort(Number.NaN)).toBe("—");
  });

  it("бүтэн дүн (дарахад)", () => {
    expect(formatMoneyFull(84_073_015.25)).toBe("84,073,015.25₮");
    expect(formatMoneyFull(-1_000_000_000)).toBe("−1,000,000,000₮");
    expect(formatMoneyFull(undefined)).toBe("—");
  });
});

describe("formatAxisValue: график тэнхлэг", () => {
  it("«40B» биш «40 тэрбум»", () => {
    expect([40e9, 2.5e9, 250e6, 12e3, 0, 800].map(formatAxisValue)).toEqual(["40 тэрбум", "2.5 тэрбум", "250 сая", "12 мянга", "0", "800"]);
    expect(formatAxisValue(-1.5e9)).toBe("−1.5 тэрбум");
  });
});
