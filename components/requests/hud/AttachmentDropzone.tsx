"use client";

import { Files } from "lucide-react";
import { formatFileSize } from "@/lib/utils";
import { MAX_ATTACHMENTS_PER_REQUEST } from "@/lib/attachment-rules";
import { AttachmentPicker } from "@/components/attachments/AttachmentPicker";
import { UploadQueueList } from "@/components/attachments/UploadQueueList";
import type { UploadQueue } from "@/components/attachments/useUploadQueue";
import { HudPanel } from "./HudPanel";

interface ExistingAttachment {
  id: string;
  fileName: string;
  sizeBytes: number;
  href: string;
}

// Picking (camera / gallery / documents), compression and upload are handled by the queue; this only lays them out.
export function AttachmentDropzone({
  queue,
  existing,
  onRetry,
}: {
  queue: UploadQueue;
  existing: ExistingAttachment[];
  onRetry: (id: string) => void;
}) {
  return (
    <HudPanel chamfer={14} innerClassName="space-y-3 p-4 sm:p-5">
      <AttachmentPicker onPick={(files) => void queue.add(files)} />
      <p className="text-xs text-text-muted">
        Зургийг автоматаар жижигрүүлж, байршлын мэдээллийг устгана · PDF, Excel, Word 20 MB хүртэл · Нийт {MAX_ATTACHMENTS_PER_REQUEST} файл хүртэл
      </p>

      {existing.length > 0 && (
        <ul className="grid gap-2 md:grid-cols-2">
          {existing.map((a) => (
            <li key={a.id} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-tech/25 bg-bg/60 px-3 py-2 text-xs">
              <a href={a.href} target="_blank" rel="noreferrer" className="focus-ring flex min-w-0 items-center gap-2 text-text hover:text-accent">
                <Files className="size-4 shrink-0 text-tech" />
                <span className="truncate max-sm:whitespace-normal max-sm:break-words underline decoration-dotted">{a.fileName}</span>
              </a>
              <span className="shrink-0 text-text-muted">{formatFileSize(a.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      )}

      <UploadQueueList items={queue.items} onRemove={queue.remove} onRetry={onRetry} />
    </HudPanel>
  );
}
