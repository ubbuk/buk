"use client";

import { AlertCircle, CheckCircle2, FileText, Loader2, RotateCw, X } from "lucide-react";
import { formatFileSize } from "@/lib/utils";
import type { QueueItem } from "./useUploadQueue";

const STATUS_TEXT: Record<QueueItem["status"], string> = {
  preparing: "Зургийг бэлдэж байна...",
  ready: "Илгээхэд бэлэн",
  uploading: "Илгээж байна...",
  uploaded: "Илгээгдсэн",
  error: "Алдаа гарлаа",
};

/**
 * One row per chosen file: a small preview, its own progress bar and status, a retry button for a failed one and a
 * delete (✕) button. Every button is at least 44 px so it can be hit with a finger.
 */
export function UploadQueueList({ items, onRemove, onRetry }: { items: QueueItem[]; onRemove: (id: string) => void; onRetry: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2" data-testid="upload-queue">
      {items.map((i) => (
        <li key={i.id} data-status={i.status} className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated/40 p-2">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-surface text-text-muted">
            {i.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={i.previewUrl} alt="" className="size-full object-cover" />
            ) : i.status === "preparing" && i.isImage ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <FileText className="size-6" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm text-text">{i.name}</span>
              <span className="shrink-0 text-xs text-text-muted">{i.status === "preparing" ? "" : formatFileSize(i.sizeBytes)}</span>
            </div>
            {i.status === "uploading" && (
              <div
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(i.progress * 100)}
              >
                <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${Math.round(i.progress * 100)}%` }} />
              </div>
            )}
            <p className={`mt-1 flex items-center gap-1 text-xs ${i.status === "error" ? "text-danger" : "text-text-muted"}`} role={i.status === "error" ? "alert" : undefined}>
              {i.status === "error" && <AlertCircle className="size-3.5 shrink-0" aria-hidden />}
              {i.status === "uploaded" && <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />}
              <span>{i.status === "uploading" ? (i.message ?? `${STATUS_TEXT.uploading} ${Math.round(i.progress * 100)}%`) : i.status === "error" ? (i.message ?? STATUS_TEXT.error) : STATUS_TEXT[i.status]}</span>
            </p>
          </div>
          {i.status === "error" && (
            <button
              type="button"
              onClick={() => onRetry(i.id)}
              aria-label={`${i.name} дахин илгээх`}
              className="focus-ring inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg border border-accent/60 px-2 text-xs font-medium text-accent hover:bg-accent/10"
            >
              <RotateCw className="size-4" aria-hidden />
              <span className="max-sm:sr-only">Дахин оролдох</span>
            </button>
          )}
          {i.status !== "uploading" && (
            <button
              type="button"
              onClick={() => onRemove(i.id)}
              aria-label={`${i.name} хасах`}
              className="focus-ring inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
