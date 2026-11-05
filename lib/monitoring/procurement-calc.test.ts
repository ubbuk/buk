import { describe, expect, it } from "vitest";
import {
  computeCompletion,
  deriveStage,
  DEFAULT_THRESHOLD_HOURS,
  itemStatus,
  parseThresholdHours,
  remainingOf,
  secondsBetween,
  sumByUnit,
} from "./procurement-calc";

describe("itemStatus / remainingOf", () => {
  it("follows the procurement module's rules", () => {
    expect(itemStatus(0, 0)).toBe("NOT_REQUIRED"); // warehouse covered it
    expect(itemStatus(-1, 0)).toBe("NOT_REQUIRED");
    expect(itemStatus(10, 0)).toBe("NOT_STARTED");
    expect(itemStatus(10, 4)).toBe("PARTIAL");
    expect(itemStatus(10, 10)).toBe("COMPLETE");
    expect(itemStatus(10, 12)).toBe("COMPLETE");
  });
  it("never reports a negative or a phantom remainder", () => {
    expect(remainingOf(10, 4)).toBe(6);
    expect(remainingOf(10, 12)).toBe(0);
    expect(remainingOf(0, 0)).toBe(0);
  });
});

describe("computeCompletion", () => {
  it("returns null when nothing has to be bought", () => {
    expect(computeCompletion([])).toEqual({ percent: null, basis: "none" });
    expect(computeCompletion([{ required: 0, purchased: 0, estimatedUnitPrice: 5 }])).toEqual({ percent: null, basis: "none" });
  });

  it("never adds quantities of different units: kilograms and pieces are weighted by value", () => {
    // 100 kg x 10 = 1000 (50% bought), 2 pcs x 500 = 1000 (0% bought)  ->  25%, not (50+0)/(100+2)
    const c = computeCompletion([
      { required: 100, purchased: 50, estimatedUnitPrice: 10 },
      { required: 2, purchased: 0, estimatedUnitPrice: 500 },
    ]);
    expect(c).toEqual({ percent: 25, basis: "value" });
  });

  it("falls back to equal item weights, and says so, when an item to buy has no price", () => {
    const c = computeCompletion([
      { required: 100, purchased: 100, estimatedUnitPrice: 10 },
      { required: 2, purchased: 0, estimatedUnitPrice: null },
    ]);
    expect(c).toEqual({ percent: 50, basis: "items" });
  });

  it("ignores warehouse-covered items and caps an item at 100%", () => {
    const c = computeCompletion([
      { required: 0, purchased: 0, estimatedUnitPrice: 1 },
      { required: 10, purchased: 15, estimatedUnitPrice: 1 },
    ]);
    expect(c.percent).toBe(100);
  });
});

describe("deriveStage", () => {
  const base = { requestStatus: "PENDING_PROCUREMENT", procurementApproved: false, assignedMode: true, classified: false, requiredItems: 3, completeItems: 0 };
  it("waits for classification only in assigned mode and when something has to be bought", () => {
    expect(deriveStage(base)).toBe("AWAITING_CLASSIFICATION");
    expect(deriveStage({ ...base, assignedMode: false })).toBe("IN_PROCUREMENT");
    expect(deriveStage({ ...base, requiredItems: 0 })).toBe("IN_PROCUREMENT");
  });
  it("partial purchasing is not a stage: a started request is still IN_PROCUREMENT", () => {
    expect(deriveStage({ ...base, classified: true, completeItems: 1 })).toBe("IN_PROCUREMENT");
  });
  it("everything bought but not yet completed is READY_TO_COMPLETE", () => {
    expect(deriveStage({ ...base, classified: true, completeItems: 3 })).toBe("READY_TO_COMPLETE");
  });
  it("after the Manager completes: awaiting accounting, then completed", () => {
    expect(deriveStage({ ...base, requestStatus: "PENDING_ACCOUNTING", procurementApproved: true })).toBe("AWAITING_ACCOUNTING");
    expect(deriveStage({ ...base, requestStatus: "ACCOUNTING_COMPLETED", procurementApproved: true })).toBe("PROCUREMENT_COMPLETED");
  });
});

describe("secondsBetween", () => {
  const a = new Date("2026-11-03T10:00:00Z");
  it("counts whole seconds and tolerates missing timestamps", () => {
    expect(secondsBetween(a, new Date(a.getTime() + 90_500))).toBe(90);
    expect(secondsBetween(null, a)).toBeNull();
    expect(secondsBetween(a, undefined)).toBeNull();
  });
  it("never goes negative (a timestamp slightly in the future)", () => {
    expect(secondsBetween(new Date(a.getTime() + 5000), a)).toBe(0);
  });
});

describe("sumByUnit", () => {
  it("keeps incompatible units apart", () => {
    expect(
      sumByUnit([
        { unit: "ш", quantity: 4 },
        { unit: "кг", quantity: 20 },
        { unit: "ш", quantity: 6 },
      ])
    ).toEqual([
      { unit: "кг", quantity: 20 },
      { unit: "ш", quantity: 10 },
    ]);
  });
});

describe("parseThresholdHours", () => {
  it("is a viewer-chosen monitoring filter with a safe default", () => {
    expect(parseThresholdHours(null)).toBe(DEFAULT_THRESHOLD_HOURS);
    expect(parseThresholdHours("abc")).toBe(DEFAULT_THRESHOLD_HOURS);
    expect(parseThresholdHours("0")).toBe(DEFAULT_THRESHOLD_HOURS);
    expect(parseThresholdHours("48")).toBe(48);
    expect(parseThresholdHours("99999")).toBe(DEFAULT_THRESHOLD_HOURS);
  });
});
