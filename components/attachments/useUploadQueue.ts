"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ATTACHMENTS_PER_REQUEST } from "@/lib/attachment-rules";
import {
  attachmentCountMessage,
  checkPickedFile,
  guessMime,
  prepareFile,
  uploadPrepared,
  withRetry,
  UploadError,
  type PreparedFile,
} from "@/lib/attachment-client";
import { isHeic, isImageMime } from "@/lib/attachment-rules";
import type { UploadedRef } from "@/lib/attachment-upload";

export type QueueStatus = "preparing" | "ready" | "uploading" | "uploaded" | "error";

export interface QueueItem {
  id: string;
  name: string;
  sizeBytes: number;
  status: QueueStatus;
  /** 0..1 while uploading. */
  progress: number;
  /** Retry notice while uploading, the reason when status is "error". */
  message?: string;
  isImage: boolean;
  previewUrl: string | null;
}

export interface UploadConfig {
  presignUrl: string;
  presignExtra?: Record<string, unknown>;
}

let seq = 0;

/**
 * Files chosen for an upload: each one is prepared (images compressed, one at a time so a phone never holds several
 * decoded photos), listed with its own status/progress, uploaded straight to the bucket with automatic retries, and
 * dropped from the queue once the caller has registered it with the server (`consume`).
 */
export function useUploadQueue({ onReject, existingCount = 0 }: { onReject: (message: string) => void; existingCount?: number }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const itemsRef = useRef<QueueItem[]>([]);
  const data = useRef(new Map<string, { prepared?: PreparedFile; ref?: UploadedRef }>());
  const prepChain = useRef<Promise<void>>(Promise.resolve());
  const uploading = useRef(false);

  const commit = useCallback((fn: (prev: QueueItem[]) => QueueItem[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);
  const patch = useCallback((id: string, p: Partial<QueueItem>) => commit((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i))), [commit]);

  const dropItem = useCallback(
    (id: string) => {
      const gone = itemsRef.current.find((i) => i.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      data.current.delete(id);
      commit((prev) => prev.filter((i) => i.id !== id));
    },
    [commit]
  );

  const add = useCallback(
    (picked: File[]): Promise<void> => {
      const run = async () => {
        let room = MAX_ATTACHMENTS_PER_REQUEST - existingCount - itemsRef.current.length;
        for (const file of picked) {
          if (room <= 0) {
            onReject(attachmentCountMessage);
            break;
          }
          const problem = checkPickedFile(file);
          if (problem) {
            onReject(problem);
            continue;
          }
          room--;
          const id = `q${++seq}`;
          const image = isHeic(file) || isImageMime(guessMime(file));
          commit((prev) => [...prev, { id, name: file.name, sizeBytes: file.size, status: "preparing", progress: 0, isImage: image, previewUrl: null }]);
          try {
            const prepared = await prepareFile(file);
            data.current.set(id, { prepared });
            patch(id, {
              status: "ready",
              name: prepared.fileName,
              sizeBytes: prepared.sizeBytes,
              previewUrl: prepared.thumb ? URL.createObjectURL(prepared.thumb) : null,
            });
          } catch (err) {
            dropItem(id);
            room++;
            onReject(err instanceof UploadError ? err.message : `${file.name} — боловсруулж чадсангүй`);
          }
        }
      };
      // One at a time, also across several picks in a row.
      prepChain.current = prepChain.current.then(run, run);
      return prepChain.current;
    },
    [commit, dropItem, existingCount, onReject, patch]
  );

  /** Uploads every item that is ready or failed earlier. Resolves with the refs of all uploaded-but-unregistered files. */
  const upload = useCallback(
    async (cfg: UploadConfig): Promise<{ refs: UploadedRef[]; failed: number }> => {
      if (uploading.current) return { refs: [], failed: 0 };
      uploading.current = true;
      try {
        for (const item of itemsRef.current.filter((i) => i.status === "ready" || i.status === "error")) {
          const entry = data.current.get(item.id);
          if (!entry?.prepared) continue;
          patch(item.id, { status: "uploading", progress: 0, message: undefined });
          try {
            const ref = await withRetry(
              () => uploadPrepared(entry.prepared!, { ...cfg, onProgress: (f) => patch(item.id, { progress: f }) }),
              (attempt) => patch(item.id, { progress: 0, message: `Сүлжээ тогтворгүй байна. Дахин оролдож байна (${attempt}/3)...` })
            );
            entry.ref = ref;
            patch(item.id, { status: "uploaded", progress: 1, message: undefined });
          } catch (err) {
            patch(item.id, { status: "error", progress: 0, message: err instanceof UploadError ? err.message : "Файл илгээхэд алдаа гарлаа" });
          }
        }
      } finally {
        uploading.current = false;
      }
      const refs: UploadedRef[] = [];
      for (const i of itemsRef.current) {
        const r = data.current.get(i.id)?.ref;
        if (i.status === "uploaded" && r) refs.push(r);
      }
      return { refs, failed: itemsRef.current.filter((i) => i.status === "error").length };
    },
    [patch]
  );

  /** The server has registered these files: they are no longer part of the queue. */
  const consume = useCallback(
    (refs: UploadedRef[]) => {
      const keys = new Set(refs.map((r) => r.key));
      for (const i of [...itemsRef.current]) if (keys.has(data.current.get(i.id)?.ref?.key ?? "")) dropItem(i.id);
    },
    [dropItem]
  );

  /** Registering failed (not uploading): the files stay uploaded and can be registered again. */
  const reset = useCallback(() => {
    for (const i of [...itemsRef.current]) dropItem(i.id);
  }, [dropItem]);

  const busy = items.some((i) => i.status === "preparing" || i.status === "uploading");
  const unfinished = items.some((i) => i.status !== "ready") || (items.length > 0 && busy);

  // Leaving the page while files are on their way (or failed) would lose them: ask first.
  useEffect(() => {
    if (!busy && !items.some((i) => i.status === "error" || i.status === "uploaded")) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, items]);

  useEffect(
    () => () => {
      for (const i of itemsRef.current) if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
    },
    []
  );

  return { items, add, remove: dropItem, upload, consume, reset, busy, unfinished };
}

export type UploadQueue = ReturnType<typeof useUploadQueue>;
