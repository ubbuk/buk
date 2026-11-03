import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { storage } from "./storage";
import { emitBroadcast } from "./events";
import { ALLOWED_ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_SIZE_BYTES, MAX_ATTACHMENTS_PER_REQUEST } from "./attachment-rules";

type AttachmentResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export interface IncomingFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

/**
 * Only the request's own requester can attach files — matches the
 * ownership-style checks already in lib/workflow.ts (e.g.
 * resubmitDepartmentReturn's "only the requester can resubmit"), as
 * opposed to the role checks that live at the route level elsewhere in
 * this app. Download/view, by contrast, follows this app's existing
 * precedent that any authenticated user can view any request (GET
 * /api/requests has no per-row access filtering) — so there is no
 * matching ownership check for reads, only the session check already done
 * at the route.
 */
export async function addAttachments(
  requestId: string,
  actorId: string,
  files: IncomingFile[]
): Promise<AttachmentResult<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }[]>> {
  if (files.length === 0) return { ok: false, status: 400, error: "Файл сонгоогүй байна" };

  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    select: { requestedById: true, _count: { select: { attachments: true } } },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };
  if (request.requestedById !== actorId) {
    return { ok: false, status: 403, error: "Зөвхөн захиалга үүсгэсэн ажилтан файл хавсаргах боломжтой" };
  }
  if (request._count.attachments + files.length > MAX_ATTACHMENTS_PER_REQUEST) {
    return {
      ok: false,
      status: 400,
      error: `Нэг захиалгад хамгийн ихдээ ${MAX_ATTACHMENTS_PER_REQUEST} файл хавсаргах боломжтой (одоо ${request._count.attachments}, нэмж ${files.length} илгээв)`,
    };
  }

  for (const file of files) {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimeType as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number])) {
      return { ok: false, status: 400, error: `Дэмжигдэхгүй файлын төрөл: ${file.fileName} (${file.mimeType})` };
    }
    if (file.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
      return { ok: false, status: 400, error: `Файл хэт том байна (10 MB-с ихгүй байх ёстой): ${file.fileName}` };
    }
    if (file.sizeBytes === 0) {
      return { ok: false, status: 400, error: `Хоосон файл хавсаргах боломжгүй: ${file.fileName}` };
    }
  }

  // Write every file to storage before touching the database -- an attachment
  // row must never point at a file that doesn't exist. The reverse (a file on
  // disk with no DB row, if a later write in this loop fails) just orphans
  // storage, which is safe to leave and clean up later, not a correctness
  // problem for the app.
  const written: { key: string; file: IncomingFile }[] = [];
  try {
    for (const file of files) {
      const key = `${requestId}/${randomUUID()}`;
      await storage.put(key, file.buffer);
      written.push({ key, file });
    }
  } catch {
    for (const w of written) await storage.delete(w.key).catch(() => {});
    return { ok: false, status: 500, error: "Файл хадгалахад алдаа гарлаа. Дахин оролдоно уу" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const rows = await Promise.all(
        written.map((w) =>
          tx.attachment.create({
            data: {
              requestId,
              fileName: w.file.fileName,
              storageKey: w.key,
              mimeType: w.file.mimeType,
              sizeBytes: w.file.sizeBytes,
              uploadedById: actorId,
            },
          })
        )
      );
      await tx.auditLog.create({
        data: {
          entityType: "MaterialRequest",
          entityId: requestId,
          action: "ATTACHMENT_UPLOAD",
          actorId,
          afterJson: JSON.stringify({ files: rows.map((r) => r.fileName) }),
        },
      });
      return rows;
    });

    emitBroadcast({ type: "request-changed" });
    return {
      ok: true,
      data: created.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        uploadedAt: a.uploadedAt.toISOString(),
      })),
    };
  } catch (err) {
    for (const w of written) await storage.delete(w.key).catch(() => {});
    throw err;
  }
}

export async function getAttachmentFile(
  requestId: string,
  attachmentId: string
): Promise<AttachmentResult<{ fileName: string; mimeType: string; data: Buffer }>> {
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.requestId !== requestId) {
    return { ok: false, status: 404, error: "Хавсралт олдсонгүй" };
  }
  const data = await storage.get(attachment.storageKey);
  if (!data) return { ok: false, status: 404, error: "Файл олдсонгүй" };
  return { ok: true, data: { fileName: attachment.fileName, mimeType: attachment.mimeType, data } };
}
