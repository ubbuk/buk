"use client";

import { CloudUpload, Files, X } from "lucide-react";
import { useRef, useState } from "react";
import { formatFileSize } from "@/lib/utils";
import { ALLOWED_ATTACHMENT_EXTENSIONS, MAX_ATTACHMENTS_PER_REQUEST } from "@/lib/attachment-rules";
import { HudPanel } from "./HudPanel";

interface ExistingAttachment {
  id: string;
  fileName: string;
  sizeBytes: number;
  href: string;
}

// Validation (type, size, count) stays in the form's onFilesSelected; this
// only collects files from click or drag-and-drop and lists them.
export function AttachmentDropzone({
  files,
  existing,
  onSelect,
  onRemove,
}: {
  files: File[];
  existing: ExistingAttachment[];
  onSelect: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <HudPanel chamfer={14} innerClassName="p-5">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_ATTACHMENT_EXTENSIONS}
        className="hidden"
        onChange={(e) => {
          onSelect(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <div
        data-drag={dragging}
        className="hud-dropzone focus-ring flex min-h-[110px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-4 py-5 text-center"
        role="button"
        tabIndex={0}
        aria-label="Файл хавсаргах"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onSelect(Array.from(e.dataTransfer.files));
        }}
      >
        <CloudUpload className="size-9 text-tech" />
        <p className="text-sm font-semibold text-text">
          Файл чирж оруулах эсвэл <span className="text-accent underline">сонгох</span>
        </p>
        <p className="text-xs text-text-muted">
          JPG, PNG, WEBP, PDF, XLSX, DOCX · Нэг файл 10 MB хүртэл · Нийт {MAX_ATTACHMENTS_PER_REQUEST} файл хүртэл
        </p>
      </div>

      {(existing.length > 0 || files.length > 0) && (
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {existing.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-tech/25 bg-bg/60 px-3 py-2 text-xs">
              <a href={a.href} target="_blank" rel="noreferrer" className="focus-ring flex min-w-0 items-center gap-2 text-text hover:text-accent">
                <Files className="size-4 shrink-0 text-tech" />
                <span className="truncate max-sm:whitespace-normal max-sm:break-words underline decoration-dotted">{a.fileName}</span>
              </a>
              <span className="shrink-0 text-text-muted">{formatFileSize(a.sizeBytes)}</span>
            </li>
          ))}
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="hud-pop flex items-center justify-between gap-2 rounded-lg border border-tech/25 bg-bg/60 px-3 py-2 text-xs">
              <span className="flex min-w-0 items-center gap-2 text-text">
                <Files className="size-4 shrink-0 text-accent" />
                <span className="truncate max-sm:whitespace-normal max-sm:break-words">{f.name}</span>
                <span className="shrink-0 text-text-muted">({formatFileSize(f.size)})</span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`${f.name} хасах`}
                className="focus-ring rounded text-text-muted hover:text-danger"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </HudPanel>
  );
}
