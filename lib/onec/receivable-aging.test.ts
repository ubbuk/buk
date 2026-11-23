import { describe, expect, it } from "vitest";
import { ageCustomer, bucketOf, daysBetween, nameKey, totalAging } from "./receivable-aging";

const ASOF = "2026-10-31";
const inv = (date: string, total: number) => ({ date, total });

describe("bucketOf / daysBetween", () => {
  it("0–30, 31–60, 61–90, 90+ хоног", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(bucketOf)).toEqual(["b0_30", "b0_30", "b31_60", "b31_60", "b61_90", "b61_90", "b90", "b90"]);
    expect(daysBetween("2026-10-01", ASOF)).toBe(30);
  });
});

describe("ageCustomer: FIFO (төлбөр хамгийн хуучныг хаана, үлдсэн нь сүүлийн борлуулалтууд)", () => {
  it("өр нь сүүлийн борлуулалтаас эхэлж хуваарилагдана", () => {
    const a = ageCustomer(150, [inv("2026-10-25", 100), inv("2026-09-10", 100), inv("2026-05-01", 500)], ASOF, "2026-01-01");
    expect(a).toMatchObject({ b0_30: 100, b31_60: 50, b61_90: 0, b90: 0, unknown: 0 });
    expect(a.oldestDays).toBe(51); // 09-10 -> 10-31
  });

  it("өр нь нэг борлуулалтаас бага бол зөвхөн тэр нас", () => {
    expect(ageCustomer(40, [inv("2026-07-01", 100)], ASOF, "2026-01-01")).toMatchObject({ b90: 40 });
  });

  it("түүхээс давсан үлдэгдэл: түүх 90+ хоногийг хамарсан бол «90+», үгүй бол «Тодорхойгүй»", () => {
    expect(ageCustomer(300, [inv("2026-10-20", 100)], ASOF, "2026-01-01")).toMatchObject({ b0_30: 100, b90: 200, unknown: 0 });
    expect(ageCustomer(300, [inv("2026-10-20", 100)], ASOF, "2026-09-01")).toMatchObject({ b0_30: 100, b90: 0, unknown: 200 });
    expect(ageCustomer(300, [inv("2026-10-20", 100)], ASOF, null)).toMatchObject({ unknown: 200 });
  });

  it("борлуулалтын баримт огт олдоогүй харилцагч: нас таамаглахгүй, бүгд «Тодорхойгүй»", () => {
    expect(ageCustomer(1000, [], ASOF, "2026-01-01")).toMatchObject({ b90: 0, unknown: 1000, oldestDays: null });
  });

  it("урьдчилж төлсөн (сөрөг) ба 0 нь нас байхгүй; ирээдүйн огнотой борлуулалтыг тоохгүй; нийлбэр үлдэгдэлтэй тэнцүү", () => {
    expect(ageCustomer(-50, [inv("2026-10-20", 100)], ASOF, "2026-01-01")).toMatchObject({ b0_30: 0, unknown: 0 });
    const a = ageCustomer(250.55, [inv("2026-11-05", 999), inv("2026-10-30", 100.1), inv("2026-08-01", 90.25)], ASOF, "2026-01-01");
    expect(a.b0_30 + a.b31_60 + a.b61_90 + a.b90 + a.unknown).toBeCloseTo(250.55, 2);
  });
});

describe("totalAging", () => {
  it("бүлэг бүрийн нийлбэр, харилцагчийн тоо, 30-аас дээш хоног", () => {
    const t = totalAging([
      { b0_30: 10, b31_60: 20, b61_90: 0, b90: 0, unknown: 0, oldestDays: 40 },
      { b0_30: 0, b31_60: 0, b61_90: 5, b90: 100, unknown: 7, oldestDays: 200 },
    ]);
    expect(t.buckets.map((b) => [b.key, b.amount, b.customers])).toEqual([["b0_30", 10, 1], ["b31_60", 20, 1], ["b61_90", 5, 1], ["b90", 100, 1], ["unknown", 7, 1]]);
    expect(t.over30).toBe(125);
  });
});

describe("nameKey: нэрийн тулгалт", () => {
  it("том жижиг үсэг, зай, ХХК, цэг таслал үл харгалзана", () => {
    expect(nameKey("МОНГОЛЫН ТӨМӨР ЗАМ ТӨХК")).toBe(nameKey("Монголын төмөр зам төхк"));
    expect(nameKey("Альфа ХХК")).toBe(nameKey("  АЛЬФА   ххк "));
    expect(nameKey("«Бета», ХХК")).toBe(nameKey("бета"));
    expect(nameKey("Альфа")).not.toBe(nameKey("Бета"));
  });
});
