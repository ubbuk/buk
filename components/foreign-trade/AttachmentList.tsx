"use client";

import { FileText, Paperclip } from "lucide-react";
import { ALLOWED_ATTACHMENT_EXTENSIONS } from "@/lib/attachment-rules";
import { formatFileSize } from "@/lib/utils";
import type { FtAttachmentView } from "@/lib/foreign-trade";

export function AttachmentList({ orderId, items, empty }: { orderId: string; items: FtAttachmentView[]; empty?: string }) {
  if (items.length === 0) return empty ? <p className="text-xs text-text-muted">{empty}</p> : null;
  return (
    <ul className="space-y-1.5">
      {items.map((a) => (
        <li key={a.id}>
          <a
            href={`/api/foreign-trade/${orderId}/attachments/${a.id}`}
            target="_blank"
            rel="noreferrer"
            className="focus-ring flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg-elevated/40 px-3 py-2 text-sm text-text hover:border-accent/50"
          >
            <FileText className="size-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">{a.fileName}</span>
            <span className="shrink-0 text-xs text-text-muted">{formatFileSize(a.sizeBytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A file picker that only collects files; the caller uploads them. */
export function FilePicker({ files, onChange, disabled, label = "Файл хавсаргах" }: { files: File[]; onChange: (f: File[]) => void; disabled?: boolean; label?: string }) {
  return (
    <div className="space-y-2">
      <label className="focus-within:ring-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-text-muted hover:border-accent/60 hover:text-text">
        <Paperclip className="size-4" />
        {label} <span className="text-xs">(jpg, png, pdf, xls, xlsx, docx · 10MB хүртэл)</span>
        <input
          type="file"
          multiple
          disabled={disabled}
          accept={ALLOWED_ATTACHMENT_EXTENSIONS}
          className="sr-only"
          onChange={(e) => {
            onChange([...files, ...Array.from(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-bg-elevated/50 px-2.5 py-1.5 text-xs text-text">
              <span className="min-w-0 truncate">{f.name}</span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} className="focus-ring shrink-0 rounded px-2 py-1 text-danger hover:bg-danger/10">
                Хасах
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
