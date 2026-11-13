// Гадаад (server-to-server) унших API-ийн нийтлэг хэсэг: /api/v1/onec/*
// Параметр, хариултын бүтэц нь 1С-ийн /hs/dash/*-тай ижил: { rows, count, generated } (+ synced_at, asof).
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDate } from "./dates";

export const MIN_KEY_LENGTH = 32;
// 1С-ийн from/to-той адил дурын хугацаа авдаг ч алдаатай (жишээ нь 2000..2099) хүсэлт сервер, DB-г ачаалахаас сэргийлнэ
export const MAX_RANGE_DAYS = 400;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Хариу бүр кэшлэгдэхгүй: dashboard үргэлж шинэ өгөгдөл авна */
export function hubJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function hubError(status: number, message: string, headers: Record<string, string> = {}) {
  return hubJson({ error: message }, status, headers);
}

const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();

/**
 * Authorization: Bearer <ONEC_HUB_API_KEY>. Түлхүүрүүдийг sha256-аар ижил урттай болгоод timingSafeEqual-аар харьцуулна
 * (урт зөрвөл timingSafeEqual алдаа өгдөг, мөн урт нь илрэхгүй). Түлхүүр тохируулаагүй/богино бол хэнийг ч оруулахгүй.
 */
export function hubKeyMatches(header: string | null, key: string | undefined = process.env.ONEC_HUB_API_KEY): boolean {
  if (!key || key.length < MIN_KEY_LENGTH) return false;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  if (!m) return false;
  return timingSafeEqual(digest(m[1]), digest(key));
}

/** null буцаавал зөвшөөрөгдсөн; үгүй бол 401 */
export function requireHubKey(req: Request): NextResponse | null {
  if (hubKeyMatches(req.headers.get("authorization"))) return null;
  if (!process.env.ONEC_HUB_API_KEY || process.env.ONEC_HUB_API_KEY.length < MIN_KEY_LENGTH) {
    console.warn("ONEC_HUB_API_KEY тохируулаагүй эсвэл 32 тэмдэгтээс богино: /api/v1/onec/* бүх хүсэлтийг татгалзаж байна");
  }
  return hubError(401, "Unauthorized", { "WWW-Authenticate": 'Bearer realm="onec-hub"' });
}

type Parsed<T> = { value: T } | { error: NextResponse };

/** stock, receivables: ?asof=yyyy-MM-dd (заавал биш: өгөхгүй бол хамгийн сүүлийн агшин зураг) */
export function parseAsof(sp: URLSearchParams): Parsed<string | null> {
  const asof = sp.get("asof");
  if (asof === null || asof === "") return { value: null };
  if (!isDate(asof)) return { error: hubError(400, "asof must be yyyy-MM-dd") };
  return { value: asof };
}

/** sales, pl, cash: ?from=yyyy-MM-dd&to=yyyy-MM-dd (хоёулаа заавал) */
export function parseRange(sp: URLSearchParams): Parsed<{ from: string; to: string }> {
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isDate(from) || !isDate(to)) return { error: hubError(400, "from and to must be yyyy-MM-dd") };
  if (from > to) return { error: hubError(400, "from must not be after to") };
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) return { error: hubError(400, `range must not exceed ${MAX_RANGE_DAYS} days`) };
  return { value: { from, to } };
}

/** 1С-ийн "generated"-тай ижил хэлбэр: Улаанбаатарын цагаар YYYY-MM-DDTHH:mm:ss */
export function generatedNow(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" }).replace(" ", "T");
}

/** Тухайн төрлийн сүүлийн АМЖИЛТТАЙ sync-ийн цаг (ISO, UTC); хэзээ ч амжилттай болоогүй бол null */
export async function lastSyncedAt(kind: string): Promise<string | null> {
  const row = await prisma.onecSyncLog.findFirst({
    where: { kind, ok: true },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  return row?.finishedAt.toISOString() ?? null;
}

export function envelope<T>(rows: T[], syncedAt: string | null, extra: Record<string, unknown> = {}) {
  return { ...extra, rows, count: rows.length, generated: generatedNow(), synced_at: syncedAt };
}
