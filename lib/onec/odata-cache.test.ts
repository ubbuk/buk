import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_REFRESH_MS, TTL_MS, cachedLoad, resetOdataCache } from "./odata-cache";

beforeEach(resetOdataCache);

describe("OData cache: 5 минут, «Шинэчлэх» 60 сек-ээс богино давтамжгүй", () => {
  it("ижил хүсэлтийг 5 минут cache-ээс, дараа нь дахин татна", async () => {
    const load = vi.fn(async () => ({ n: load.mock.calls.length }));
    let t = 1_000_000;
    const now = () => t;
    const a = await cachedLoad("k", load, { now });
    expect(a.meta.cached).toBe(false);
    t += TTL_MS - 1000;
    const b = await cachedLoad("k", load, { now });
    expect(b.meta.cached).toBe(true);
    expect(b.value).toEqual(a.value);
    expect(b.meta.fetchedAt).toBe(a.meta.fetchedAt);
    expect(load).toHaveBeenCalledTimes(1);
    t += 2000;
    expect((await cachedLoad("k", load, { now })).meta.cached).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("өөр түлхүүр (сар) тусдаа cache", async () => {
    const load = vi.fn(async () => 1);
    await cachedLoad("usage:2026-10", load);
    await cachedLoad("usage:2026-11", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("«Шинэчлэх»: 60 сек өнгөрөөгүй бол cache-ээс (хэдэн секундийн дараа гэдгийг хэлнэ), өнгөрсөн бол дахин татна", async () => {
    const load = vi.fn(async () => load.mock.calls.length);
    let t = 5_000_000;
    const now = () => t;
    await cachedLoad("k", load, { now });
    t += 20_000;
    const limited = await cachedLoad("k", load, { now, refresh: true });
    expect(limited.meta.cached).toBe(true);
    expect(limited.meta.retryAfterSeconds).toBe(40);
    expect(load).toHaveBeenCalledTimes(1);
    t += MIN_REFRESH_MS - 20_000;
    const fresh = await cachedLoad("k", load, { now, refresh: true });
    expect(fresh.meta.cached).toBe(false);
    expect(fresh.meta.retryAfterSeconds).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("олон хүн зэрэг нээвэл 1С руу нэг л хүсэлт очно", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };
    const results = await Promise.all(Array.from({ length: 8 }, () => cachedLoad("k", load)));
    expect(calls).toBe(1);
    expect(new Set(results.map((r) => r.value)).size).toBe(1);
  });

  it("1С алдаа өгвөл хуучин өгөгдлийг (stale гэж тэмдэглэн) буцаана; хуучин байхгүй бол алдаа", async () => {
    let t = 9_000_000;
    const now = () => t;
    await cachedLoad("k", async () => "хуучин", { now });
    t += TTL_MS + 1;
    const stale = await cachedLoad("k", async () => Promise.reject(new Error("1С унтарсан")), { now });
    expect(stale.value).toBe("хуучин");
    expect(stale.meta.stale).toBe(true);
    await expect(cachedLoad("other", async () => Promise.reject(new Error("1С унтарсан")), { now })).rejects.toThrow("1С унтарсан");
  });

  it("алдаатай оролдлого in-flight-д гацахгүй: дараагийн хүсэлт дахин оролдоно", async () => {
    await expect(cachedLoad("k", async () => Promise.reject(new Error("x")))).rejects.toThrow();
    expect((await cachedLoad("k", async () => 7)).value).toBe(7);
  });
});
