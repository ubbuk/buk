import { finalizeUploads } from "@/lib/attachment-client";
import type { UploadedRef } from "@/lib/attachment-upload";
import type { UploadQueue } from "./useUploadQueue";

export interface UploadTargetUrls {
  presignUrl: string;
  presignExtra?: Record<string, unknown>;
  finalizeUrl: string;
  finalizeExtra?: Record<string, unknown>;
}

/** Uploads everything in the queue and registers it with the server. `error` names what is still outstanding. */
export async function uploadAndFinalize(queue: UploadQueue, cfg: UploadTargetUrls): Promise<{ ok: true } | { ok: false; error: string }> {
  const { refs, failed } = await queue.upload({ presignUrl: cfg.presignUrl, presignExtra: cfg.presignExtra });
  if (refs.length > 0) {
    try {
      await finalizeUploads(cfg.finalizeUrl, refs, cfg.finalizeExtra);
      queue.consume(refs);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Файл хавсаргахад алдаа гарлаа" };
    }
  }
  return failed > 0 ? { ok: false, error: `${failed} файл илгээгдсэнгүй. Жагсаалтаас «Дахин оролдох» товчийг дарна уу` } : { ok: true };
}

export type { UploadedRef };
