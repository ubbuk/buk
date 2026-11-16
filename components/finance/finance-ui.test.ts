import { describe, expect, it } from "vitest";
import { aggregateDaily, untilDate, weekStart } from "./aggregate";
import { connectionFrom, formatStamp } from "./FinanceShell";

const days = Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, amount: i + 1, count: 1 }));

describe("график: өдөр / 7 хоног / сар нэгтгэл (зөвхөн өгөгдсөн тоонуудын нийлбэр)", () => {
  it("өдрөөр нь хэвээр", () => {
    expect(aggregateDaily(days, "day", ["amount"])).toBe(days);
  });
  it("7 хоногоор: 1-7, 8-14, 15-21, 22-28, 29-31; нийлбэр өөрчлөгдөхгүй", () => {
    const w = aggregateDaily(days, "week", ["amount", "count"]);
    expect(w.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
    expect(w.map((p) => p.amount)).toEqual([28, 77, 126, 175, 90]);
    expect(w.map((p) => p.count)).toEqual([7, 7, 7, 7, 3]);
    expect(w.reduce((s, p) => s + Number(p.amount), 0)).toBe(days.reduce((s, d) => s + d.amount, 0));
  });
  it("сараар: нэг багана", () => {
    expect(aggregateDaily(days, "month", ["amount"])).toEqual([{ date: "2026-10", amount: 496 }]);
  });
  it("одоогийн сар бол өнөөдөр хүртэл л (ирээдүйн өдөр байхгүй); өнгөрсөн сар бол бүгд", () => {
    expect(untilDate(days, "2026-10-13")).toHaveLength(13);
    expect(untilDate(days, "2026-10-13").at(-1)?.date).toBe("2026-10-13");
    expect(untilDate(days)).toBe(days);
    expect(aggregateDaily(untilDate(days, "2026-10-09"), "week", ["amount"]).map((p) => p.amount)).toEqual([28, 17]);
  });
  it("weekStart", () => {
    expect([1, 7, 8, 14, 15, 28, 29, 31].map((d) => weekStart(`2026-10-${String(d).padStart(2, "0")}`))).toEqual([1, 1, 8, 8, 15, 22, 29, 29]);
  });
});

describe("толгойн төлөв, огноо", () => {
  it("«1С холбогдсон» зөвхөн сүүлд татсан цаг 30 минутаас дотор үед; татаж чадаагүй бол холбогдохгүй; мэдээлэлгүй бол нуух", () => {
    const now = Date.parse("2026-11-13T10:00:00Z");
    expect(connectionFrom("2026-11-13T09:50:00Z", false, now)).toBe("ok");
    expect(connectionFrom("2026-11-13T09:20:00Z", false, now)).toBeNull();
    expect(connectionFrom("2026-11-13T09:50:00Z", true, now)).toBe("offline");
    expect(connectionFrom(null, false, now)).toBeNull();
  });
  it("сүүлд шинэчилсэн: «2026.11.13 16:04» (Улаанбаатарын цаг, UTC+8)", () => {
    expect(formatStamp("2026-11-13T08:04:00Z")).toBe("2026.11.13 16:04");
    expect(formatStamp(null)).toBe("—");
  });
});
