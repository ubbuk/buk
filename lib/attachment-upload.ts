// Direct-to-bucket uploads, shared by the material-request and foreign-trade attachments.
//
//   1. presignUploads  – the server checks the caller's right, validates what the browser DECLARES (type, size) and hands
//                        back a one-file PUT URL (+ one for the thumbnail) and a signed token per object.
//   2. the browser PUTs the bytes straight to the bucket (no Vercel 4.5 MB request limit).
//   3. verifyUploads   – the server trusts none of it: the token proves it issued the key, the bucket is asked (HEAD)
//                        for the real size and the first bytes are compared with the declared MIME type.
//
// The tokens are HMACs, so no "pending upload" table (and no migration) is needed.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { storage } from "./storage";
import { reportStorageFailure } from "./storage-errors";
import { signatureMatches, SIGNATURE_BYTES } from "./file-signature";
import { isAllowedMime, isHeic, isImageMime, MAX_THUMB_SIZE_BYTES, maxSizeFor, maxSizeLabel } from "./attachment-rules";

export const PUT_URL_TTL_SECONDS = 30 * 60;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const THUMB_MIME = "image/jpeg";

export interface DeclaredFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  thumbSizeBytes?: number;
}

export interface UploadTarget {
  key: string;
  token: string;
  putUrl: string;
  headers: Record<string, string>;
}

export interface PresignedFile {
  file: UploadTarget;
  thumb?: UploadTarget;
}

/** What the browser sends back once its PUTs have finished. */
export interface UploadedRef {
  fileName: string;
  key: string;
  token: string;
  thumbKey?: string;
  thumbToken?: string;
}

export interface VerifiedFile {
  key: string;
  thumbKey: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export type UploadResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

interface TokenPayload {
  k: string; // object key
  m: string; // declared MIME type
  s: number; // declared size
  u: string; // user the upload was issued to
  e: number; // expiry (ms)
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required to sign upload tokens");
  return s;
}

const b64 = (b: Buffer) => b.toString("base64url");

export function signToken(payload: TokenPayload): string {
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64(createHmac("sha256", secret()).update(body).digest())}`;
}

export function readToken(token: string): TokenPayload | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    return typeof p.k === "string" && typeof p.m === "string" && typeof p.s === "number" && typeof p.u === "string" && typeof p.e === "number" && p.e > Date.now() ? p : null;
  } catch {
    return null;
  }
}

/** A problem with one declared file, as a Mongolian sentence, or null. */
export function validateDeclared(f: DeclaredFile): string | null {
  if (!f.fileName || typeof f.sizeBytes !== "number" || !Number.isFinite(f.sizeBytes)) return "Хүчингүй өгөгдөл";
  if (!isAllowedMime(f.mimeType)) {
    return isHeic({ name: f.fileName, type: f.mimeType })
      ? `HEIC зургийг хөрвүүлж чадсангүй: ${f.fileName}. JPG болгож дахин оруулна уу`
      : `Дэмжигдэхгүй файлын төрөл: ${f.fileName} (${f.mimeType})`;
  }
  if (f.sizeBytes === 0) return `Хоосон файл хавсаргах боломжгүй: ${f.fileName}`;
  if (f.sizeBytes > maxSizeFor(f.mimeType)) return `Файл хэт том байна (${maxSizeLabel(f.mimeType)}-с ихгүй байх ёстой): ${f.fileName}`;
  if (f.thumbSizeBytes !== undefined) {
    if (!isImageMime(f.mimeType)) return "Зөвхөн зурагт жижиг хуулбар хавсаргана";
    if (!(f.thumbSizeBytes > 0) || f.thumbSizeBytes > MAX_THUMB_SIZE_BYTES) return `Жижиг хуулбар хэт том байна: ${f.fileName}`;
  }
  return null;
}

async function target(key: string, mime: string, size: number, actorId: string): Promise<UploadTarget> {
  const signed = await storage.presignPut(key, { contentType: mime, expiresIn: PUT_URL_TTL_SECONDS });
  const token = signToken({ k: key, m: mime, s: size, u: actorId, e: Date.now() + TOKEN_TTL_MS });
  if (signed) return { key, token, putUrl: signed.url, headers: signed.headers };
  // Local disk: there is no bucket to sign for, so the browser PUTs to the app's own token-checked route instead.
  const putToken = signToken({ k: key, m: mime, s: size, u: actorId, e: Date.now() + PUT_URL_TTL_SECONDS * 1000 });
  return { key, token, putUrl: `/api/attachments/local-put?token=${encodeURIComponent(putToken)}`, headers: { "Content-Type": mime } };
}

/** `prefix` ends with "/" and scopes the keys (and the tokens) to one request / order. */
export async function presignUploads(scope: { prefix: string; actorId: string }, files: DeclaredFile[]): Promise<PresignedFile[]> {
  const out: PresignedFile[] = [];
  for (const f of files) {
    const key = `${scope.prefix}${randomUUID()}`;
    const file = await target(key, f.mimeType, f.sizeBytes, scope.actorId);
    const thumb = f.thumbSizeBytes !== undefined ? await target(`${key}.thumb`, THUMB_MIME, f.thumbSizeBytes, scope.actorId) : undefined;
    out.push({ file, thumb });
  }
  return out;
}

/** presignUploads for the routes: a storage problem becomes a sentence and a logged code (503 when retrying can help, else 500), never a bare 500. */
export async function presignUploadsSafe(scope: { prefix: string; actorId: string }, files: DeclaredFile[]): Promise<UploadResult<PresignedFile[]>> {
  try {
    return { ok: true, data: await presignUploads(scope, files) };
  } catch (err) {
    const f = reportStorageFailure("presign", err);
    return { ok: false, status: f.status, error: f.message };
  }
}

async function inspect(token: string, key: string, scope: { prefix: string; actorId: string }, limit: number | null): Promise<{ ok: true; mime: string; size: number } | { ok: false; error: string }> {
  const t = readToken(token);
  if (!t || t.k !== key || t.u !== scope.actorId || !key.startsWith(scope.prefix)) return { ok: false, error: "Файлын баталгаажуулалт хүчингүй байна. Дахин оруулна уу" };
  const head = await storage.head(key);
  if (!head) return { ok: false, error: "Файл хадгалах санд хүрээгүй байна. Дахин оролдоно уу" };
  if (head.size !== t.s) return { ok: false, error: "Файл бүрэн хуулагдаагүй байна. Дахин оролдоно уу" };
  if (limit !== null && head.size > limit) return { ok: false, error: "Файл хэт том байна" };
  const bytes = await storage.readHead(key, SIGNATURE_BYTES);
  if (!bytes || !signatureMatches(t.m, bytes)) return { ok: false, error: "Файлын агуулга төрөлтэйгээ таарахгүй байна" };
  return { ok: true, mime: t.m, size: head.size };
}

/** Removes objects that never became an attachment. Best effort: a leftover is only wasted space. */
export async function discardObjects(keys: (string | null | undefined)[]): Promise<void> {
  for (const k of keys) if (k) await storage.delete(k).catch(() => {});
}

/** Deletes the objects named by `refs`, but only those this user holds a valid token for. */
export async function discardUploads(scope: { prefix: string; actorId: string }, refs: UploadedRef[]): Promise<void> {
  const owned: string[] = [];
  for (const r of refs) {
    const t = readToken(r.token);
    if (t && t.k === r.key && t.u === scope.actorId && r.key.startsWith(scope.prefix)) owned.push(r.key);
    if (r.thumbKey && r.thumbToken) {
      const tt = readToken(r.thumbToken);
      if (tt && tt.k === r.thumbKey && tt.u === scope.actorId && r.thumbKey.startsWith(scope.prefix)) owned.push(r.thumbKey);
    }
  }
  await discardObjects(owned);
}

/**
 * Confirms every uploaded object really exists, has the declared size and type, and is not already an attachment.
 * On any failure the objects of this call are deleted so nothing half-uploaded stays in the bucket.
 */
export async function verifyUploads(scope: { prefix: string; actorId: string }, refs: UploadedRef[]): Promise<UploadResult<VerifiedFile[]>> {
  const fail = (status: number, error: string): UploadResult<VerifiedFile[]> => ({ ok: false, status, error });
  if (refs.length === 0) return fail(400, "Файл сонгоогүй байна");

  const bail = async (status: number, error: string) => {
    await discardUploads(scope, refs);
    return fail(status, error);
  };

  const keys = refs.flatMap((r) => (r.thumbKey ? [r.key, r.thumbKey] : [r.key]));
  if (new Set(keys).size !== keys.length) return bail(400, "Хүчингүй өгөгдөл");
  const [a, b, c] = await Promise.all([
    prisma.attachment.count({ where: { OR: [{ storageKey: { in: keys } }, { thumbKey: { in: keys } }] } }),
    prisma.foreignTradeAttachment.count({ where: { OR: [{ storageKey: { in: keys } }, { thumbKey: { in: keys } }] } }),
    prisma.purchaseReceipt.count({ where: { OR: [{ storageKey: { in: keys } }, { thumbKey: { in: keys } }] } }),
  ]);
  if (a + b + c > 0) return fail(409, "Энэ файл аль хэдийн хавсаргагдсан байна"); // not discarded: those objects belong to the existing rows

  try {
    return await inspectAll(scope, refs, bail);
  } catch (err) {
    // the bucket could not be asked: nothing is deleted (it could not be reached either) and the user may simply retry
    const f = reportStorageFailure("finalize", err);
    return fail(f.status, f.message);
  }
}

async function inspectAll(
  scope: { prefix: string; actorId: string },
  refs: UploadedRef[],
  bail: (status: number, error: string) => Promise<UploadResult<VerifiedFile[]>>
): Promise<UploadResult<VerifiedFile[]>> {
  const files: VerifiedFile[] = [];
  for (const r of refs) {
    const mimeLimit = readToken(r.token)?.m;
    const res = await inspect(r.token, r.key, scope, mimeLimit ? maxSizeFor(mimeLimit) : null);
    if (!res.ok) return bail(400, `${res.error}: ${r.fileName}`);
    if (!isAllowedMime(res.mime)) return bail(400, `Дэмжигдэхгүй файлын төрөл: ${r.fileName}`);
    let thumbKey: string | null = null;
    if (r.thumbKey && r.thumbToken && isImageMime(res.mime)) {
      const th = await inspect(r.thumbToken, r.thumbKey, scope, MAX_THUMB_SIZE_BYTES);
      if (th.ok && th.mime === THUMB_MIME) thumbKey = r.thumbKey;
      else await discardObjects([r.thumbKey]); // a bad preview only costs the preview, not the file
    }
    files.push({ key: r.key, thumbKey, fileName: r.fileName, mimeType: res.mime, sizeBytes: res.size });
  }
  return { ok: true, data: files };
}
