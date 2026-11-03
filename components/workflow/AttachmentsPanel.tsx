"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useRequestStore } from "@/lib/store";
import { formatFileSize } from "@/lib/utils";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_REQUEST,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/attachment-rules";
import type { AttachmentView } from "@/lib/types";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Shows a request's attachments (image thumbnails preview inline, other
 * file types show a generic file icon) and, when canUpload, a control to
 * add more — every link goes through the authenticated
 * /api/requests/[id]/attachments/[attachmentId] route, never a public URL.
 */
export function AttachmentsPanel({
  requestId,
  attachments,
  canUpload,
}: {
  requestId: string;
  attachments: AttachmentView[];
  canUpload: boolean;
}) {
  const { push } = useToast();
  const loadRequests = useRequestStore((s) => s.loadRequests);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentView | null>(null);

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    if (attachments.length + files.length > MAX_ATTACHMENTS_PER_REQUEST) {
      push({
        kind: "error",
        title: "Хэт олон файл",
        description: `Нэг захиалгад хамгийн ихдээ ${MAX_ATTACHMENTS_PER_REQUEST} файл хавсаргах боломжтой`,
      });
      return;
    }
    for (const f of files) {
      if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(f.type as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number])) {
        push({ kind: "error", title: "Дэмжигдэхгүй файлын төрөл", description: `${f.name} — JPG, PNG, WEBP, PDF, XLSX, DOCX файл дэмжинэ` });
        return;
      }
      if (f.size > MAX_ATTACHMENT_SIZE_BYTES) {
        push({ kind: "error", title: "Файл хэт том байна", description: `${f.name} — 10 MB-с ихгүй байх ёстой` });
        return;
      }
    }

    setUploading(true);
    try {
      const formData = new FormData();
      for (const f of files) formData.append("files", f);
      const res = await fetch(`/api/requests/${requestId}/attachments`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Файл хавсаргахад алдаа гарлаа");
      }
      await loadRequests();
      push({ kind: "success", title: "Файл хавсаргагдлаа" });
    } catch (err) {
      push({ kind: "error", title: "Файл хавсаргахад алдаа гарлаа", description: err instanceof Error ? err.message : undefined });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      {attachments.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <Paperclip className="size-4" />
          Хавсаргасан файл алга
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((a) => {
            const href = `/api/requests/${requestId}/attachments/${a.id}`;
            const isImage = IMAGE_MIME_TYPES.has(a.mimeType);
            const content = (
              <>
                {isImage ? (
                  // Private, authenticated per-request bytes — not a static
                  // asset next/image's loader could optimize anyway.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={href} alt={a.fileName} className="h-24 w-full object-cover" />
                ) : (
                  <div className="flex h-24 w-full flex-col items-center justify-center text-text-muted">
                    <FileText className="size-6" />
                  </div>
                )}
                <div className="truncate border-t border-border px-2 py-1.5 text-[11px] text-text">{a.fileName}</div>
                <div className="px-2 pb-1.5 text-[10px] text-text-muted">{formatFileSize(a.sizeBytes)}</div>
              </>
            );
            return (
              <li key={a.id}>
                {isImage ? (
                  // Opens an in-app preview instead of navigating away — a
                  // click shouldn't leave whatever modal/page this panel is
                  // shown inside of.
                  <button
                    type="button"
                    title={a.fileName}
                    onClick={() => setPreviewAttachment(a)}
                    className="focus-ring block w-full overflow-hidden rounded-lg border border-border bg-bg-elevated/50 text-left hover:border-accent/50"
                  >
                    {content}
                  </button>
                ) : (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    title={a.fileName}
                    className="focus-ring block overflow-hidden rounded-lg border border-border bg-bg-elevated/50 hover:border-accent/50"
                  >
                    {content}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canUpload && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_ATTACHMENT_EXTENSIONS}
            className="hidden"
            onChange={(e) => {
              handleFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} loading={uploading} disabled={uploading}>
            <Paperclip className="size-3.5" />
            Файл нэмэх
          </Button>
        </div>
      )}

      <ImageLightbox
        attachment={previewAttachment}
        src={previewAttachment ? `/api/requests/${requestId}/attachments/${previewAttachment.id}` : null}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}

/**
 * Full-screen in-app image preview. Escape closes only this lightbox, not
 * whatever modal (e.g. MaterialDetailModal) it was opened from -- the
 * keydown listener runs in the capture phase and calls stopPropagation so
 * it's handled here before Modal's own (bubble-phase) Escape handler ever
 * sees the event.
 */
function ImageLightbox({
  attachment,
  src,
  onClose,
}: {
  attachment: AttachmentView | null;
  src: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!attachment) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment]);

  if (typeof document === "undefined" || !attachment || !src) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
      <button
        type="button"
        onClick={onClose}
        className="focus-ring absolute right-4 top-4 z-10 rounded-full bg-bg-surface/80 p-2 text-text hover:bg-bg-surface"
        aria-label="Хаах"
      >
        <X className="size-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={attachment.fileName}
        onClick={(e) => e.stopPropagation()}
        className="relative z-[5] max-h-full max-w-full rounded-lg object-contain shadow-elevated"
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-bg-surface/80 px-3 py-1.5 text-xs text-text"
      >
        {attachment.fileName}
      </div>
    </div>,
    document.body
  );
}
