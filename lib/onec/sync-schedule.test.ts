import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SYNC_SCHEDULE, evaluateStockFreshness, formatAgo, formatUbDateTime, isScheduledTime, lastScheduledMoment } from "./sync-schedule";

/** "2026-11-16 10:30" Улаанбаатарын цагаар → Date (UTC+8) */
const ub = (s: string): Date => new Date(`${s.replace(" ", "T")}:00+08:00`);

// 2026-11-14 Бямба, 15 Ням, 16 Даваа, 17 Мягмар
describe("isScheduledTime: Даваа–Бямба 09:00–20:00 Улаанбаатар", () => {
  it("цонхны дотор", () => {
    expect(isScheduledTime(ub("2026-11-16 09:00"))).toBe(true);
    expect(isScheduledTime(ub("2026-11-16 19:59"))).toBe(true);
    expect(isScheduledTime(ub("2026-11-14 12:00"))).toBe(true); // Бямба
  });
  it("цонхны гадна: орой, өглөө эрт, ням гараг", () => {
    expect(isScheduledTime(ub("2026-11-16 08:59"))).toBe(false);
    expect(isScheduledTime(ub("2026-11-16 20:00"))).toBe(false);
    expect(isScheduledTime(ub("2026-11-15 12:00"))).toBe(false); // Ням
  });
  it("UTC өдөр биш Улаанбаатарын өдрөөр: Даваа 06:00 УБ = Ням 22:00 UTC", () => {
    expect(isScheduledTime(new Date("2026-11-15T22:00:00Z"))).toBe(false);
    expect(isScheduledTime(new Date("2026-11-16T01:00:00Z"))).toBe(true); // Даваа 09:00 УБ
  });
});

describe("lastScheduledMoment", () => {
  it("цонхонд байвал одоо", () => {
    const now = ub("2026-11-16 12:34");
    expect(lastScheduledMoment(now).getTime()).toBe(now.getTime());
  });
  it("оройд өнөөдрийн 20:00", () => {
    expect(lastScheduledMoment(ub("2026-11-17 22:10")).getTime()).toBe(ub("2026-11-17 20:00").getTime());
  });
  it("Даваа өглөө эрт ба Ням гарагт Бямба гарагийн 20:00", () => {
    expect(lastScheduledMoment(ub("2026-11-16 07:00")).getTime()).toBe(ub("2026-11-14 20:00").getTime());
    expect(lastScheduledMoment(ub("2026-11-15 15:00")).getTime()).toBe(ub("2026-11-14 20:00").getTime());
  });
});

describe("evaluateStockFreshness", () => {
  it("хуваарьт цагт 1 цагаас дотор бол хэвийн, хуучин бол анхааруулга", () => {
    expect(evaluateStockFreshness(ub("2026-11-16 09:45"), ub("2026-11-16 10:30")).stale).toBe(false);
    expect(evaluateStockFreshness(ub("2026-11-16 09:30"), ub("2026-11-16 10:30")).stale).toBe(false); // яг 1 цаг
    const f = evaluateStockFreshness(ub("2026-11-16 09:20"), ub("2026-11-16 10:30"));
    expect(f.stale).toBe(true);
    expect(f.message).toBe("1С-ийн өгөгдөл 1 цагийн өмнө шинэчлэгдсэн. Тоо хуучирсан байж магадгүй.");
  });
  it("Даваа өглөө хуваарь эхэлсэн мөчид өмнөх Бямбын өгөгдөл хуучин: анхааруулна", () => {
    const f = evaluateStockFreshness(ub("2026-11-14 19:45"), ub("2026-11-16 09:05"));
    expect(f.stale).toBe(true);
    expect(f.message).toBe("1С-ийн өгөгдөл 37 цагийн өмнө шинэчлэгдсэн. Тоо хуучирсан байж магадгүй.");
  });
  it("хуваарийн бус цагт, өмнөх цонхны сүүлд (19:45) шинэчлэгдсэн бол анхааруулахгүй", () => {
    expect(evaluateStockFreshness(ub("2026-11-16 19:45"), ub("2026-11-16 23:30")).stale).toBe(false); // орой
    expect(evaluateStockFreshness(ub("2026-11-14 19:45"), ub("2026-11-15 14:00")).stale).toBe(false); // ням
    expect(evaluateStockFreshness(ub("2026-11-14 19:45"), ub("2026-11-16 08:00")).stale).toBe(false); // даваа өглөө эрт
  });
  it("хуваарийн бус цагт ч өмнөх ажлын өдрийн 20:00-ийн өмнө (1 цагаас илүү) шинэчлэгдсэн бол анхааруулна", () => {
    expect(evaluateStockFreshness(ub("2026-11-16 18:00"), ub("2026-11-16 23:30")).stale).toBe(true); // орой
    expect(evaluateStockFreshness(ub("2026-11-14 18:59"), ub("2026-11-15 14:00")).stale).toBe(true); // ням, 19:00-аас өмнө
    expect(evaluateStockFreshness(ub("2026-11-13 19:45"), ub("2026-11-15 14:00")).stale).toBe(true); // Баасан: Бямба огт татагдаагүй
  });
  it("хэзээ ч амжилттай sync болоогүй бол ямагт анхааруулна", () => {
    const f = evaluateStockFreshness(null, ub("2026-11-15 14:00"));
    expect(f).toMatchObject({ stale: true, never: true, ageMs: null });
    expect(f.message).toContain("хараахан шинэчлэгдээгүй");
  });
  it("Сүүлд шинэчилсэн цаг ирээдүйд (цагийн зөрүү) байвал хэвийн, нас 0", () => {
    const f = evaluateStockFreshness(ub("2026-11-16 10:35"), ub("2026-11-16 10:30"));
    expect(f).toMatchObject({ stale: false, ageMs: 0 });
  });
});

describe("форматууд", () => {
  it("formatAgo: цаг, 48 цагаас дээш бол өдөр", () => {
    expect(formatAgo(90 * 60_000)).toBe("1 цагийн өмнө");
    expect(formatAgo(5 * 3_600_000)).toBe("5 цагийн өмнө");
    expect(formatAgo(47 * 3_600_000)).toBe("47 цагийн өмнө");
    expect(formatAgo(50 * 3_600_000)).toBe("2 өдрийн өмнө");
  });
  it("formatUbDateTime: Улаанбаатарын цагаар, өдөр хөндлөн гарна", () => {
    expect(formatUbDateTime(new Date("2026-11-14T11:45:00Z"))).toBe("2026-11-14 19:45");
    expect(formatUbDateTime(new Date("2026-11-14T17:30:00Z"))).toBe("2026-11-15 01:30");
  });
});

// Хуваарийн ганц эх сурвалж энд; workflow-ийн cron (UTC) нь түүнтэй таарах ёстой. Зөвхөн нэгийг нь өөрчилбөл энд унана.
describe(".github/workflows/sync-1c.yml-ийн cron нь SYNC_SCHEDULE-тэй таарна", () => {
  const yml = readFileSync(path.join(__dirname, "../../.github/workflows/sync-1c.yml"), "utf8");
  const regular = yml.match(/cron:\s*"([^"]+)"/)?.[1] ?? "";
  const [, hours, , , dow] = regular.split(/\s+/);

  it("эхний cron (regular) олдсон", () => {
    expect(regular.split(/\s+/)).toHaveLength(5);
  });
  it("цаг: cron-ийн UTC цагууд = УБ-ийн startHour … endHour-1", () => {
    const [from, to] = hours.split("-").map(Number);
    expect(from + SYNC_SCHEDULE.utcOffsetHours).toBe(SYNC_SCHEDULE.startHour);
    expect(to + 1 + SYNC_SCHEDULE.utcOffsetHours).toBe(SYNC_SCHEDULE.endHour); // сүүлийн цаг 11:xx UTC = 19:xx УБ
  });
  it("өдөр: Даваа–Бямба", () => {
    const [from, to] = dow.split("-").map(Number);
    expect(Array.from({ length: to - from + 1 }, (_, i) => from + i)).toEqual([...SYNC_SCHEDULE.days]);
  });
});
