import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCompactMnt, formatFullMnt } from "@/lib/format-mnt";
import { buildOverview, loadFinanceOverview } from "./overview";
import { canViewOverview, OVERVIEW_ROLES } from "./roles";

const at = (ub: string) => new Date(`${ub.replace(" ", "T")}:00+08:00`); // Улаанбаатарын цаг

describe("төгрөг товчлох", () => {
  it("тэрбум, сая, их наяд; бүтэн тоо нь hover-т", () => {
    expect(formatCompactMnt(10_490_123_456)).toBe("10.49 тэрбум₮");
    expect(formatCompactMnt(20_060_542_378.35)).toBe("20.06 тэрбум₮");
    expect(formatCompactMnt(826_391_500.45)).toBe("826.39 сая₮");
    expect(formatCompactMnt(1_250_000_000_000)).toBe("1.25 их наяд₮");
    expect(formatCompactMnt(12_500)).toBe("12,500₮");
    expect(formatCompactMnt(-2_500_000_000)).toBe("−2.50 тэрбум₮");
    expect(formatFullMnt(10_490_123_456.4)).toBe("10,490,123,456₮");
  });
});

describe("эрх: 1С самбарыг харах эрхтэй, ENGINEERING-гүй дүрүүд", () => {
  it("ADMIN, DIRECTOR, CHIEF_ACCOUNTANT, BOSS зөвхөн", () => {
    expect([...OVERVIEW_ROLES].sort()).toEqual(["ADMIN", "BOSS", "CHIEF_ACCOUNTANT", "DIRECTOR"]);
    for (const r of ["ENGINEERING", "STOREKEEPER", "MANAGER", "EMPLOYEE", "", undefined, null]) expect(canViewOverview(r as string), String(r)).toBe(false);
  });
});

describe("buildOverview: хуучирсан эсэх (60 минут, хуваарийн дагуу)", () => {
  const ok = (now: string, syncs: [string, string, string]) =>
    buildOverview({
      now: at(now),
      stock: { value: 1, asOf: "2026-11-18", syncedAt: at(syncs[0]) },
      receivables: { value: 2, asOf: "2026-11-18", syncedAt: at(syncs[1]) },
      sales: { value: 3, asOf: "2026-11", syncedAt: at(syncs[2]) },
    });

  it("хуваарьт цагт бүгд 60 минутаас шинэ бол анхааруулгагүй; updatedAt нь хамгийн хуучин sync", () => {
    const o = ok("2026-11-18 11:00", ["2026-11-18 10:50", "2026-11-18 10:45", "2026-11-18 10:55"]);
    expect(o.stale).toBe(false);
    expect(o.staleMessage).toBeNull();
    expect(o.updatedAt).toBe(at("2026-11-18 10:45").toISOString());
    expect(o.cards.map((c) => c.key)).toEqual(["stock", "receivables", "sales"]);
  });

  it("хуваарьт цагт нэг нь 60 минутаас хуучин бол шар анхааруулга", () => {
    const o = ok("2026-11-18 11:00", ["2026-11-18 10:50", "2026-11-18 09:30", "2026-11-18 10:55"]);
    expect(o.stale).toBe(true);
    expect(o.staleMessage).toContain("шинэчлэгдсэн");
  });

  it("орой, ням гарагт (хуваарьгүй) өмнөх цонхны хаалттай харьцуулна: худлаа анхааруулга гарахгүй", () => {
    expect(ok("2026-11-18 23:30", ["2026-11-18 19:45", "2026-11-18 19:45", "2026-11-18 19:45"]).stale).toBe(false);
    expect(ok("2026-11-22 12:00", ["2026-11-21 19:45", "2026-11-21 19:45", "2026-11-21 19:45"]).stale).toBe(false); // ням
    expect(ok("2026-11-22 12:00", ["2026-11-21 15:00", "2026-11-21 19:45", "2026-11-21 19:45"]).stale).toBe(true); // өмнөх өдрийн сүүлийн цагт sync унасан
  });

  it("sync хэзээ ч болоогүй бол «хараахан шинэчлэгдээгүй»", () => {
    const o = buildOverview({
      now: at("2026-11-18 11:00"),
      stock: { value: null, asOf: null, syncedAt: null },
      receivables: { value: null, asOf: null, syncedAt: null },
      sales: { value: null, asOf: null, syncedAt: null },
    });
    expect(o).toMatchObject({ stale: true, updatedAt: null });
    expect(o.cards.every((c) => c.value === null)).toBe(true);
  });
});

describe("loadFinanceOverview: зөвхөн Postgres, 1С руу ХЭЗЭЭ Ч хандахгүй", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("гурван карт буцаана, fetch нэг ч удаа дуудагдахгүй", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const o = await loadFinanceOverview();
    expect(o.cards.map((c) => c.key)).toEqual(["stock", "receivables", "sales"]);
    for (const c of o.cards) expect(c.value === null || typeof c.value === "number").toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
