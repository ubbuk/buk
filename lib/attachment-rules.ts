// Shared between client (form validation) and server (lib/attachments.ts) —
// kept dependency-free (no node:fs/node:crypto) so it's safe to import from
// "use client" components.
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
] as const;

export type AllowedAttachmentMime = (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

// What the file picker offers. HEIC/HEIF are accepted by the picker only: the browser converts them to JPEG before
// upload, so the server never sees them (and still refuses them).
export const ALLOWED_ATTACHMENT_EXTENSIONS = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.xlsx,.xls,.docx";
export const ALLOWED_IMAGE_PICKER_ACCEPT = "image/*,.heic,.heif";

// Images are re-encoded in the browser first (see lib/image-compress.ts), so the limit applies to the compressed file.
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB (PDF, Excel, Word)
export const MAX_THUMB_SIZE_BYTES = 256 * 1024;
/** Kept for callers that only need "the biggest a single file may ever be". */
export const MAX_ATTACHMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_BYTES;
export const MAX_ATTACHMENTS_PER_REQUEST = 10;

export const IMAGE_MAX_EDGE_PX = 2000;
export const IMAGE_JPEG_QUALITY = 0.8;
export const THUMB_MAX_EDGE_PX = 300;
export const THUMB_JPEG_QUALITY = 0.7;

export function isImageMime(mime: string): boolean {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

export function isAllowedMime(mime: string): mime is AllowedAttachmentMime {
  return (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime);
}

export function maxSizeFor(mime: string): number {
  return isImageMime(mime) ? MAX_IMAGE_SIZE_BYTES : MAX_DOCUMENT_SIZE_BYTES;
}

export function maxSizeLabel(mime: string): string {
  return isImageMime(mime) ? "10 MB" : "20 MB";
}

export function isHeic(file: { name: string; type: string }): boolean {
  return /^image\/hei[cf]$/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}
