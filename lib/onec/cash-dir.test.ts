import { describe, expect, it } from "vitest";
import { dirOfFlow, dirTotals, flowOfDir, matchesDir, parseDir, transferReportEntries } from "./cash-dir";
import type { CashEntry } from "./cash";

describe("parseDir / dirOfFlow / flowOfDir", () => {
  it("зөвхөн in|out|transfer; бусад нь Бүгд (undefined)", () => {
    expect(parseDir("in")).toBe("in");
    expect(parseDir("out")).toBe("out");
    expect(parseDir("transfer")).toBe("transfer");
    for (const bad of [null, undefined, "", "all", "IN", "inflow"]) expect(parseDir(bad)).toBeUndefined();
  });
  it("flow ↔ dir хоёр чиглэлд тэнцүү", () => {
    for (const d of ["in", "out", "transfer"] as const) expect(dirOfFlow(flowOfDir(d))).toBe(d);
    expect(dirOfFlow("")).toBeUndefined();
    expect(flowOfDir(undefined)).toBe("");
  });
});

describe("matchesDir", () => {
  const inflow = { type: "inflow" as const };
  const outflow = { type: "outflow" as const };
  const transfer = { type: "internal" as const, transfer: true };
  it("Бүгд: бүх мөр", () => {
    for (const e of [inflow, outflow, transfer]) expect(matchesDir(e, undefined)).toBe(true);
  });
  it("Орсон/Гарсан: шилжүүлгийг оруулахгүй (дансны хуудасны inflow+transfer ч мөн)", () => {
    expect(matchesDir(inflow, "in")).toBe(true);
    expect(matchesDir(outflow, "in")).toBe(false);
    expect(matchesDir(outflow, "out")).toBe(true);
    expect(matchesDir(transfer, "in")).toBe(false);
    expect(matchesDir(transfer, "out")).toBe(false);
    expect(matchesDir({ type: "inflow", transfer: true }, "in")).toBe(false);
  });
  it("Шилжүүлэг: зөвхөн шилжүүлэг", () => {
    expect(matchesDir(transfer, "transfer")).toBe(true);
    expect(matchesDir({ type: "outflow", transfer: true }, "transfer")).toBe(true);
    expect(matchesDir(inflow, "transfer")).toBe(false);
    expect(matchesDir(outflow, "transfer")).toBe(false);
  });
});

describe("dirTotals", () => {
  it("тоо, дүнгийн нийлбэр, цэвэр (шилжүүлэг цэвэрт 0)", () => {
    expect(dirTotals([])).toEqual({ count: 0, amountTotal: 0, netTotal: 0 });
    expect(dirTotals([{ type: "inflow", amount: 5000 }, { type: "outflow", amount: 2000 }])).toEqual({ count: 2, amountTotal: 7000, netTotal: 3000 });
    expect(dirTotals([{ type: "internal", amount: 900, transfer: true }, { type: "internal", amount: 100.25, transfer: true }])).toEqual({ count: 2, amountTotal: 1000.25, netTotal: 0 });
  });
  it("дүнг 2 орноор тоймлоно (хөвөгч таслалгүй)", () => {
    expect(dirTotals([{ type: "inflow", amount: 0.1 }, { type: "inflow", amount: 0.2 }]).amountTotal).toBe(0.3);
  });
});

describe("transferReportEntries", () => {
  it("шилжүүлэг бүр transfer=true, ангилал internal; төрөл хэвээр", () => {
    const t = { id: "a", type: "internal", amount: 5 } as unknown as CashEntry;
    const [r] = transferReportEntries([t]);
    expect(r).toMatchObject({ id: "a", type: "internal", transfer: true, category: "internal" });
  });
});
