// Shared between client (form validation) and server (lib/attachments.ts) —
// kept dependency-free (no node:fs/node:crypto) so it's safe to import from
// "use client" components.
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
] as const;

export const ALLOWED_ATTACHMENT_EXTENSIONS = ".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.docx";

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ATTACHMENTS_PER_REQUEST = 10;
