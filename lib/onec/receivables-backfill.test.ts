import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Нөхөлт: 1С-ийн татаалтыг (fetchStage) хуурамчаар, Postgres бодит (тусгаарласан тест DB)
const fetchStage = vi.hoisted(() => vi.fn());
vi.mock("./receivables", async (importOriginal) => ({ ...(await importOriginal<typeof import("./receivables")>()), fetchStage }));

import { backfillReceivables, type BackfillDeps } from "./receivables-backfill";
import { syncReceivablesSnapshotLocked } from "./receivables-store";

const deps = (over: Partial<BackfillDeps> = {}): BackfillDeps & { asked: string[]; slept: number[] } => {
  const asked: string[] = [];
  const slept: number[] = [];
  return {
    asked,
    slept,
    has: async () => false,
    sync: async (asOf) => {
      asked.push(asOf);
      return { ok: true };
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
    log: () => undefined,
    ...over,
  };
};

describe("backfillReceivables: өнгөрсөн сар бүрийн эцсийн агшин зураг, нэг нэгээр нь", () => {
  it("сар бүр ДАРААЛЛАН нэг удаа, хооронд нь завсарлагатай (эхний хүсэлтийн өмнө үгүй)", async () => {
    const d = deps();
    const r = await backfillReceivables({ from: "2026-01", to: "2026-04", pauseSeconds: 15 }, d);
    expect(d.asked).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(d.slept).toEqual([15_000, 15_000, 15_000]);
    expect(r).toEqual({ done: d.asked, skipped: [], failed: [], busy: [] });
  });

  it("аль хэдийн татагдсан сарыг алгасна (1С-д хүрэхгүй), force үед дахин татна", async () => {
    const d = deps({ has: async (asOf) => asOf === "2026-02-28" });
    const r = await backfillReceivables({ from: "2026-01", to: "2026-03" }, d);
    expect(r.skipped).toEqual(["2026-02-28"]);
    expect(d.asked).toEqual(["2026-01-31", "2026-03-31"]);
    const f = deps({ has: async () => true });
    await backfillReceivables({ from: "2026-01", to: "2026-02", force: true }, f);
    expect(f.asked).toEqual(["2026-01-31", "2026-02-28"]);
    const all = deps({ has: async () => true });
    expect((await backfillReceivables({ from: "2026-01", to: "2026-02" }, all)).skipped).toHaveLength(2);
    expect(all.asked).toEqual([]);
  });

  it("нэг сар алдаа гарвал бусдыг үргэлжлүүлнэ; завгүй түрээсийг тэмдэглэнэ", async () => {
    const d = deps({ sync: async (asOf) => (asOf === "2026-02-28" ? { ok: false } : asOf === "2026-03-31" ? null : { ok: true }) });
    const r = await backfillReceivables({ from: "2026-01", to: "2026-04" }, d);
    expect(r).toEqual({ done: ["2026-01-31", "2026-04-30"], skipped: [], failed: ["2026-02-28"], busy: ["2026-03-31"] });
  });

  it("одоогийн сар, буруу хүрээ, 24-өөс олон сар татгалзана", async () => {
    await expect(backfillReceivables({ from: "2026-01", to: "2099-01" }, deps())).rejects.toThrow("өнгөрсөн сар");
    await expect(backfillReceivables({ from: "2026-05", to: "2026-01" }, deps())).rejects.toThrow("Жишээ");
    await expect(backfillReceivables({ from: "bad", to: "2026-01" }, deps())).rejects.toThrow("Жишээ");
    await expect(backfillReceivables({ from: "2020-01", to: "2023-01" }, deps())).rejects.toThrow("24");
  });
});

describe("syncReceivablesSnapshotLocked(asOf, [1201]): зөвхөн толгой данс, сар бүр 1 хүсэлт", () => {
  const ASOF = "2019-03-31";
  const clean = () => prisma.$executeRaw`DELETE FROM onec_receivable_balances WHERE snapshot_date = ${ASOF}::date`;
  beforeEach(async () => {
    fetchStage.mockReset();
    await clean();
  });
  afterAll(async () => {
    await clean();
    await prisma.onecSyncLog.deleteMany({ where: { kind: "receivables-odata", period: ASOF } });
  });

  it("1С-ээс зөвхөн 1201 татагдаж, агшин зураг бичигдэнэ (НӨАТ-ын данс татагдахгүй)", async () => {
    fetchStage.mockResolvedValue([{ accountCode: "1201", accountName: "Авлага", customerKey: "k1", customer: "Альфа ХХК", balance: 123, customers: 1 }]);
    const r = await syncReceivablesSnapshotLocked(ASOF, ["1201"]);
    expect(r).toMatchObject({ ok: true, rows: 1, failed: [] });
    expect(fetchStage.mock.calls.map((c) => c[1])).toEqual(["1201"]);
    const rows = await prisma.$queryRaw<{ account_code: string; balance: number }[]>`SELECT account_code, balance::float8 AS balance FROM onec_receivable_balances WHERE snapshot_date = ${ASOF}::date`;
    expect(rows).toEqual([{ account_code: "1201", balance: 123 }]);
  });

  it("ердийн дуудлага (stages өгөхгүй) 3 данс татна: хуучин ажиллагаа өөрчлөгдөөгүй", async () => {
    fetchStage.mockResolvedValue(null);
    await syncReceivablesSnapshotLocked(ASOF);
    expect(fetchStage.mock.calls.map((c) => c[1])).toEqual(["1201", "1272", "1271"]);
  });
});
