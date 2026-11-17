import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { describeRetention, planStockPrune, pruneStock, pruneSyncLog, runRetention } from "./retention";

describe("planStockPrune: 90 хоног өдөр бүр, түүнээс өмнө сарын эцэс, сүүлийн snapshot хэзээ ч устахгүй", () => {
  const TODAY = "2026-11-17"; // cutoff = 2026-08-19

  it("cutoff болон түүнээс хойшхи өдөр бүрийн snapshot бүгд үлдэнэ", () => {
    const p = planStockPrune(["2026-08-19", "2026-08-20", "2026-10-01", "2026-11-16", "2026-11-17"], TODAY);
    expect(p.keepDaily).toEqual(["2026-08-19", "2026-08-20", "2026-10-01", "2026-11-16", "2026-11-17"]);
    expect(p.remove).toEqual([]);
  });

  it("cutoff-оос өмнөх хугацаанд сар бүрийн ЗӨВХӨН сүүлийн snapshot үлдэнэ", () => {
    const p = planStockPrune(["2026-06-01", "2026-06-15", "2026-06-30", "2026-07-03", "2026-07-30", "2026-11-17"], TODAY);
    expect(p.keepMonthEnd).toEqual(["2026-06-30", "2026-07-30"]);
    expect(p.remove).toEqual(["2026-06-01", "2026-06-15", "2026-07-03"]);
    expect(p.keepDaily).toEqual(["2026-11-17"]);
  });

  it("сарын «сүүлийн» нь бодитоор байгаа хамгийн сүүлийн өдөр (Ням гарагт sync байхгүй)", () => {
    // 2026-05-31 Ням: sync байхгүй, тиймээс 05-30 (Бямба) нь сарын сүүлийнх
    const p = planStockPrune(["2026-05-28", "2026-05-29", "2026-05-30", "2026-11-17"], TODAY);
    expect(p.keepMonthEnd).toEqual(["2026-05-30"]);
    expect(p.remove).toEqual(["2026-05-28", "2026-05-29"]);
  });

  it("cutoff-ийн хил: cutoff-оос нэг өдөр өмнөх нь хуучин, cutoff өөрөө шинэ", () => {
    const p = planStockPrune(["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-31"], TODAY);
    expect(p.remove).toEqual(["2026-08-17", "2026-08-18"]); // 08-31 нь сарын сүүлийн бөгөөд шинэ цонхонд
    expect(p.keepDaily).toEqual(["2026-08-19", "2026-08-31"]);
  });

  it("хамгийн сүүлийн snapshot хичнээн хуучин байсан ч үлдэнэ (sync удаан зогссон үед)", () => {
    const p = planStockPrune(["2025-01-10", "2025-01-20"], TODAY);
    expect(p.latest).toBe("2025-01-20");
    expect(p.remove).toEqual(["2025-01-10"]);
    expect([...p.keepDaily, ...p.keepMonthEnd]).toContain("2025-01-20");
    expect(planStockPrune(["2024-03-03"], TODAY).remove).toEqual([]);
  });

  it("ирээдүйн огноо (цагийн зөрүү) устгагдахгүй; давхардал, эрэмбэгүй оролтыг зөв ойлгоно", () => {
    const p = planStockPrune(["2026-11-18", "2026-06-01", "2026-06-30", "2026-06-30", "2026-11-17"], TODAY);
    expect(p.remove).toEqual(["2026-06-01"]);
    expect(p.latest).toBe("2026-11-18");
  });

  it("хоосон оролт: юу ч устгахгүй", () => {
    expect(planStockPrune([], TODAY)).toEqual({ latest: null, keepDaily: [], keepMonthEnd: [], remove: [] });
  });

  it("жилийн хил: өмнөх оны 12-р сарын сүүлийн өдөр үлдэнэ", () => {
    const p = planStockPrune(["2025-12-15", "2025-12-30", "2026-01-05", "2026-01-31", "2026-11-17"], TODAY);
    expect(p.keepMonthEnd).toEqual(["2025-12-30", "2026-01-31"]);
    expect(p.remove).toEqual(["2025-12-15", "2026-01-05"]);
  });
});

// ---- DB: хүрээ (window), төрөл (kinds)-өөр тусгаарласан тул бусад тестийн өгөгдөлд хүрэхгүй ----
const WIN = { from: "2041-01-01", to: "2042-12-31" };
const KIND_A = "prune-test-a";
const KIND_B = "prune-test-b";
const at = (d: string) => new Date(`${d}T00:00:00Z`);

async function seedStock(dates: string[]) {
  await prisma.onecStock.createMany({
    data: dates.flatMap((d) => [1, 2].map((n) => ({ snapshotDate: at(d), warehouseCode: "RET-TEST", warehouse: "w", itemCode: `RET${n}`, item: "i", unit: "ш", account: "1510", qty: n, amount: n * 10 }))),
  });
}
const stockDates = async () => (await prisma.onecStock.findMany({ where: { warehouseCode: "RET-TEST" }, distinct: ["snapshotDate"], orderBy: { snapshotDate: "asc" }, select: { snapshotDate: true } })).map((r) => r.snapshotDate.toISOString().slice(0, 10));

async function wipe() {
  await prisma.onecStock.deleteMany({ where: { warehouseCode: "RET-TEST" } });
  await prisma.onecSyncLog.deleteMany({ where: { kind: { in: [KIND_A, KIND_B] } } });
}
beforeAll(wipe);
afterAll(wipe);
beforeEach(wipe);

describe("pruneStock (DB)", () => {
  const FIXTURE = ["2041-01-01", "2041-01-15", "2041-01-31", "2041-02-10", "2041-02-28", "2041-12-20", "2041-12-30"];

  it("анхдагч dry-run юу ч устгахгүй, зөвхөн тайлагнана", async () => {
    await seedStock(FIXTURE);
    const r = await pruneStock({ today: "2041-12-31", window: WIN });
    expect(r.apply).toBe(false);
    expect(r.remove.map((x) => x.date)).toEqual(["2041-01-01", "2041-01-15", "2041-02-10"]);
    expect(r.rowsToRemove).toBe(6);
    expect(r.deletedRows).toBe(0);
    expect(await stockDates()).toEqual(FIXTURE);
  });

  it("apply: өдөр бүр + сарын эцсийг үлдээж, бусдыг устгана; дахин ажиллуулахад юу ч өөрчлөгдөхгүй", async () => {
    await seedStock(FIXTURE);
    const r = await pruneStock({ apply: true, today: "2041-12-31", window: WIN });
    expect(r.deletedRows).toBe(6);
    expect(await stockDates()).toEqual(["2041-01-31", "2041-02-28", "2041-12-20", "2041-12-30"]);
    const again = await pruneStock({ apply: true, today: "2041-12-31", window: WIN });
    expect(again.remove).toEqual([]);
    expect(again.deletedRows).toBe(0);
  });

  it("max(snapshot_date)-ийг cutoff-оос хэчнээн хол ч устгахгүй", async () => {
    await seedStock(["2042-03-03", "2042-03-10"]);
    const r = await pruneStock({ apply: true, today: "2044-01-01", window: WIN });
    expect(r.latest).toBe("2042-03-10");
    expect(await stockDates()).toEqual(["2042-03-10"]);
    expect(await prisma.onecStock.count({ where: { warehouseCode: "RET-TEST", snapshotDate: at("2042-03-10") } })).toBe(2);
  });

  it("window-оос гадуурх snapshot (бусад өгөгдөл)-д хүрэхгүй", async () => {
    await seedStock(["2041-01-01", "2041-01-31", "2041-12-30"]);
    // 2040-01-01 нь window-гүй бол устах байсан (сарын сүүлийнх нь 2040-01-02)
    await prisma.onecStock.createMany({
      data: ["2040-01-01", "2040-01-02"].map((d) => ({ snapshotDate: at(d), warehouseCode: "RET-TEST", warehouse: "w", itemCode: "OUT", item: "i", unit: "ш", account: "1510", qty: 1, amount: 1 })),
    });
    const unscoped = await pruneStock({ today: "2041-12-31" });
    expect(unscoped.remove.map((x) => x.date)).toContain("2040-01-01"); // хяналт: window-гүй бол хамрах байсан
    const r = await pruneStock({ apply: true, today: "2041-12-31", window: WIN });
    expect(r.remove.map((x) => x.date)).toEqual(["2041-01-01"]);
    expect(await stockDates()).toEqual(["2040-01-01", "2040-01-02", "2041-01-31", "2041-12-30"]);
  });
});

describe("pruneSyncLog (DB)", () => {
  const NOW = new Date("2040-06-01T00:00:00Z"); // ok cutoff 2040-03-03, failed cutoff 2039-06-02
  const log = (kind: string, ok: boolean, finished: string) => prisma.onecSyncLog.create({ data: { kind, period: "prune-test", rows: 1, ok, message: finished, startedAt: at(finished), finishedAt: at(finished) } });
  const left = async () => (await prisma.onecSyncLog.findMany({ where: { kind: { in: [KIND_A, KIND_B] } }, orderBy: [{ kind: "asc" }, { finishedAt: "asc" }] })).map((r) => `${r.kind}:${r.ok ? "ok" : "fail"}:${r.message}`);

  async function seed() {
    for (const d of ["2040-01-01", "2040-01-02", "2040-01-03"]) await log(KIND_A, true, d); // хуучин, гэхдээ шинэ амжилттай мөр байгаа
    await log(KIND_A, true, "2040-05-01"); // шинэ
    await log(KIND_A, false, "2039-11-01"); // алдаатай, 1 жилээс дотор: үлдэнэ
    await log(KIND_A, false, "2039-04-01"); // алдаатай, 1 жилээс хуучин: устна
    await log(KIND_B, true, "2039-01-01"); // хуучин; гэхдээ энэ төрлийн хамгийн сүүлийн амжилттай мөр биш
    await log(KIND_B, true, "2039-02-01"); // энэ төрлийн ХАМГИЙН СҮҮЛИЙН амжилттай мөр: хичнээн хуучин ч үлдэнэ
    await log(KIND_B, false, "2038-01-01"); // алдаатай, хуучин: устна
  }

  it("dry-run: тоог л хэлнэ, юу ч устгахгүй", async () => {
    await seed();
    const r = await pruneSyncLog({ now: NOW, kinds: [KIND_A, KIND_B] });
    expect(r).toMatchObject({ apply: false, okRows: 4, failedRows: 2, deleted: 0 }); // A: 3 ok + B: 1 ok; A: 1 fail + B: 1 fail
    expect(await left()).toHaveLength(9);
  });

  it("apply: амжилттай 90 хоног, алдаатай 1 жил, төрөл бүрийн сүүлийн амжилттай мөр үлдэнэ", async () => {
    await seed();
    const r = await pruneSyncLog({ apply: true, now: NOW, kinds: [KIND_A, KIND_B] });
    expect(r.deleted).toBe(6);
    expect(await left()).toEqual([`${KIND_A}:fail:2039-11-01`, `${KIND_A}:ok:2040-05-01`, `${KIND_B}:ok:2039-02-01`]);
    expect((await pruneSyncLog({ apply: true, now: NOW, kinds: [KIND_A, KIND_B] })).deleted).toBe(0);
  });

  it("kinds өгснөөс бусад төрөлд хүрэхгүй", async () => {
    await log(KIND_A, true, "2040-01-01");
    await log(KIND_A, true, "2040-05-01");
    await log(KIND_B, true, "2040-01-01");
    await log(KIND_B, true, "2040-05-01");
    await pruneSyncLog({ apply: true, now: NOW, kinds: [KIND_A] });
    expect(await left()).toEqual([`${KIND_A}:ok:2040-05-01`, `${KIND_B}:ok:2040-01-01`, `${KIND_B}:ok:2040-05-01`]);
  });
});

describe("runRetention", () => {
  it("dry-run: onec_sync_log-д юу ч бичихгүй, тайланд DRY-RUN ба --apply сануулга байна", async () => {
    const before = await prisma.onecSyncLog.count({ where: { kind: "prune" } });
    const r = await runRetention({});
    expect(r.stock.apply).toBe(false);
    expect(r.stock.deletedRows).toBe(0);
    expect(r.syncLog.deleted).toBe(0);
    expect(await prisma.onecSyncLog.count({ where: { kind: "prune" } })).toBe(before);
    const text = describeRetention(r);
    expect(text).toContain("DRY-RUN");
    expect(text).toContain("--apply");
  });
});
