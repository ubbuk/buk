import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { ProductionMonthData } from "./production";
import { backfillProduction, previousMonthNeedsSync, PRODUCTION_LOG_KIND, readLastReports, readProductionLines, readProductionMonth, readProductionMonths, syncProduction, writeProductionMonth } from "./production-store";

const NOW = "2098-04";

const data = (month: string, over: { qty?: number; amount?: number; lines?: number } = {}): ProductionMonthData => ({
  month,
  lines: Array.from({ length: over.lines ?? 2 }, (_, i) => ({ day: `${month}-0${i + 1}`, docRef: `ref-${month}-${i}`, docNumber: `ТЕН ${i}`, lineNo: 1, time: "11:33", posted: i === 0, stage: "finished" as const, department: "Тенсиланд хэсэг", productKey: "k1", product: "Шон 80*80", unit: "ш", quantity: over.qty ?? 10 })),
  ledger: [{ kind: "output", stage: "finished", department: "Тенсиланд хэсэг", productKey: "k1", product: "Шон 80*80", unit: "ш", quantity: over.qty ?? 10, amount: over.amount ?? over.qty ?? 10 }],
});

const clean = async () => {
  await prisma.onecProductionLine.deleteMany({ where: { month: { startsWith: "209" } } });
  await prisma.onecProductionLedger.deleteMany({ where: { month: { startsWith: "209" } } });
  await prisma.onecSyncLog.deleteMany({ where: { kind: PRODUCTION_LOG_KIND, period: { startsWith: "209" } } });
};

describe("production агшин зураг (Postgres)", () => {
  beforeEach(clean);
  afterEach(clean);

  it("сарыг бүтнээр нь солино: дахин бичихэд хуучин мөр үлдэхгүй, давхардахгүй", async () => {
    await writeProductionMonth(data("2098-04", { lines: 3 }));
    await writeProductionMonth(data("2098-04", { lines: 1, qty: 55 }));
    const r = await readProductionMonth("2098-04");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ product: "Шон 80*80", quantity: 55, stage: "finished", posted: true, department: "Тенсиланд хэсэг" });
    expect(r.ledger).toHaveLength(1);
    // баримтын цаг хадгалагдаж, уншигдана
    expect(r.lines[0]).toMatchObject({ docTime: "11:33" });
    await writeProductionMonth(data("2098-03"));
    expect((await readProductionMonth("2098-04")).lines).toHaveLength(1); // өөр сарыг хөндөхгүй
  });
});

describe("readProductionMonths (хугацаа сарын хилийг давсан)", () => {
  beforeEach(clean);
  afterEach(clean);

  it("хэд хэдэн сарын мөр нийлнэ, бичилт сар бүрийн тусдаа, сүүлд татсан цаг", async () => {
    await writeProductionMonth(data("2098-03", { lines: 1 }));
    await writeProductionMonth(data("2098-04", { lines: 2 }));
    const r = await readProductionMonths(["2098-03", "2098-04"]);
    expect(r.lines.map((l) => l.day).sort()).toEqual(["2098-03-01", "2098-04-01", "2098-04-02"]);
    expect(Object.keys(r.ledgerByMonth)).toEqual(["2098-03", "2098-04"]);
    expect(r.ledgerByMonth["2098-03"]).toHaveLength(1);
  });
});

describe("readLastReports, readProductionLines", () => {
  beforeEach(clean);
  afterEach(clean);

  it("хэлтэс бүрийн сүүлийн тайлан (бүх хадгалагдсан сараас, батлагдаагүй ч) ба since-ээс хойших тайлангийн (баримтын) тоо", async () => {
    const lines = (month: string, department: string, day: string, posted: boolean, ref = `r-${month}-${department}-${day}`) => ({ ...data(month, { lines: 1 }).lines[0], docRef: ref, day, department, posted });
    await writeProductionMonth({ month: "2098-02", lines: [lines("2098-02", "A хэлтэс", "2098-02-10", true), lines("2098-02", "B хэлтэс", "2098-02-28", true)], ledger: [] });
    await writeProductionMonth({
      month: "2098-03",
      // нэг баримтын хоёр мөр нэг л тайлан; батлаагүй баримт ч тайлан
      lines: [lines("2098-03", "A хэлтэс", "2098-03-05", true, "d1"), { ...lines("2098-03", "A хэлтэс", "2098-03-05", true, "d1"), lineNo: 2 }, lines("2098-03", "A хэлтэс", "2098-03-20", false, "d2")],
      ledger: [],
    });
    const r = (await readLastReports("2098-03-01")).filter((x) => x.department.endsWith("хэлтэс")).sort((a, b) => a.department.localeCompare(b.department));
    expect(r).toEqual([
      { department: "A хэлтэс", lastDay: "2098-03-20", firstDay: "2098-02-10", recent: 2 },
      { department: "B хэлтэс", lastDay: "2098-02-28", firstDay: "2098-02-28", recent: 0 },
    ]);
  });

  it("«Дараа нь брак болсон» (reclass) мөр: цех нь бүтээгдэхүүнээр тодорхойлогдож хадгалагдана, цехгүй мөр хадгалагдахгүй, сүүлийн тайланд тоологдохгүй", async () => {
    const base = data("2098-02", { lines: 1 }).lines[0];
    await writeProductionMonth({ month: "2098-02", lines: [{ ...base, docRef: "f1", product: "Тест бүтээгдэхүүн X1", department: "A хэлтэс", day: "2098-02-10", quantity: 50 }], ledger: [] });
    const rc = (ref: string, product: string, day: string) => ({ ...base, docRef: ref, stage: "reclass" as const, department: "", product, day, quantity: 7 });
    await writeProductionMonth({ month: "2098-03", lines: [rc("k1", "Тест бүтээгдэхүүн X1 Брак", "2098-03-04"), rc("k2", "Танигдаагүй бүтээгдэхүүн Брак", "2098-03-05")], ledger: [] });
    const r = await readProductionMonth("2098-03");
    expect(r.lines.map((l) => [l.stage, l.department, l.day])).toEqual([["reclass", "A хэлтэс", "2098-03-04"]]);
    const last = (await readLastReports("2098-01-01")).filter((x) => x.department === "A хэлтэс");
    expect(last).toEqual([{ department: "A хэлтэс", lastDay: "2098-02-10", firstDay: "2098-02-10", recent: 1 }]);
    // Бракаас/Засвараас бэлэн болгосон мөр ч цехтэй хадгалагдаж, сүүлийн тайланд тоологдохгүй
    await writeProductionMonth({ month: "2098-04", lines: [{ ...rc("k3", "Тест бүтээгдэхүүн X1", "2098-04-02"), stage: "defect_to_ready" as const }, { ...rc("k4", "Тест бүтээгдэхүүн X1", "2098-04-03"), stage: "repair_to_ready" as const }], ledger: [] });
    expect((await readProductionMonth("2098-04")).lines.map((l) => [l.stage, l.department])).toEqual([["defect_to_ready", "A хэлтэс"], ["repair_to_ready", "A хэлтэс"]]);
    expect((await readLastReports("2098-01-01")).filter((x) => x.department === "A хэлтэс")[0].lastDay).toBe("2098-02-10");
  });

  it("readProductionLines: from..to сарын мөрүүд (бичилтгүй), өдрөөр эрэмбэлэгдсэн", async () => {
    await writeProductionMonth(data("2098-02", { lines: 1 }));
    await writeProductionMonth(data("2098-03", { lines: 2 }));
    await writeProductionMonth(data("2098-04", { lines: 1 }));
    const r = await readProductionLines("2098-02", "2098-03");
    expect(r.map((l) => l.day)).toEqual(["2098-02-01", "2098-03-01", "2098-03-02"]);
    expect(r[0]).toMatchObject({ docTime: "11:33", department: "Тенсиланд хэсэг" });
  });
});

describe("syncProduction (горим: production-month)", () => {
  beforeEach(clean);
  afterEach(clean);

  it("өмнөх сар хараахан татагдаагүй бол одоогийн сар + өмнөх сар; үр дүн sync_log-д (kind=production-month)", async () => {
    const fetchMonth = vi.fn(async (m: string) => data(m));
    const steps = await syncProduction(fetchMonth, NOW);
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-04", "2098-03"]);
    expect(steps.map((s) => [s.kind, s.period, s.ok])).toEqual([[PRODUCTION_LOG_KIND, "2098-04", true], [PRODUCTION_LOG_KIND, "2098-03", true]]);
    expect(await prisma.onecSyncLog.count({ where: { kind: PRODUCTION_LOG_KIND, period: { in: ["2098-04", "2098-03"] }, ok: true } })).toBe(2);
  });

  it("өмнөх сар хаагдаагүй (бичилт төлөвлөсөн үнээр) бол үргэлж дахин татна; хаагдсаны дараа зөвхөн одоогийн сар", async () => {
    await writeProductionMonth(data("2098-03", { qty: 100, amount: 100 })); // төлөвлөсөн: хараахан хаагдаагүй
    expect(await previousMonthNeedsSync(NOW)).toBe(true);
    const fetchMonth = vi.fn(async (m: string) => data(m, { qty: 100, amount: 4_000_000 }));
    await syncProduction(fetchMonth, NOW);
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-04", "2098-03"]);
    // 2098-03 одоо хаагдсан (бодит өртөг орсон)
    expect(await previousMonthNeedsSync(NOW)).toBe(false);
    fetchMonth.mockClear();
    await syncProduction(fetchMonth, NOW);
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-04"]);
  });

  it("өмнөх сард бичилт огт байхгүй (баримтгүй) боловч татагдсан бол дахин оролдохгүй (1С-д дарамтгүй)", async () => {
    await writeProductionMonth({ month: "2098-03", lines: data("2098-03").lines, ledger: [] });
    expect(await previousMonthNeedsSync(NOW)).toBe(false);
    await prisma.onecProductionLine.deleteMany({ where: { month: "2098-03" } });
    expect(await previousMonthNeedsSync(NOW)).toBe(true); // огт татагдаагүй: нэг удаа
  });

  it("нэг сар унасан ч дараагийнх үргэлжилнэ, алдаа sync_log-д ok=false, шидэхгүй", async () => {
    const fetchMonth = vi.fn(async (m: string) => {
      if (m === "2098-04") throw new Error("1С холбогдсонгүй");
      return data(m);
    });
    const steps = await syncProduction(fetchMonth, NOW);
    expect(steps.map((s) => [s.period, s.ok])).toEqual([["2098-04", false], ["2098-03", true]]);
    expect(steps[0].message).toContain("1С холбогдсонгүй");
    expect((await readProductionMonth("2098-04")).lines).toHaveLength(0);
    expect(await prisma.onecSyncLog.count({ where: { kind: PRODUCTION_LOG_KIND, period: "2098-04", ok: false } })).toBe(1);
  });

  it("нийт хугацааны хязгаарт хүрвэл зогсоно (алдаа биш, дараагийн удаа үргэлжилнэ)", async () => {
    const fetchMonth = vi.fn(async (m: string) => data(m));
    const steps = await syncProduction(fetchMonth, NOW, { budgetMs: 5_000 });
    expect(fetchMonth).not.toHaveBeenCalled();
    expect(steps).toEqual([expect.objectContaining({ period: "stopped", ok: true })]);
  });
});

describe("backfillProduction (горим: production-backfill)", () => {
  beforeEach(clean);
  afterEach(clean);
  const sleep = vi.fn(async (ms: number) => void ms);

  it("from..to сар бүрийг дараалан татна, сар хооронд завсарлагатай (эхний сарын өмнө үгүй)", async () => {
    sleep.mockClear();
    const fetchMonth = vi.fn(async (m: string) => data(m));
    const r = await backfillProduction({ from: "2098-01", to: "2098-03", pauseSeconds: 7 }, fetchMonth, sleep);
    expect(r).toEqual({ done: ["2098-01", "2098-02", "2098-03"], skipped: [], failed: [] });
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-01", "2098-02", "2098-03"]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([7000, 7000]);
  });

  it("татагдсан сарыг алгасна (дахин ажиллуулахад 1С-д хүрэхгүй); --force бол дахин татна", async () => {
    await writeProductionMonth(data("2098-02"));
    const fetchMonth = vi.fn(async (m: string) => data(m));
    const r = await backfillProduction({ from: "2098-01", to: "2098-03", pauseSeconds: 0 }, fetchMonth, sleep);
    expect(r.skipped).toEqual(["2098-02"]);
    expect(fetchMonth.mock.calls.map((c) => c[0])).toEqual(["2098-01", "2098-03"]);
    fetchMonth.mockClear();
    const forced = await backfillProduction({ from: "2098-01", to: "2098-03", pauseSeconds: 0, force: true }, fetchMonth, sleep);
    expect(forced.skipped).toEqual([]);
    expect(fetchMonth).toHaveBeenCalledTimes(3);
  });

  it("алдаатай сар failed-д, бусад үргэлжилнэ", async () => {
    const fetchMonth = vi.fn(async (m: string) => {
      if (m === "2098-02") throw new Error("timeout");
      return data(m);
    });
    const r = await backfillProduction({ from: "2098-01", to: "2098-03", pauseSeconds: 0 }, fetchMonth, sleep);
    expect(r).toEqual({ done: ["2098-01", "2098-03"], skipped: [], failed: ["2098-02"] });
  });

  it("буруу хүрээ, 24-өөс олон сар: алдаа", async () => {
    const fetchMonth = vi.fn(async (m: string) => data(m));
    await expect(backfillProduction({ from: "bad", to: "2098-03" }, fetchMonth, sleep)).rejects.toThrow();
    await expect(backfillProduction({ from: "2098-03", to: "2098-01" }, fetchMonth, sleep)).rejects.toThrow();
    await expect(backfillProduction({ from: "2090-01", to: "2098-03" }, fetchMonth, sleep)).rejects.toThrow();
    expect(fetchMonth).not.toHaveBeenCalled();
  });
});
