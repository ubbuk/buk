// Browser side of the direct-to-bucket upload (see lib/attachment-upload.ts for the server half):
// prepare (compress) -> presign -> PUT to the bucket with progress -> [caller] finalize.
import { compressImage, jpegName } from "./image-compress";
import {
  isAllowedMime,
  isHeic,
  isImageMime,
  MAX_IMAGE_SIZE_BYTES,
  maxSizeFor,
  maxSizeLabel,
  MAX_ATTACHMENTS_PER_REQUEST,
} from "./attachment-rules";
import type { PresignedFile, UploadedRef, UploadTarget } from "./attachment-upload";

/** An original photo bigger than this is refused before decoding: a low-memory phone would run out of RAM. */
const MAX_ORIGINAL_IMAGE_BYTES = 60 * 1024 * 1024;

export class UploadError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 for a network failure. */
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export interface PreparedFile {
  body: Blob;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  thumb: Blob | null;
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Some Android file pickers hand over documents with an empty `type`: fall back to the extension. */
export function guessMime(file: { name: string; type: string }): string {
  if (isAllowedMime(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? file.type;
}

/** A message when the file cannot be attached at all (before any work is done), otherwise null. */
export function checkPickedFile(file: File): string | null {
  const mime = guessMime(file);
  if (!isHeic(file) && !isAllowedMime(mime)) return `${file.name} — JPG, PNG, WEBP, HEIC, PDF, XLSX, XLS, DOCX файл дэмжинэ`;
  if (file.size === 0) return `${file.name} — хоосон файл байна`;
  if (isHeic(file) || isImageMime(mime)) {
    if (file.size > MAX_ORIGINAL_IMAGE_BYTES) return `${file.name} — зураг хэт том байна (60 MB-с ихгүй байх ёстой)`;
  } else if (file.size > maxSizeFor(mime)) {
    return `${file.name} — файл хэт том байна (${maxSizeLabel(mime)}-с ихгүй байх ёстой)`;
  }
  return null;
}

export const attachmentCountMessage = `Нэг дор хамгийн ихдээ ${MAX_ATTACHMENTS_PER_REQUEST} файл хавсаргах боломжтой`;

/** Compresses an image (and makes its thumbnail); documents pass through untouched. Throws an UploadError with a user-facing message. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  const mime = guessMime(file);
  if (!isHeic(file) && !isImageMime(mime)) {
    return { body: file, fileName: file.name, mimeType: mime, sizeBytes: file.size, thumb: null };
  }
  try {
    const out = await compressImage(file);
    if (out.blob.size > MAX_IMAGE_SIZE_BYTES) {
      throw new UploadError(`${file.name} — зургийг шахсан ч хэт том байна (${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB-с ихгүй байх ёстой)`, 0, false);
    }
    return { body: out.blob, fileName: jpegName(file.name), mimeType: "image/jpeg", sizeBytes: out.blob.size, thumb: out.thumb };
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError(
      isHeic(file) ? `${file.name} — HEIC зургийг хөрвүүлж чадсангүй. Камерын тохиргоонд "Хамгийн тохиромжтой" (JPEG) горимыг сонгоно уу` : `${file.name} — зургийг боловсруулж чадсангүй. Өөр зураг сонгоно уу`,
      0,
      false
    );
  }
}

/** Worth another try: the request timed out, was throttled or the service was briefly unavailable. A plain 500 is a fault
 *  (wrong storage setting or key, a bug) that a retry cannot fix, so the message is shown at once. */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new UploadError("Сүлжээ тасарлаа", 0, true);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && typeof data.error === "string" && data.error) || (res.status === 413 ? "Файл хэт том байна" : `Серверийн алдаа (${res.status})`);
    throw new UploadError(message, res.status, isTransientStatus(res.status));
  }
  return data as T;
}

function putBlob(target: UploadTarget, blob: Blob, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.putUrl);
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // 403 from the bucket is an expired/invalid signature: the next attempt presigns again, so it is worth retrying.
      const retryable = isTransientStatus(xhr.status) || xhr.status === 403;
      reject(new UploadError(xhr.status === 403 ? "Upload-ын хугацаа дууссан байна" : `Файл илгээхэд алдаа гарлаа (${xhr.status})`, xhr.status, retryable));
    };
    xhr.onerror = () => reject(new UploadError("Сүлжээ тасарлаа", 0, true));
    xhr.ontimeout = () => reject(new UploadError("Сүлжээ хэт удаан байна", 0, true));
    xhr.send(blob);
  });
}

export interface UploadOneOptions {
  /** Endpoint that issues the PUT URLs (see the presign routes). */
  presignUrl: string;
  /** Extra JSON fields for the presign request (e.g. { quoteId }). */
  presignExtra?: Record<string, unknown>;
  onProgress: (fraction: number) => void;
}

/** One attempt: presign, then PUT the file and its thumbnail. Returns what the finalize call needs. */
export async function uploadPrepared(file: PreparedFile, opts: UploadOneOptions): Promise<UploadedRef> {
  const [presigned] = await postJson<PresignedFile[]>(opts.presignUrl, {
    ...opts.presignExtra,
    files: [{ fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, ...(file.thumb ? { thumbSizeBytes: file.thumb.size } : {}) }],
  });
  const total = file.sizeBytes + (file.thumb?.size ?? 0);
  let done = 0;
  await putBlob(presigned.file, file.body, (loaded) => opts.onProgress(Math.min(1, (done + loaded) / total)));
  done = file.sizeBytes;
  const ref: UploadedRef = { fileName: file.fileName, key: presigned.file.key, token: presigned.file.token };
  if (file.thumb && presigned.thumb) {
    // A thumbnail is a nicety: if it cannot be sent, the file itself still goes through.
    try {
      await putBlob(presigned.thumb, file.thumb, (loaded) => opts.onProgress(Math.min(1, (done + loaded) / total)));
      ref.thumbKey = presigned.thumb.key;
      ref.thumbToken = presigned.thumb.token;
    } catch {
      /* no preview */
    }
  }
  opts.onProgress(1);
  return ref;
}

export const RETRY_DELAYS_MS = [1000, 3000, 7000];

/** Runs `task`, retrying network / server failures automatically (RETRY_DELAYS_MS.length times) with a growing pause. */
export async function withRetry<T>(task: () => Promise<T>, onRetry: (attempt: number, error: UploadError) => void, delays = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (err) {
      const e = err instanceof UploadError ? err : new UploadError("Файл илгээхэд алдаа гарлаа", 0, true);
      if (!e.retryable || attempt >= delays.length) throw e;
      onRetry(attempt + 1, e);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

export async function finalizeUploads<T>(url: string, refs: UploadedRef[], extra?: Record<string, unknown>): Promise<T> {
  return postJson<T>(url, { ...extra, files: refs });
}

