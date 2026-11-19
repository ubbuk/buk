"use client";

import { Camera, FileText, Images } from "lucide-react";
import { useRef } from "react";
import { ALLOWED_IMAGE_PICKER_ACCEPT } from "@/lib/attachment-rules";

const DOCUMENT_ACCEPT = ".pdf,.xlsx,.xls,.docx";
const buttonClass =
  "focus-ring inline-flex min-h-12 min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-bg-elevated/50 px-3 py-2 text-sm font-medium text-text hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none sm:flex-row sm:gap-2";

/**
 * Three ways to add files, as separate big buttons (a phone user should not have to find the camera inside a file
 * dialog): the camera opens straight away (capture), the gallery picks several photos, "Баримт" picks PDF / Excel / Word.
 * It only collects; the caller's upload queue does the rest.
 */
export function AttachmentPicker({ onPick, disabled, documents = true }: { onPick: (files: File[]) => void; disabled?: boolean; documents?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const docs = useRef<HTMLInputElement>(null);
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPick(Array.from(e.target.files ?? []));
    e.target.value = ""; // the same photo can be picked again
  };

  return (
    <div className="flex flex-wrap gap-2" data-testid="attachment-picker">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={handle} data-testid="pick-camera" />
      <input ref={gallery} type="file" accept={ALLOWED_IMAGE_PICKER_ACCEPT} multiple className="hidden" onChange={handle} data-testid="pick-gallery" />
      <input ref={docs} type="file" accept={DOCUMENT_ACCEPT} multiple className="hidden" onChange={handle} data-testid="pick-docs" />
      <button type="button" className={buttonClass} disabled={disabled} onClick={() => camera.current?.click()}>
        <Camera className="size-5 shrink-0" aria-hidden />
        Зураг авах
      </button>
      <button type="button" className={buttonClass} disabled={disabled} onClick={() => gallery.current?.click()}>
        <Images className="size-5 shrink-0" aria-hidden />
        Галерей
      </button>
      {documents && (
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => docs.current?.click()}>
          <FileText className="size-5 shrink-0" aria-hidden />
          Баримт
        </button>
      )}
    </div>
  );
}
