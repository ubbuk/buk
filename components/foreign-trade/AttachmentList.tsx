"use client";

import { FileText } from "lucide-react";
import { formatFileSize } from "@/lib/utils";
import type { FtAttachmentView } from "@/lib/foreign-trade";
import { AttachmentPicker } from "@/components/attachments/AttachmentPicker";
import { UploadQueueList } from "@/components/attachments/UploadQueueList";
import type { UploadQueue } from "@/components/attachments/useUploadQueue";

export function AttachmentList({ orderId, items, empty }: { orderId: string; items: FtAttachmentView[]; empty?: string }) {
  if (items.length === 0) return empty ? <p className="text-xs text-text-muted">{empty}</p> : null;
  return (
    <ul className="space-y-1.5">
      {items.map((a) => {
        const href = `/api/foreign-trade/${orderId}/attachments/${a.id}`;
        return (
          <li key={a.id}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="focus-ring flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg-elevated/40 px-3 py-2 text-sm text-text hover:border-accent/50"
            >
              {a.hasThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${href}?thumb=1`} alt="" loading="lazy" className="size-9 shrink-0 rounded object-cover" />
              ) : (
                <FileText className="size-4 shrink-0 text-accent" />
              )}
              <span className="min-w-0 flex-1 truncate">{a.fileName}</span>
              <span className="shrink-0 text-xs text-text-muted">{formatFileSize(a.sizeBytes)}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Picker (camera / gallery / documents) plus the per-file status list of an upload queue; the caller uploads. */
export function FileQueueField({
  queue,
  disabled,
  label = "Файл хавсаргах",
  onRetry,
}: {
  queue: UploadQueue;
  disabled?: boolean;
  label?: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        {label} <span>(зураг автоматаар жижигрэнэ · PDF, Excel, Word 20MB хүртэл)</span>
      </p>
      <AttachmentPicker onPick={(files) => void queue.add(files)} disabled={disabled} />
      <UploadQueueList items={queue.items} onRemove={queue.remove} onRetry={onRetry} />
    </div>
  );
}
