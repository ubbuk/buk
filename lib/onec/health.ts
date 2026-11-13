// Хамгаалалт: ERP-ийн холбогдсон 1С баазад сүүлийн баримт хэзээ орсныг шалгана. Бааз жил бүр солигддог тул (BUK_NBB_2026 -> 2027) ERP хуучин
// баазтай үлдвэл самбар «шинэ» өгөгдөл өгөхгүй байхад хэн ч анзаарахгүй. Борлуулалтын (Document_РеализацияТоваровУслуг) болон
// Шаардах хуудас (Document_ТребованиеНакладная)-ийн хамгийн сүүлийн батлагдсан баримтын огноо 7 хоногоос дээш өмнөх бол анхааруулна,
// ADMIN-д мэдэгдэнэ. Зөвхөн 1С-ээс УНШИНА (GET). 1С холбогдохгүй бол «хоцорсон» гэж буруу мэдэгдэхгүй (unreachable).
import { prisma } from "@/lib/prisma";
import { isBaseConfigured } from "./bases";
import { currentMonth, today } from "./dates";
import { cachedLoad } from "./odata-cache";
import { enc, odataRows } from "./odata-read";
import { lastAttempt } from "./refresh";
import { withOneCYear } from "./year-context";

export const STALE_DAYS = 7;
export const STALE_MESSAGE = "1С-д сүүлийн 7 хоногт шинэ баримт ороогүй байна. Шинэ оны бааз руу шилжсэн бол ERP-ийн тохиргоог шинэчилнэ үү.";
const DOCUMENTS = ["Document_РеализацияТоваровУслуг", "Document_ТребованиеНакладная"] as const;
const ALERT_KIND = "stale-alert";
const ALERT_EVERY_MS = 24 * 60 * 60_000;

export interface BaseHealth {
  year: string;
  configured: boolean;
  /** 1С холбогдсонгүй (хоцорсон эсэхийг мэдэхгүй) */
  unreachable: boolean;
  /** хамгийн сүүлийн батлагдсан баримтын огноо (YYYY-MM-DD) */
  lastDocument: string | null;
  daysSince: number | null;
  stale: boolean;
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/** Цэвэр дүгнэлт (тестлэгдэнэ): хамгийн сүүлийн огнооноос өнөөдөр хүртэлх хоног, 7-оос их бол хоцорсон. Баримт огт байхгүй бол хоцорсон. */
export function evaluateStaleness(lastDocument: string | null, todayDate: string): { daysSince: number | null; stale: boolean } {
  if (!lastDocument) return { daysSince: null, stale: true };
  const daysSince = Math.max(0, dayNumber(todayDate) - dayNumber(lastDocument));
  return { daysSince, stale: daysSince > STALE_DAYS };
}

/** Нэг баримтын төрлийн өнөөдрөөс хэтрээгүй хамгийн сүүлийн батлагдсан баримтын огноо (ирээдүйн огноотой баримт «шинэ» гэж тооцогдохгүй) */
async function latestDate(entity: string, todayDate: string): Promise<string | null> {
  const filter = `Posted eq true and Date le datetime'${todayDate}T23:59:59'`;
  const rows = await odataRows(`${enc(entity)}?$format=json&$select=${enc("Date")}&$filter=${enc(filter)}&$orderby=${enc("Date desc")}&$top=1`, { timeoutMs: 30_000 });
  const d = String(rows[0]?.Date ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export async function fetchBaseHealth(year: string, todayDate: string = today()): Promise<BaseHealth> {
  if (!isBaseConfigured(year)) return { year, configured: false, unreachable: false, lastDocument: null, daysSince: null, stale: false };
  try {
    const dates = await withOneCYear(year, () => Promise.all(DOCUMENTS.map((e) => latestDate(e, todayDate))));
    const lastDocument = dates.filter((d): d is string => !!d).sort().at(-1) ?? null;
    return { year, configured: true, unreachable: false, lastDocument, ...evaluateStaleness(lastDocument, todayDate) };
  } catch {
    return { year, configured: true, unreachable: true, lastDocument: null, daysSince: null, stale: false };
  }
}

/** 5 минутын cache (олон хүн нээвэл 1С руу нэг л хүсэлт) */
export async function loadBaseHealth(year: string, refresh = false): Promise<BaseHealth> {
  const { value } = await cachedLoad(`health:${year}:${today()}`, () => fetchBaseHealth(year), { refresh });
  return value;
}

/**
 * Хоцорсон бол идэвхтэй ADMIN бүрт мэдэгдэл өгнө. 24 цагт нэг удаа (onec_sync_log-ийн «stale-alert»-ээр давхардлаас сэргийлнэ), тиймээс
 * самбарыг олон хүн нээх, workflow давтан ажиллах нь мэдэгдлийг үржүүлэхгүй.
 */
export async function notifyAdminsStale(health: BaseHealth, now = Date.now()): Promise<"sent" | "recent" | "no_admins" | "not_stale"> {
  if (!health.stale || !health.configured || health.unreachable) return "not_stale";
  const last = await lastAttempt(ALERT_KIND, health.year);
  if (last && now - last.at.getTime() < ALERT_EVERY_MS) return "recent";
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  if (admins.length === 0) return "no_admins";
  const detail = health.lastDocument ? `Сүүлийн баримт ${health.lastDocument} (${health.daysSince} хоногийн өмнө).` : "Баазад батлагдсан баримт олдсонгүй.";
  await prisma.$transaction([
    prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.id, type: "GENERIC" as const, title: `1С (${health.year} оны бааз): шинэ баримт ороогүй байна`, body: `${STALE_MESSAGE} ${detail}` })) }),
    prisma.onecSyncLog.create({ data: { kind: ALERT_KIND, period: health.year, rows: admins.length, ok: true, message: detail, startedAt: new Date(now) } }),
  ]);
  return "sent";
}

/** Одоогийн оны баазыг шалгаж, хоцорсон бол мэдэгдэнэ (GitHub Actions болон самбарын health route) */
export async function checkCurrentBase(): Promise<{ health: BaseHealth; notified: Awaited<ReturnType<typeof notifyAdminsStale>> }> {
  const health = await loadBaseHealth(currentMonth().slice(0, 4));
  return { health, notified: await notifyAdminsStale(health) };
}
