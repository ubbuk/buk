import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetOdataCache } from "./odata-cache";
import { evaluateStaleness, fetchBaseHealth, notifyAdminsStale, STALE_DAYS, STALE_MESSAGE, type BaseHealth } from "./health";

describe("evaluateStaleness: 7 хоногоос дээш шинэ баримт ороогүй бол хоцорсон", () => {
  it("хэмжээ: 7 хоног хүртэл хэвийн, 8 хоногоос хоцорсон; баримт огт байхгүй бол хоцорсон", () => {
    expect(STALE_DAYS).toBe(7);
    expect(evaluateStaleness("2026-11-13", "2026-11-13")).toEqual({ daysSince: 0, stale: false });
    expect(evaluateStaleness("2026-11-06", "2026-11-13")).toEqual({ daysSince: 7, stale: false });
    expect(evaluateStaleness("2026-11-05", "2026-11-13")).toEqual({ daysSince: 8, stale: true });
    expect(evaluateStaleness("2026-12-31", "2027-01-10")).toEqual({ daysSince: 10, stale: true }); // жилийн заагийг давсан
    expect(evaluateStaleness(null, "2026-11-13")).toEqual({ daysSince: null, stale: true });
  });
  it("мэдэгдлийн текст нь шаардсан үгтэй яг тохирно", () => {
    expect(STALE_MESSAGE).toBe("1С-д сүүлийн 7 хоногт шинэ баримт ороогүй байна. Шинэ оны бааз руу шилжсэн бол ERP-ийн тохиргоог шинэчилнэ үү.");
  });
});

describe("fetchBaseHealth (fetch дуурайлгасан; GET)", () => {
  const calls: string[] = [];
  const ENV = { ONEC_BASES: '{"2026":"http://1c.test/BUK_NBB_2026"}', ONEC_ODATA_USER: "u", ONEC_ODATA_PASSWORD: "p" };
  let latest: Record<string, string | null> = {};
  let failing = false;

  beforeEach(() => {
    calls.length = 0;
    failing = false;
    latest = { РеализацияТоваровУслуг: "2026-11-12T09:00:00", ТребованиеНакладная: "2026-11-02T00:00:00" };
    Object.assign(process.env, ENV);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(init.method ?? "GET").toBe("GET");
        const u = decodeURIComponent(url);
        calls.push(u);
        if (failing) return new Response("boom", { status: 500 });
        const entity = Object.keys(latest).find((k) => u.includes(`Document_${k}`))!;
        return new Response(JSON.stringify({ value: latest[entity] ? [{ Date: latest[entity] }] : [] }), { status: 200 });
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(ENV)) delete process.env[k];
    resetOdataCache();
  });

  it("борлуулалт, шаардах хуудасны хамгийн сүүлийн огноо: шинэ нь аваг; ≤ 7 хоног бол хэвийн", async () => {
    const h = await fetchBaseHealth("2026", "2026-11-13");
    expect(h).toMatchObject({ year: "2026", configured: true, unreachable: false, lastDocument: "2026-11-12", daysSince: 1, stale: false });
    const q = calls.find((c) => c.includes("РеализацияТоваровУслуг"))!;
    expect(q).toContain("Posted eq true and Date le datetime'2026-11-13T23:59:59'"); // ирээдүйн огноотой баримт «шинэ» гэж тооцогдохгүй
    expect(q).toContain("$orderby=Date desc");
    expect(calls.every((c) => c.startsWith("http://1c.test/BUK_NBB_2026/odata/"))).toBe(true);
  });

  it("2 төрлийн баримт хоёулаа 7 хоногоос өмнөх бол хоцорсон", async () => {
    latest = { РеализацияТоваровУслуг: "2026-10-20T00:00:00", ТребованиеНакладная: "2026-10-30T00:00:00" };
    expect(await fetchBaseHealth("2026", "2026-11-13")).toMatchObject({ lastDocument: "2026-10-30", daysSince: 14, stale: true });
  });

  it("бааз хоосон (шинэ он эхэлсэн) бол хоцорсон", async () => {
    latest = { РеализацияТоваровУслуг: null, ТребованиеНакладная: null };
    expect(await fetchBaseHealth("2026", "2027-01-10")).toMatchObject({ lastDocument: null, stale: true });
  });

  it("1С холбогдохгүй бол «хоцорсон» гэж буруу мэдэгдэхгүй (unreachable)", async () => {
    failing = true;
    expect(await fetchBaseHealth("2026", "2026-11-13")).toMatchObject({ configured: true, unreachable: true, stale: false });
  });

  it("бааз тохируулаагүй оны хувьд 1С руу хандахгүй", async () => {
    expect(await fetchBaseHealth("2027", "2027-01-10")).toMatchObject({ configured: false, stale: false });
    expect(calls).toHaveLength(0);
  });
});

describe("notifyAdminsStale: ADMIN-д 24 цагт нэг удаа", () => {
  const YEAR = "2098"; // бусад тестээс тусгаарлах
  const stale: BaseHealth = { year: YEAR, configured: true, unreachable: false, lastDocument: "2098-01-01", daysSince: 12, stale: true };
  const titleLike = `1С (${YEAR} оны бааз)`;
  const clean = async () => {
    await prisma.notification.deleteMany({ where: { title: { startsWith: titleLike } } });
    await prisma.onecSyncLog.deleteMany({ where: { kind: "stale-alert", period: YEAR } });
  };
  beforeEach(clean);
  afterAll(clean);

  it("идэвхтэй ADMIN бүрт мэдэгдэл, давтан дуудахад дахин илгээхгүй; ADMIN биш хэрэглэгчид очихгүй", async () => {
    const admins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
    expect(admins).toBeGreaterThan(0);
    expect(await notifyAdminsStale(stale)).toBe("sent");
    const rows = await prisma.notification.findMany({ where: { title: { startsWith: titleLike } }, include: { user: { select: { role: true, isActive: true } } } });
    expect(rows).toHaveLength(admins);
    expect(rows.every((r) => r.user.role === "ADMIN" && r.user.isActive && r.type === "GENERIC" && !r.isRead)).toBe(true);
    expect(rows[0].body).toContain(STALE_MESSAGE);
    expect(rows[0].body).toContain("2098-01-01");
    expect(await notifyAdminsStale(stale)).toBe("recent");
    expect(await prisma.notification.count({ where: { title: { startsWith: titleLike } } })).toBe(admins);
    // 24 цагийн дараа дахин
    expect(await notifyAdminsStale(stale, Date.now() + 25 * 60 * 60_000)).toBe("sent");
  });

  it("хоцроогүй, холбогдоогүй, тохируулаагүй бол мэдэгдэхгүй", async () => {
    expect(await notifyAdminsStale({ ...stale, stale: false })).toBe("not_stale");
    expect(await notifyAdminsStale({ ...stale, unreachable: true })).toBe("not_stale");
    expect(await notifyAdminsStale({ ...stale, configured: false })).toBe("not_stale");
    expect(await prisma.notification.count({ where: { title: { startsWith: titleLike } } })).toBe(0);
  });
});
