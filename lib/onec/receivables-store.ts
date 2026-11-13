// «Авлага» агшин зураг: Postgres-д хадгалж, хуудас шууд уншина; шинэчлэлт ар талд (хуудсыг 1С-ийг хүлээлгэхгүй).
// Зөвхөн 1С-ээс УНШИНА (lib/onec/receivables.ts). Өөрийн түрээс (onec_sync_lock "onec-receivables"): удаан Balance нь
// агуулахын 1 минутын татаалтыг хаахгүй. Дансуудыг дарааллаар татаж данс бүрийг тусад нь, нэг transaction-оор солино:
// 1201 (~10 сек) ирмэгц хуудас бүрдэж, удаан НӨАТ-ын данс (1271) дараа нь нэмэгдэнэ; алдаа гарвал хуучин мөр хэвээр.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { monthRange } from "./dates";
import { acquireLock, isLocked, lastAttempt, MONTH_STALE_MS, releaseLock, renewLock, type MonthRefresh } from "./refresh";
import { fetchStage, STAGES, type SnapshotRow } from "./receivables";

export const RECEIVABLES_LOCK = "onec-receivables";
export const RECEIVABLES_LOG_KIND = "receivables-odata";
const LOCK_TTL_MS = 10 * 60_000; // 3 данс; ажил хооронд сунгана

export interface Snapshot {
  /** агшин зургийн өдөр (одоогийн сар бол өнөөдрийнх байхгүй үед сарын сүүлийн өмнөх өдөр байж болно) */
  date: string;
  rows: SnapshotRow[];
  syncedAt: Date;
}

/**
 * Өдрийн агшин зураг. Одоогийн сар бол өнөөдрийнх хараахан байхгүй үед (шинэ өдрийн эхний нээлт) сарын доторх хамгийн сүүлийнхийг
 * харуулна (`floor` = сарын эхний өдөр); өнгөрсөн сар бол яг тэр өдрийнхийг л (`floor` = asOf).
 */
export async function readSnapshot(asOf: string, floor: string): Promise<Snapshot | null> {
  const day = await prisma.$queryRaw<{ d: string | null }[]>`
    SELECT max(snapshot_date)::text AS d FROM onec_receivable_balances WHERE snapshot_date <= ${asOf}::date AND snapshot_date >= ${floor}::date`;
  const date = day[0]?.d;
  if (!date) return null;
  const rows = await prisma.$queryRaw<{ account_code: string; account_name: string; customer_key: string; customer: string; balance: number; customers: number; synced_at: Date }[]>`
    SELECT account_code, account_name, customer_key, customer, balance::float8 AS balance, customers, synced_at
      FROM onec_receivable_balances WHERE snapshot_date = ${date}::date ORDER BY account_code, id`;
  return {
    date,
    rows: rows.map((r) => ({ accountCode: r.account_code, accountName: r.account_name, customerKey: r.customer_key, customer: r.customer, balance: r.balance, customers: r.customers })),
    syncedAt: new Date(Math.max(...rows.map((r) => r.synced_at.getTime()))),
  };
}

/** Нэг дансны мөрүүдийг (тэр өдрийн) нэг transaction-оор солино */
export async function writeStage(asOf: string, code: string, rows: SnapshotRow[]) {
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM onec_receivable_balances WHERE snapshot_date = ${asOf}::date AND account_code = ${code}`,
    prisma.$executeRaw`
      INSERT INTO onec_receivable_balances (snapshot_date, account_code, account_name, customer_key, customer, balance, customers)
      SELECT ${asOf}::date, ${code}, t.n, t.k, t.c, t.b, t.m
        FROM unnest(${rows.map((r) => r.accountName)}::text[], ${rows.map((r) => r.customerKey)}::text[], ${rows.map((r) => r.customer)}::text[], ${rows.map((r) => r.balance)}::numeric[], ${rows.map((r) => r.customers)}::int[]) AS t(n, k, c, b, m)`,
  ]);
}

export const monthFloor = (asOf: string, current: string) => (asOf.slice(0, 7) === current ? monthRange(current).from : asOf);

/**
 * Агшин зургийг ар талд шинэчлэх ажлыг эхлүүлнэ (хариуг хүлээлгэхгүй). `schedule` нь ажлыг хариуны дараа ажиллуулна.
 * Сүүлийн оролдлогоос (амжилттай ч, амжилтгүй ч) 5 минут өнгөрөөгүй бол «recent»; өөр ажил явж байвал «busy».
 */
export async function startReceivablesRefresh(asOf: string, schedule: (job: () => Promise<void>) => void, now: () => number = Date.now): Promise<MonthRefresh> {
  const retryAfter = (age: number) => Math.max(1, Math.ceil((MONTH_STALE_MS - age) / 1000));
  const ageMs = async () => {
    const last = await lastAttempt(RECEIVABLES_LOG_KIND, asOf);
    return last ? now() - last.at.getTime() : Infinity;
  };
  const age = await ageMs();
  if (age < MONTH_STALE_MS) return { status: "recent", retryAfterSeconds: retryAfter(age) };

  const holder = randomUUID();
  if (!(await acquireLock(holder, LOCK_TTL_MS, RECEIVABLES_LOCK))) return { status: "busy" };
  const ageNow = await ageMs(); // хаалт авах хооронд өөр хүсэлт дуусгасан байж болно
  if (ageNow < MONTH_STALE_MS) {
    await releaseLock(holder, RECEIVABLES_LOCK).catch(() => {});
    return { status: "recent", retryAfterSeconds: retryAfter(ageNow) };
  }

  const startedAt = new Date(now());
  try {
    schedule(async () => {
      const failed: string[] = [];
      let total = 0;
      try {
        for (const code of STAGES) {
          try {
            const rows = await fetchStage(asOf, code);
            if (rows) {
              await writeStage(asOf, code, rows);
              total += rows.length;
            }
          } catch {
            failed.push(code); // нэг данс алдаа гарсан ч бусдыг үргэлжлүүлнэ; хуучин мөр хэвээр
          }
          await renewLock(holder, LOCK_TTL_MS, RECEIVABLES_LOCK).catch(() => {});
        }
        const secs = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
        await prisma.onecSyncLog.create({
          data: { kind: RECEIVABLES_LOG_KIND, period: asOf, rows: total, ok: failed.length === 0, message: failed.length ? `Татаж чадаагүй данс: ${failed.join(", ")}` : `${secs}s`, startedAt },
        });
      } finally {
        await releaseLock(holder, RECEIVABLES_LOCK).catch(() => {});
      }
    });
  } catch (e) {
    await releaseLock(holder, RECEIVABLES_LOCK).catch(() => {});
    throw e;
  }
  return { status: "started", startedAt: startedAt.toISOString() };
}

export async function receivablesState(asOf: string): Promise<{ refreshing: boolean; lastAttemptOk: boolean | null }> {
  const [refreshing, last] = await Promise.all([isLocked(RECEIVABLES_LOCK), lastAttempt(RECEIVABLES_LOG_KIND, asOf)]);
  return { refreshing, lastAttemptOk: last ? last.ok : null };
}
