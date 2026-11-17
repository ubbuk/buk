import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncStock } from "./sync";

// Real DB (isolated test database); only the outgoing fetch to 1С is replaced. A far-future date keeps this file clear of other data.
const DATE = "2032-04-10";
const ENV = { ONEC_BASE_URL: "http://1c.test/base", ONEC_USER: "svc", ONEC_PASSWORD: "pw" };

const base = { org: "Байгууллага", warehouse_code: "00-001", warehouse: "Төв агуулах", item_code: "M1", item: "Бараа", unit: "ш", account: "1510", qty: 5, amount: 500 };
let payload: Record<string, unknown>[] = [];

const snapshot = () => new Date(`${DATE}T00:00:00Z`);
const stored = () => prisma.onecStock.findMany({ where: { snapshotDate: snapshot() }, orderBy: [{ itemCode: "asc" }, { warehouseCode: "asc" }] });
const logs = () => prisma.onecSyncLog.findMany({ where: { kind: "stock", period: DATE }, orderBy: { id: "asc" } });

async function wipe() {
  await prisma.onecStock.deleteMany({ where: { snapshotDate: snapshot() } });
  await prisma.onecSyncLog.deleteMany({ where: { period: DATE } });
}

beforeAll(wipe);
afterAll(wipe);
beforeEach(async () => {
  await wipe();
  Object.assign(process.env, ENV);
  payload = [{ ...base }, { ...base, item_code: "M2", item: "Хоёр", qty: 2.5, amount: 250.5 }, { ...base, warehouse_code: "00-002", warehouse: "Хоёр дахь", qty: 1, amount: 10 }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ rows: payload, count: payload.length, generated: "x" }), { status: 200 }))
  );
});

describe("syncStock: өөрчлөгдөөгүй snapshot-ийг дахин бичихгүй", () => {
  it("анх удаа бичиж, ижил агуулгыг дахин татахад мөр, id хөдөлдөггүй", async () => {
    expect(await syncStock(DATE)).toBe(3);
    const first = await stored();
    expect(first).toHaveLength(3);

    expect(await syncStock(DATE)).toBe(3);
    const second = await stored();
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id)); // устгаад дахин оруулсан бол id шинэчлэгдэнэ
    expect(second.map((r) => r.syncedAt.getTime())).toEqual(first.map((r) => r.syncedAt.getTime()));
  });

  it("алгассан ч «амжилттай» мөр onec_sync_log-д бичигдэнэ (хоцролтын шалгалт шинэхэн гэж үзнэ)", async () => {
    await syncStock(DATE);
    await syncStock(DATE);
    const l = await logs();
    expect(l).toHaveLength(2);
    expect(l.every((r) => r.ok && r.rows === 3)).toBe(true);
    expect(l[0].message).not.toContain("өөрчлөлтгүй");
    expect(l[1].message).toContain("өөрчлөлтгүй");
  });

  it("1С мөрүүдийг өөр дарааллаар буцаасан ч өөрчлөлтгүй гэж үзнэ", async () => {
    await syncStock(DATE);
    const first = await stored();
    payload = [...payload].reverse();
    await syncStock(DATE);
    expect((await stored()).map((r) => r.id)).toEqual(first.map((r) => r.id));
  });

  it("тоо өөрчлөгдвөл бүхлээр нь солино", async () => {
    await syncStock(DATE);
    const first = await stored();
    payload[1] = { ...payload[1], qty: 3 };
    await syncStock(DATE);
    const second = await stored();
    expect(second).toHaveLength(3);
    expect(second.find((r) => r.itemCode === "M2")?.qty.toString()).toBe("3");
    expect(second.map((r) => r.id).some((id) => first.map((r) => r.id).includes(id))).toBe(false); // бүх id шинэ
    expect((await logs())[1].message).not.toContain("өөрчлөлтгүй");
  });

  it("мөр нэмэгдэх, хасагдахыг мэдэрнэ", async () => {
    await syncStock(DATE);
    payload.push({ ...base, item_code: "M3", item: "Гурав" });
    await syncStock(DATE);
    expect(await stored()).toHaveLength(4);
    payload.pop();
    payload.pop();
    await syncStock(DATE);
    expect(await stored()).toHaveLength(2);
  });

  it("--force бол ижил агуулгыг ч заавал дахин бичнэ", async () => {
    await syncStock(DATE);
    const first = await stored();
    await syncStock(DATE, true);
    const second = await stored();
    expect(second).toHaveLength(3);
    expect(second.map((r) => r.id).some((id) => first.map((r) => r.id).includes(id))).toBe(false);
  });

  it("1С 0 мөр буцаасан үед байгаа өгөгдлийг хэвээр үлдээнэ (хуучин зан үйл)", async () => {
    await syncStock(DATE);
    payload = [];
    expect(await syncStock(DATE)).toBe(0);
    expect(await stored()).toHaveLength(3);
  });
});
