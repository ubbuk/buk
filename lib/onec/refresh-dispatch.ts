// Vercel дээр хүнд татаалтыг (сар: sales+pl+cash, авлагын агшин зураг) route дотор биш GitHub Actions-д өгнө (lib/github-dispatch.ts).
// Route зөвхөн «одоо шинэхэн үү», «саяхан хүссэн үү» гэдгийг шалгаад workflow_dispatch дуудна: 1С руу хандахгүй, хурдан буцна.
//  * auto (хуудас нээгдэхэд автоматаар): юу ч хийхгүй, «scheduled». Одоогийн сарыг workflow-ийн 15 минутын хуваарь шинэчилнэ.
//  * Товч: сүүлийн оролдлогоос 5 минут өнгөрөөгүй бол «recent»; саяхан (5 минут) дуудсан бол «busy»; үгүй бол dispatch.
//  * GITHUB_DISPATCH_TOKEN тохируулаагүй бол «unavailable» (Агуулах шууд шинэчлэгдсээр, бусад нь хуваарийн дагуу).
import { randomUUID } from "node:crypto";
import { dispatchSync, heavyRefreshMode } from "@/lib/github-dispatch";
import { asOfDate } from "./dates";
import { acquireLock, lastAttempt, monthAgeMs, MONTH_STALE_MS, releaseLock, type MonthKind } from "./refresh";
import { RECEIVABLES_LOG_KIND } from "./receivables-store";

export type HeavyResult =
  | { status: "dispatched"; dispatchedAt: string }
  | { status: "scheduled" }
  | { status: "unavailable" }
  | { status: "recent"; retryAfterSeconds: number }
  /** саяхан Actions-д өгсөн: дууссаныг мөн хүлээнэ */
  | { status: "busy"; via: "actions" };

const DISPATCH_LEASE_MS = 5 * 60_000;
const ALL_KINDS: readonly MonthKind[] = ["sales", "pl", "cash"];

/** Vercel дээр л хэрэглэнэ (heavyRefreshMode() !== "inline") */
export async function requestHeavyRefresh(opts: { kind: "month" | "receivables"; month: string; kinds?: readonly MonthKind[]; auto?: boolean }, now: () => number = Date.now): Promise<HeavyResult> {
  if (opts.auto) return { status: "scheduled" };
  if (heavyRefreshMode() !== "dispatch") return { status: "unavailable" };

  const retryAfter = (age: number) => Math.max(1, Math.ceil((MONTH_STALE_MS - age) / 1000));
  let age: number;
  if (opts.kind === "month") age = await monthAgeMs(opts.month, now(), opts.kinds ?? ALL_KINDS);
  else {
    const last = await lastAttempt(RECEIVABLES_LOG_KIND, asOfDate(opts.month));
    age = last ? now() - last.at.getTime() : Infinity;
  }
  if (age < MONTH_STALE_MS) return { status: "recent", retryAfterSeconds: retryAfter(age) };

  // Саяхан (5 минутын дотор) дуудсан бол дахин дуудахгүй: түрээс нь хугацаа дуустал үлддэг (суллахгүй), давхар товшилтыг хаана
  const name = `dispatch-${opts.kind}-${opts.month}`;
  const holder = randomUUID();
  if (!(await acquireLock(holder, DISPATCH_LEASE_MS, name))) return { status: "busy", via: "actions" };
  const dispatchedAt = new Date(now()).toISOString();
  try {
    await dispatchSync({ mode: opts.kind, month: opts.month });
  } catch (e) {
    await releaseLock(holder, name).catch(() => {}); // амжилтгүй бол дахин оролдож болно
    throw e;
  }
  return { status: "dispatched", dispatchedAt };
}
