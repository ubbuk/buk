import { describe, expect, it } from "vitest";
import { canViewMonitoring } from "./access";
import { createdAtFilter, parseRangeKey, resolveRange, startOfDayUB } from "./time";

describe("Asia/Ulaanbaatar time helpers", () => {
  it("starts the day at 00:00 UB (UTC+8), not UTC midnight", () => {
    // 2026-11-03 20:00Z is already 04:00 on Nov 4 in Ulaanbaatar.
    expect(startOfDayUB(new Date("2026-11-03T20:00:00Z")).toISOString()).toBe("2026-11-03T16:00:00.000Z");
    // 2026-11-03 10:00Z is 18:00 on Nov 3 in Ulaanbaatar.
    expect(startOfDayUB(new Date("2026-11-03T10:00:00Z")).toISOString()).toBe("2026-11-02T16:00:00.000Z");
    // Exactly at UB midnight.
    expect(startOfDayUB(new Date("2026-11-02T16:00:00Z")).toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });

  it("resolves ranges as whole UB days ending after 'today'", () => {
    const asOf = new Date("2026-11-03T10:00:00Z");
    const r7 = resolveRange("7d", asOf);
    expect(r7.from?.toISOString()).toBe("2026-10-27T16:00:00.000Z"); // Oct 28 00:00 UB = 7 days incl. today
    expect(r7.to.toISOString()).toBe("2026-11-03T16:00:00.000Z"); // end of Nov 3 UB
    expect(resolveRange("all", asOf).from).toBeNull();
    expect(createdAtFilter(resolveRange("all", asOf))).toEqual({ lt: r7.to });
  });

  it("falls back to 30d for unknown range keys", () => {
    expect(parseRangeKey("nonsense")).toBe("30d");
    expect(parseRangeKey(null)).toBe("30d");
    expect(parseRangeKey("90d")).toBe("90d");
  });
});

describe("monitoring access", () => {
  it("allows only ADMIN and DIRECTOR", () => {
    expect(canViewMonitoring("ADMIN")).toBe(true);
    expect(canViewMonitoring("DIRECTOR")).toBe(true);
    for (const role of ["BOSS", "MANAGER", "STOREKEEPER", "EMPLOYEE", "ENGINEERING", "CHIEF_ACCOUNTANT", "", undefined, null]) {
      expect(canViewMonitoring(role as string | undefined)).toBe(false);
    }
  });
});
