import { describe, expect, it, vi } from "vitest";
import { addDays, currentMonth, currentYear, today, ubDate } from "./dates";

// Улаанбаатар = UTC+8, зуны цаггүй. Сервер (Vercel, GitHub Actions) UTC-д ажилладаг тул хоёр цагийн хилийн хооронд (UTC 16:00–24:00)
// UTC-ийн огноо УБ-ын огнооноос нэг хоногоор хоцордог. Эдгээр тест яг тэр цонхыг шалгана.
describe("ubDate: Улаанбаатарын хуанлийн өдөр", () => {
  it("UTC 16:00 хүртэл ижил өдөр, түүнээс хойш маргааш", () => {
    expect(ubDate(new Date("2026-11-17T15:59:59Z"))).toBe("2026-11-17"); // 23:59:59 УБ
    expect(ubDate(new Date("2026-11-17T16:00:00Z"))).toBe("2026-11-18"); // 00:00:00 УБ
  });
  it("УБ-ын 00:00–08:00 (UTC-ийн өчигдөр) нь UTC-ийн огнооноос ялгаатай", () => {
    const at = new Date("2026-11-17T20:30:00Z"); // 04:30 УБ, 11-18
    expect(at.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(ubDate(at)).toBe("2026-11-18");
  });
  it("сар, жилийн хилийг дамжина", () => {
    expect(ubDate(new Date("2026-10-31T17:00:00Z"))).toBe("2026-11-01");
    expect(ubDate(new Date("2026-12-31T17:00:00Z"))).toBe("2027-01-01");
  });
});

describe("currentYear: шинэ жил УБ-ын 00:00-д эхэлнэ", () => {
  it("UTC-д хуучин жил хэвээр боловч УБ-д шинэ жил болсон", () => {
    const at = new Date("2026-12-31T17:00:00Z"); // 2027-01-01 01:00 УБ
    expect(at.getUTCFullYear()).toBe(2026);
    expect(currentYear(at)).toBe(2027);
  });
  it("УБ-ын шинэ жилээс нэг минутын өмнө хуучин жил", () => {
    expect(currentYear(new Date("2026-12-31T15:59:00Z"))).toBe(2026); // 23:59 УБ
    expect(currentYear(new Date("2026-12-31T16:00:00Z"))).toBe(2027); // 00:00 УБ
  });
});

describe("today, currentMonth: системийн цагийг УБ-аар унших", () => {
  it("UTC-ийн сарын сүүлийн өдрийн орой УБ-д дараа сарын 1", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-31T18:00:00Z")); // 02:00 УБ, 11-01
      expect(today()).toBe("2026-11-01");
      expect(currentMonth()).toBe("2026-11");
      expect(currentYear()).toBe(2026);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("addDays", () => {
  it("сар, жилийн хилийг дамжиж, хоёр чиглэлд ажиллана", () => {
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-11-13", -30)).toBe("2026-10-14");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29"); // дөрөв дэх жил
    expect(addDays("2026-11-13", 0)).toBe("2026-11-13");
  });
});
