import { describe, expect, it } from "vitest";
import { formatMoneyFull, formatMoneyShort } from "./money-short";

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
