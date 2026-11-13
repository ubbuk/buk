// 1С санхүүгийн самбарын шинэчлэлт: хуудас нээгдэхэд (агуулах) болон хуучирсан бол ар талд (борлуулалт, мөнгөн хөрөнгө).
// Зөвхөн УНШИХ: 1С руу GET-ээр л хандана (lib/onec/client.ts), 1С руу бичих код байхгүй.
//
//  * Агуулах: 1С-ээс шууд татна (timeout 10 сек, нэг оролдлого). 1С-ийг 1 минутад ганц удаа: сүүлийн оролдлогоос (амжилттай ч,
//    амжилтгүй ч) 60 сек өнгөрөөгүй бол дахин дуудахгүй, Postgres-ийн өгөгдлийг харуулна.
//  * Борлуулалт, мөнгөн хөрөнгө, P&L: хуудсыг Postgres-ээс шууд харуулна. Сүүлийн оролдлогоос 5 минут өнгөрсөн бол ар талд
//    сарыг татна (хэрэглэгчийг хүлээлгэхгүй). «Одоо шинэчлэх» товч мөн ижил 5 минутын хязгаарыг дагана.
//  * Нэг зэрэг ганцхан татах ажил: onec_sync_lock дахь түрээс (lease). Хугацаа нь DB-ийн цагаар дуусдаг тул процесс үхсэн ч
//    хаалт өөрөө суллагдана. Хаалт дотор хязгаарыг дахин шалгана (хоёр хүсэлт зэрэг ирвэл нэг нь л татна).
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { syncCashMonth, syncPlMonth, syncSalesMonth, syncStock, today } from "./sync";

export const STOCK_MIN_INTERVAL_MS = 60_000;
export const STOCK_TIMEOUT_MS = 10_000;
export const MONTH_STALE_MS = 5 * 60_000;
const STOCK_LOCK_TTL_MS = 60_000; // 10 сек таталт + DB-д бичих
const MONTH_LOCK_TTL_MS = 15 * 60_000; // борлуулалт ~1 мин, мөнгөн хөрөнгө ~30 сек; ажил хооронд сунгана
const LOCK_NAME = "onec-sync";
const MONTH_KINDS = ["sales", "pl", "cash"] as const;
export type MonthKind = (typeof MONTH_KINDS)[number];
const MONTH_JOBS = { sales: syncSalesMonth, pl: syncPlMonth, cash: syncCashMonth } as const;

// ---- хаалт (lease) ----

/** Хаалт авсан бол true. Хугацаа дууссан түрээсийг л булаана; DB-ийн цагаар. */
export async function acquireLock(holder: string, ttlMs: number, name: string = LOCK_NAME): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ holder: string }[]>`
    INSERT INTO onec_sync_lock (name, holder, locked_until)
    VALUES (${name}, ${holder}, now() + (${ttlMs}::int * interval '1 millisecond'))
    ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, locked_until = EXCLUDED.locked_until
      WHERE onec_sync_lock.locked_until <= now()
    RETURNING holder`;
  return rows.length === 1 && rows[0].holder === holder;
}

export async function renewLock(holder: string, ttlMs: number, name: string = LOCK_NAME) {
  await prisma.$executeRaw`UPDATE onec_sync_lock SET locked_until = now() + (${ttlMs}::int * interval '1 millisecond') WHERE name = ${name} AND holder = ${holder}`;
}

export async function releaseLock(holder: string, name: string = LOCK_NAME) {
  await prisma.$executeRaw`UPDATE onec_sync_lock SET locked_until = now() WHERE name = ${name} AND holder = ${holder}`;
}

export async function isLocked(name: string = LOCK_NAME): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ locked: boolean }[]>`SELECT (locked_until > now()) AS locked FROM onec_sync_lock WHERE name = ${name}`;
  return rows[0]?.locked === true;
}

// ---- сүүлийн оролдлого ----

/** Сүүлийн оролдлого (амжилттай ч, амжилтгүй ч): 1С-ийг дахин дуудах эсэхийг шийднэ */
export async function lastAttempt(kind: string, period: string): Promise<{ at: Date; ok: boolean } | null> {
  const row = await prisma.onecSyncLog.findFirst({ where: { kind, period }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true, ok: true } });
  return row ? { at: row.finishedAt, ok: row.ok } : null;
}

/** Сүүлд амжилттай татсан цаг («Сүүлд шинэчилсэн») */
export async function lastSuccess(kinds: string[]): Promise<Date | null> {
  const row = await prisma.onecSyncLog.findFirst({ where: { ok: true, kind: { in: kinds } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
  return row?.finishedAt ?? null;
}

// ---- агуулах ----

export type StockRefresh = {
  /** refreshed: 1С-ээс татлаа · recent: 60 сек өнгөрөөгүй, Postgres-ийг харуулна · busy: өөр таталт явж байна · failed: 1С хариулсангүй */
  status: "refreshed" | "recent" | "busy" | "failed";
  lastSyncedAt: string | null;
  /** recent: хэдэн секундийн дараа дахин татаж болох */
  retryAfterSeconds?: number;
};

export async function refreshStock(opts: { date?: string; now?: () => number } = {}): Promise<StockRefresh> {
  const date = opts.date ?? today();
  const now = opts.now ?? Date.now;
  const result = async (status: StockRefresh["status"], retryAfterSeconds?: number): Promise<StockRefresh> => ({
    status,
    lastSyncedAt: (await lastSuccess(["stock"]))?.toISOString() ?? null,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  });
  /** сүүлийн оролдлогоос хойш 60 сек өнгөрөөгүй бол үлдсэн секунд, үгүй бол null */
  const wait = async (): Promise<number | null> => {
    const last = await lastAttempt("stock", date);
    const age = last ? now() - last.at.getTime() : Infinity;
    return age < STOCK_MIN_INTERVAL_MS ? Math.max(1, Math.ceil((STOCK_MIN_INTERVAL_MS - age) / 1000)) : null;
  };

  const first = await wait();
  if (first !== null) return result("recent", first);
  const holder = randomUUID();
  if (!(await acquireLock(holder, STOCK_LOCK_TTL_MS))) return result("busy");
  try {
    const second = await wait(); // хаалт авах хооронд өөр хүсэлт татаад дууссан байж болно
    if (second !== null) return result("recent", second);
    try {
      await syncStock(date, false, { timeoutMs: STOCK_TIMEOUT_MS, retries: 1 });
    } catch {
      return result("failed"); // sync өөрөө алдааг onec_sync_log-д бичсэн: энэ оролдлого мөн 60 секундийн тоололд орно
    }
    // 1С 0 мөр буцаасан ч DB-д өгөгдөл байвал sync алгасаж, амжилтгүй гэж бүртгэдэг
    const after = await lastAttempt("stock", date);
    return result(after?.ok === false ? "failed" : "refreshed");
  } finally {
    await releaseLock(holder).catch(() => {});
  }
}

// ---- сар (борлуулалт, P&L, мөнгөн хөрөнгө) ----

export type MonthRefresh =
  | { status: "started"; startedAt: string }
  /** 5 минут өнгөрөөгүй: Postgres-ийн өгөгдөл шинэхэн */
  | { status: "recent"; retryAfterSeconds: number }
  | { status: "busy" };

/** Асуусан төрлүүдийн (таб бүр өөрийнхөөрөө) хамгийн хуучин сүүлийн оролдлогын нас (ms). Нэг нь ч татагдаагүй бол Infinity. */
async function monthAgeMs(month: string, now: number, kinds: readonly MonthKind[]): Promise<number> {
  let oldest = Infinity;
  for (const kind of kinds) {
    const last = await lastAttempt(kind, month);
    if (!last) return Infinity;
    oldest = Math.min(oldest, now - last.at.getTime());
  }
  return oldest;
}

/**
 * Сарыг ар талд татах ажлыг эхлүүлнэ (хэрэглэгчийг хүлээлгэхгүй). `schedule` нь ажлыг хариуны дараа ажиллуулна
 * (route: next/server `after`). Ажил дуусмагц эсвэл алдаа гарахад хаалтыг заавал суллана.
 * `kinds`: зөвхөн нээлттэй табд хэрэгтэй төрлүүдийг татна (Борлуулалт: sales+pl, Зардал: pl, Мөнгөн хөрөнгө: cash); анхдагч нь гурвууланг.
 */
export async function startMonthRefresh(
  month: string,
  schedule: (job: () => Promise<void>) => void,
  now: () => number = Date.now,
  kinds: readonly MonthKind[] = MONTH_KINDS
): Promise<MonthRefresh> {
  const retryAfter = (age: number) => Math.max(1, Math.ceil((MONTH_STALE_MS - age) / 1000));
  const age = await monthAgeMs(month, now(), kinds);
  if (age < MONTH_STALE_MS) return { status: "recent", retryAfterSeconds: retryAfter(age) };

  const holder = randomUUID();
  if (!(await acquireLock(holder, MONTH_LOCK_TTL_MS))) return { status: "busy" };
  const ageNow = await monthAgeMs(month, now(), kinds);
  if (ageNow < MONTH_STALE_MS) {
    await releaseLock(holder).catch(() => {});
    return { status: "recent", retryAfterSeconds: retryAfter(ageNow) };
  }

  const startedAt = new Date(now()).toISOString();
  try {
    schedule(async () => {
      try {
        // 1С-ийн ачааллыг бууруулахын тулд дараалан; нэг нь алдаа гарсан ч бусдыг үргэлжлүүлнэ (алдаа onec_sync_log-д)
        for (const kind of kinds) {
          try {
            await MONTH_JOBS[kind](month);
          } catch {
            /* бүртгэгдсэн */
          }
          await renewLock(holder, MONTH_LOCK_TTL_MS).catch(() => {});
        }
      } finally {
        await releaseLock(holder).catch(() => {});
      }
    });
  } catch (e) {
    await releaseLock(holder).catch(() => {});
    throw e;
  }
  return { status: "started", startedAt };
}

// ---- төлөв (хуудас дуусахыг хүлээхэд) ----

export interface SyncStatus {
  /** татах ажил (аль ч төрлийн) одоо явж байна */
  running: boolean;
  stock: { lastSyncedAt: string | null };
  month: {
    month: string;
    /** төрөл бүрийн сүүлийн оролдлого */
    kinds: Record<(typeof MONTH_KINDS)[number], { at: string; ok: boolean } | null>;
    lastSyncedAt: string | null;
  };
}

export async function getSyncStatus(month: string): Promise<SyncStatus> {
  const [running, stock, salesPl, cash, ...attempts] = await Promise.all([
    isLocked(),
    lastSuccess(["stock"]),
    lastSuccess(["sales", "pl"]),
    lastSuccess(["cash"]),
    ...MONTH_KINDS.map((k) => lastAttempt(k, month)),
  ]);
  const kinds = Object.fromEntries(MONTH_KINDS.map((k, i) => [k, attempts[i] ? { at: attempts[i]!.at.toISOString(), ok: attempts[i]!.ok } : null])) as SyncStatus["month"]["kinds"];
  const newest = [salesPl, cash].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  return { running, stock: { lastSyncedAt: stock?.toISOString() ?? null }, month: { month, kinds, lastSyncedAt: newest?.toISOString() ?? null } };
}
