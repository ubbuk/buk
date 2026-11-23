import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { storage, storageConfigProblem } from "./storage";
import { emitBroadcast } from "./events";
import { ALLOWED_ATTACHMENT_MIME_TYPES, MAX_ATTACHMENTS_PER_REQUEST, maxSizeFor, maxSizeLabel } from "./attachment-rules";
import { signatureMatches, SIGNATURE_BYTES } from "./file-signature";
import {
  discardObjects,
  discardUploads,
  presignUploadsSafe,
  validateDeclared,
  verifyUploads,
  type DeclaredFile,
  type PresignedFile,
  type UploadedRef,
} from "./attachment-upload";

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
  const storageProblem = storageConfigProblem();
  if (storageProblem) return { ok: false, status: 503, error: storageProblem };

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
    if (file.sizeBytes > maxSizeFor(file.mimeType)) {
      return { ok: false, status: 400, error: `Файл хэт том байна (${maxSizeLabel(file.mimeType)}-с ихгүй байх ёстой): ${file.fileName}` };
    }
    if (file.sizeBytes === 0) {
      return { ok: false, status: 400, error: `Хоосон файл хавсаргах боломжгүй: ${file.fileName}` };
    }
    if (!signatureMatches(file.mimeType, file.buffer.subarray(0, SIGNATURE_BYTES))) {
      return { ok: false, status: 400, error: `Файлын агуулга төрөлтэйгээ таарахгүй байна: ${file.fileName}` };
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

type Gate = { ok: true } | { ok: false; status: number; error: string };

/** Owner + count check shared by the presign and finalize steps (`incoming` = files being added). */
async function checkCanAttach(requestId: string, actorId: string, incoming: number): Promise<Gate> {
  const storageProblem = storageConfigProblem();
  if (storageProblem) return { ok: false, status: 503, error: storageProblem };
  if (incoming === 0) return { ok: false, status: 400, error: "Файл сонгоогүй байна" };
  const request = await prisma.materialRequest.findUnique({
    where: { id: requestId },
    select: { requestedById: true, _count: { select: { attachments: true } } },
  });
  if (!request) return { ok: false, status: 404, error: "Захиалга олдсонгүй" };
  if (request.requestedById !== actorId) {
    return { ok: false, status: 403, error: "Зөвхөн захиалга үүсгэсэн ажилтан файл хавсаргах боломжтой" };
  }
  if (request._count.attachments + incoming > MAX_ATTACHMENTS_PER_REQUEST) {
    return {
      ok: false,
      status: 400,
      error: `Нэг захиалгад хамгийн ихдээ ${MAX_ATTACHMENTS_PER_REQUEST} файл хавсаргах боломжтой (одоо ${request._count.attachments}, нэмж ${incoming} илгээв)`,
    };
  }
  return { ok: true };
}

const prefixOf = (requestId: string) => `${requestId}/`;

/** Step 1 of a direct upload: validates what the browser declares and returns the PUT URLs. */
export async function presignAttachments(requestId: string, actorId: string, files: DeclaredFile[]): Promise<AttachmentResult<PresignedFile[]>> {
  const gate = await checkCanAttach(requestId, actorId, files.length);
  if (!gate.ok) return gate;
  for (const f of files) {
    const problem = validateDeclared(f);
    if (problem) return { ok: false, status: 400, error: problem };
  }
  return presignUploadsSafe({ prefix: prefixOf(requestId), actorId }, files);
}

/** Step 3: the files are in the bucket; check them there and register the metadata. */
export async function finalizeAttachments(
  requestId: string,
  actorId: string,
  refs: UploadedRef[]
): Promise<AttachmentResult<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }[]>> {
  const gate = await checkCanAttach(requestId, actorId, refs.length);
  if (!gate.ok) {
    // Objects of a refused call must not stay behind; only keys that carry this user's valid token are touched.
    if (gate.status !== 503) await discardUploads({ prefix: prefixOf(requestId), actorId }, refs);
    return gate;
  }
  const verified = await verifyUploads({ prefix: prefixOf(requestId), actorId }, refs);
  if (!verified.ok) return verified;

  const keys = verified.data.flatMap((f) => [f.key, f.thumbKey]);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const f of verified.data) {
        rows.push(
          await tx.attachment.create({
            data: { requestId, fileName: f.fileName, storageKey: f.key, thumbKey: f.thumbKey, mimeType: f.mimeType, sizeBytes: f.sizeBytes, uploadedById: actorId },
          })
        );
      }
      await tx.auditLog.create({
        data: { entityType: "MaterialRequest", entityId: requestId, action: "ATTACHMENT_UPLOAD", actorId, afterJson: JSON.stringify({ files: rows.map((r) => r.fileName) }) },
      });
      return rows;
    });
    emitBroadcast({ type: "request-changed" });
    return {
      ok: true,
      data: created.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, uploadedAt: a.uploadedAt.toISOString() })),
    };
  } catch (err) {
    await discardObjects(keys);
    throw err;
  }
}

/** Deletes a request together with its files (the rows go by cascade; the objects in storage do not). */
export async function deleteRequestWithFiles(requestId: string): Promise<void> {
  const files = await prisma.attachment.findMany({ where: { requestId }, select: { storageKey: true, thumbKey: true } });
  await prisma.materialRequest.delete({ where: { id: requestId } });
  await discardObjects(files.flatMap((f) => [f.storageKey, f.thumbKey]));
}

export interface AttachmentRef {
  fileName: string;
  mimeType: string;
  key: string;
}

/** Which object to serve (the thumbnail when asked for and present), without reading it. */
export async function getAttachmentRef(requestId: string, attachmentId: string, thumb = false): Promise<AttachmentResult<AttachmentRef>> {
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.requestId !== requestId) {
    return { ok: false, status: 404, error: "Хавсралт олдсонгүй" };
  }
  if (thumb && attachment.thumbKey) return { ok: true, data: { fileName: attachment.fileName, mimeType: "image/jpeg", key: attachment.thumbKey } };
  return { ok: true, data: { fileName: attachment.fileName, mimeType: attachment.mimeType, key: attachment.storageKey } };
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
