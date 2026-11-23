import { describe, expect, it } from "vitest";
import { backfillExpenses, type ExpensesBackfillDeps } from "./expenses-backfill";

const deps = (over: Partial<ExpensesBackfillDeps> = {}): ExpensesBackfillDeps & { asked: string[]; slept: number[] } => {
  const asked: string[] = [];
  const slept: number[] = [];
  return {
    asked,
    slept,
    has: async () => false,
    sync: async (m) => {
      asked.push(m);
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
    log: () => undefined,
    ...over,
  };
};

describe("backfillExpenses: өнгөрсөн сар бүр нэг татаалт, дараалан", () => {
  it("сар бүр дарааллаар, хооронд нь завсарлагатай (эхний өмнө үгүй)", async () => {
    const d = deps();
    const r = await backfillExpenses({ from: "2026-01", to: "2026-04", pauseSeconds: 15 }, d);
    expect(d.asked).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(d.slept).toEqual([15_000, 15_000, 15_000]);
    expect(r).toEqual({ done: d.asked, skipped: [], failed: [] });
  });

  it("татагдсан сарыг алгасна (1С-д хүрэхгүй), force үед дахин татна", async () => {
    const d = deps({ has: async (m) => m === "2026-02" });
    const r = await backfillExpenses({ from: "2026-01", to: "2026-03" }, d);
    expect(r.skipped).toEqual(["2026-02"]);
    expect(d.asked).toEqual(["2026-01", "2026-03"]);
    const f = deps({ has: async () => true });
    await backfillExpenses({ from: "2026-01", to: "2026-02", force: true }, f);
    expect(f.asked).toEqual(["2026-01", "2026-02"]);
  });

  it("нэг сар унавал бусад үргэлжилнэ, алдаатайд бүртгэнэ", async () => {
    const d = deps({
      sync: async (m) => {
        if (m === "2026-02") throw new Error("1С унтарсан");
      },
    });
    const r = await backfillExpenses({ from: "2026-01", to: "2026-03" }, d);
    expect(r).toEqual({ done: ["2026-01", "2026-03"], skipped: [], failed: ["2026-02"] });
  });

  it("буруу оролт: одоогийн сар, буруу хэлбэр, 24 сараас олон", async () => {
    await expect(backfillExpenses({ from: "2026-10", to: "2026-01" }, deps())).rejects.toThrow();
    await expect(backfillExpenses({ from: "2020-01", to: "2099-01" }, deps())).rejects.toThrow();
    await expect(backfillExpenses({ from: "2020-01", to: "2022-06" }, deps())).rejects.toThrow(/24/);
    await expect(backfillExpenses({ from: "abc", to: "2026-01" }, deps())).rejects.toThrow();
  });
});
