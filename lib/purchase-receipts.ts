import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { emitBroadcast, emitUserEvent } from "./events";
import { storageConfigProblem } from "./storage";
import { buildItemView, getProcurementManagers, requestProcurementInclude } from "./procurement";
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
import {
  compareAmounts,
  itemsMissingReceipt,
  MAX_RECEIPTS_PER_REQUEST,
  MIN_WAIVE_REASON,
  RECEIPT_KIND_LABEL,
  RECEIPTS_LOCKED_MESSAGE,
  type AmountComparison,
  type ReceiptKind,
} from "./purchase-receipt-core";

// Proof of purchase (delivery note, invoice, VAT receipt, cash receipt) for the Manager procurement stage. The upload runs
// through the same direct-to-bucket steps as a request attachment (presign -> PUT -> finalize, lib/attachment-upload.ts); only
// the register differs: PurchaseReceipt rows that carry the kind and the optional supplier / number / date / amount.
//
//  - Adding and removing is only possible while the request is in procurement (PENDING_PROCUREMENT) and only by an active
//    MANAGER who may work the item (with assigned managers: the item's own manager). Removing is for the uploader only.
//    When the Chief Accountant has the request the rows are locked; a return to procurement unlocks them again.
//  - Reading follows the visibility of the request itself (checked by the routes).

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export const receiptPrefix = (requestId: string) => `${requestId}/receipts/`;

export interface ReceiptView {
  id: string;
  /** null = the whole purchase. */
  itemId: string | null;
  kind: ReceiptKind;
  kindLabel: string;
  supplierName: string | null;
  receiptNumber: string | null;
  receiptDate: string | null;
  amount: number | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  hasThumb: boolean;
  uploadedByName: string;
  uploadedAt: string;
  /** The viewer uploaded it and the request is still in procurement. */
  canRemove: boolean;
}

export interface ReceiptItemView {
  itemId: string;
  lineNo: number;
  materialName: string;
  unit: string;
  purchasedTotal: number;
  receipts: ReceiptView[];
  /** The Manager's stated reason for having no receipt for this row. */
  waiver: { reason: string; byName: string; at: string } | null;
  /** Has a receipt (its own or a whole-purchase one) or a stated reason. */
  covered: boolean;
  /** No receipt AND no reason: the red state. */
  missing: boolean;
  /** Sum of this row's own receipts when all of them carry an amount, else null. */
  receiptAmount: number | null;
  /** The viewer may add a receipt to this row right now. */
  canAttach: boolean;
}

export interface ReceiptsOverview {
  requestId: string;
  requestNumber: string;
  requestStatus: string;
  /** In procurement: receipts can still be added / removed. */
  editable: boolean;
  items: ReceiptItemView[];
  wholePurchase: ReceiptView[];
  /** The viewer may add a whole-purchase receipt right now. */
  canAttachWhole: boolean;
  comparison: AmountComparison;
  missingCount: number;
  waivedCount: number;
}

type Viewer = { id: string; role: string };

/** Everything a receipt screen needs. Visibility of the request is checked by the caller. */
export async function getReceiptsOverview(requestId: string, viewer: Viewer): Promise<ReceiptsOverview | null> {
  const [request, receipts, waivers, managers] = await Promise.all([
    prisma.materialRequest.findUnique({ where: { id: requestId }, include: requestProcurementInclude }),
    prisma.purchaseReceipt.findMany({ where: { requestId }, orderBy: { uploadedAt: "asc" }, include: { uploadedBy: { select: { name: true } } } }),
    prisma.purchaseReceiptWaiver.findMany({ where: { requestId }, include: { waivedBy: { select: { name: true } } } }),
    getProcurementManagers(),
  ]);
  if (!request) return null;

  const editable = request.status === "PENDING_PROCUREMENT";
  const isManager = viewer.role === "MANAGER";
  const toView = (r: (typeof receipts)[number]): ReceiptView => ({
    id: r.id,
    itemId: r.requestItemId,
    kind: r.kind,
    kindLabel: RECEIPT_KIND_LABEL[r.kind],
    supplierName: r.supplierName,
    receiptNumber: r.receiptNumber,
    receiptDate: r.receiptDate?.toISOString() ?? null,
    amount: r.amount === null ? null : Number(r.amount),
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    hasThumb: !!r.thumbKey,
    uploadedByName: r.uploadedBy.name,
    uploadedAt: r.uploadedAt.toISOString(),
    canRemove: editable && isManager && r.uploadedById === viewer.id,
  });

  const views = request.items.map((i) => buildItemView(i, request)).filter((v) => v.requiredQuantity > 0);
  const whole = receipts.filter((r) => r.requestItemId === null).map(toView);
  const hasWhole = whole.length > 0;
  const involved =
    managers.mode === "LEGACY" ||
    viewer.id === managers.domestic?.id ||
    viewer.id === managers.international?.id ||
    request.items.some((i) => i.procurementAssignment?.assignedManagerId === viewer.id);

  const items: ReceiptItemView[] = views.map((v) => {
    const own = receipts.filter((r) => r.requestItemId === v.itemId).map(toView);
    const waiver = waivers.find((w) => w.requestItemId === v.itemId);
    const row = request.items.find((i) => i.id === v.itemId)!;
    const assignedToViewer = managers.mode === "LEGACY" || row.procurementAssignment?.assignedManagerId === viewer.id;
    return {
      itemId: v.itemId,
      lineNo: v.lineNo,
      materialName: v.materialName,
      unit: v.unit,
      purchasedTotal: v.actualTotal,
      receipts: own,
      waiver: waiver ? { reason: waiver.reason, byName: waiver.waivedBy.name, at: waiver.waivedAt.toISOString() } : null,
      covered: own.length > 0 || hasWhole || !!waiver,
      missing: own.length === 0 && !hasWhole && !waiver,
      receiptAmount: own.length > 0 && own.every((r) => r.amount !== null) ? own.reduce((s, r) => s + (r.amount ?? 0), 0) : null,
      canAttach: editable && isManager && assignedToViewer,
    };
  });

  const purchased = items.reduce((s, i) => s + i.purchasedTotal, 0);
  return {
    requestId,
    requestNumber: request.requestNumber,
    requestStatus: request.status,
    editable,
    items,
    wholePurchase: whole,
    canAttachWhole: editable && isManager && involved,
    comparison: compareAmounts(purchased, receipts.map((r) => ({ amount: r.amount === null ? null : Number(r.amount) }))),
    missingCount: items.filter((i) => i.missing).length,
    waivedCount: items.filter((i) => i.waiver && i.receipts.length === 0).length,
  };
}

// --- who may change receipts -------------------------------------------------

type Gate = { ok: true; request: { requestNumber: string } } | { ok: false; status: number; error: string };

/** The request is in procurement, the actor is an active MANAGER who may work the item (itemId null = the whole purchase). */
async function gate(requestId: string, actorId: string, itemId: string | null): Promise<Gate> {
  const [request, actor, managers] = await Promise.all([
    prisma.materialRequest.findUnique({ where: { id: requestId }, select: { status: true, requestNumber: true, items: { select: { id: true, procurementAssignment: { select: { assignedManagerId: true } } } } } }),
    prisma.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } }),
    getProcurementManagers(),
  ]);
  if (!request) return fail(404, "Захиалга олдсонгүй");
  if (request.status !== "PENDING_PROCUREMENT") return fail(409, RECEIPTS_LOCKED_MESSAGE);
  if (!actor || !actor.isActive || actor.role !== "MANAGER") return fail(403, "Эрхгүй үйлдэл");
  if (itemId !== null && !request.items.some((i) => i.id === itemId)) return fail(404, "Захиалгын мөр олдсонгүй");
  if (managers.mode === "ASSIGNED") {
    if (itemId !== null) {
      const row = request.items.find((i) => i.id === itemId)!;
      if (row.procurementAssignment?.assignedManagerId !== actorId) return fail(403, "Энэ материалыг өөр менежер хариуцна");
    } else {
      const involved = actorId === managers.domestic?.id || actorId === managers.international?.id || request.items.some((i) => i.procurementAssignment?.assignedManagerId === actorId);
      if (!involved) return fail(403, "Эрхгүй үйлдэл");
    }
  }
  return { ok: true, request: { requestNumber: request.requestNumber } };
}

// --- upload (presign -> PUT -> finalize) ----------------------------------------

export async function presignReceipts(requestId: string, actorId: string, itemId: string | null, files: DeclaredFile[]): Promise<Result<{ data: PresignedFile[] }>> {
  const storageProblem = storageConfigProblem();
  if (storageProblem) return fail(503, storageProblem);
  const g = await gate(requestId, actorId, itemId);
  if (!g.ok) return g;
  const count = await prisma.purchaseReceipt.count({ where: { requestId } });
  if (count + files.length > MAX_RECEIPTS_PER_REQUEST) return fail(400, `Нэг захиалгад хамгийн ихдээ ${MAX_RECEIPTS_PER_REQUEST} баримт хавсаргана (одоо ${count})`);
  for (const f of files) {
    const problem = validateDeclared(f);
    if (problem) return fail(400, problem);
  }
  const res = await presignUploadsSafe({ prefix: receiptPrefix(requestId), actorId }, files);
  return res.ok ? { ok: true, data: res.data } : res;
}

export interface ReceiptMeta {
  kind: ReceiptKind;
  supplierName?: string | null;
  receiptNumber?: string | null;
  receiptDate?: string | null;
  amount?: number | null;
}

export async function finalizeReceipts(requestId: string, actorId: string, itemId: string | null, meta: ReceiptMeta, refs: UploadedRef[]): Promise<Result<{ receipts: { id: string; fileName: string }[] }>> {
  const scope = { prefix: receiptPrefix(requestId), actorId };
  const g = await gate(requestId, actorId, itemId);
  if (!g.ok) {
    // objects of a refused call must not stay behind (only keys that carry this user's valid token are touched)
    if (g.status !== 503) await discardUploads(scope, refs);
    return g;
  }
  if (meta.amount !== null && meta.amount !== undefined && !(meta.amount >= 0 && meta.amount < 1e12 && D(meta.amount).decimalPlaces() <= 2)) return fail(400, "Дүн буруу байна");
  const count = await prisma.purchaseReceipt.count({ where: { requestId } });
  if (count + refs.length > MAX_RECEIPTS_PER_REQUEST) return fail(400, `Нэг захиалгад хамгийн ихдээ ${MAX_RECEIPTS_PER_REQUEST} баримт хавсаргана (одоо ${count})`);

  const verified = await verifyUploads(scope, refs);
  if (!verified.ok) return verified;
  const clean = (v: string | null | undefined) => v?.trim() || null;
  const keys = verified.data.flatMap((f) => [f.key, f.thumbKey]);
  try {
    const rows = await prisma.$transaction(async (tx) => {
      // the request may have left procurement while the files were uploading
      const status = (await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "MaterialRequest" WHERE id = ${requestId} FOR UPDATE`)[0]?.status;
      if (status !== "PENDING_PROCUREMENT") return null;
      const created = [];
      for (const f of verified.data) {
        created.push(
          await tx.purchaseReceipt.create({
            data: {
              requestId,
              requestItemId: itemId,
              kind: meta.kind,
              supplierName: clean(meta.supplierName),
              receiptNumber: clean(meta.receiptNumber),
              receiptDate: meta.receiptDate ? new Date(meta.receiptDate) : null,
              amount: meta.amount === null || meta.amount === undefined ? null : D(meta.amount),
              fileName: f.fileName,
              storageKey: f.key,
              thumbKey: f.thumbKey,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              uploadedById: actorId,
            },
          })
        );
      }
      // a row that now has a receipt no longer needs its "no receipt" reason
      if (itemId) await tx.purchaseReceiptWaiver.deleteMany({ where: { requestItemId: itemId } });
      await tx.auditLog.create({
        data: { entityType: "MaterialRequest", entityId: requestId, action: "PURCHASE_RECEIPT_ADD", actorId, afterJson: JSON.stringify({ itemId, kind: meta.kind, files: created.map((c) => c.fileName), amount: meta.amount ?? null }) },
      });
      return created;
    });
    if (!rows) {
      await discardObjects(keys);
      return fail(409, RECEIPTS_LOCKED_MESSAGE);
    }
    emitBroadcast({ type: "request-changed" });
    return { ok: true, receipts: rows.map((r) => ({ id: r.id, fileName: r.fileName })) };
  } catch (err) {
    await discardObjects(keys);
    throw err;
  }
}

/** Removes a receipt (row and file). Only its uploader, only while the request is in procurement. */
export async function removeReceipt(requestId: string, receiptId: string, actorId: string): Promise<Result<object>> {
  const receipt = await prisma.purchaseReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt || receipt.requestId !== requestId) return fail(404, "Баримт олдсонгүй");
  const g = await gate(requestId, actorId, receipt.requestItemId);
  if (!g.ok) return g;
  if (receipt.uploadedById !== actorId) return fail(403, "Зөвхөн өөрийн бүртгэсэн баримтыг устгана");
  const done = await prisma.$transaction(async (tx) => {
    const status = (await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "MaterialRequest" WHERE id = ${requestId} FOR UPDATE`)[0]?.status;
    if (status !== "PENDING_PROCUREMENT") return false;
    const deleted = await tx.purchaseReceipt.deleteMany({ where: { id: receiptId } });
    if (deleted.count === 0) return false;
    await tx.auditLog.create({
      data: { entityType: "MaterialRequest", entityId: requestId, action: "PURCHASE_RECEIPT_REMOVE", actorId, afterJson: JSON.stringify({ itemId: receipt.requestItemId, kind: receipt.kind, file: receipt.fileName }) },
    });
    return true;
  });
  if (!done) return fail(409, RECEIPTS_LOCKED_MESSAGE);
  await discardObjects([receipt.storageKey, receipt.thumbKey]);
  emitBroadcast({ type: "request-changed" });
  return { ok: true };
}

/** "No receipt - why" for one row, before completing. */
export async function waiveReceipt(requestId: string, actorId: string, itemId: string, reason: string): Promise<Result<object>> {
  const why = reason.trim();
  if (why.length < MIN_WAIVE_REASON) return fail(400, "Баримтгүй байгаа шалтгаанаа бичнэ үү");
  if (why.length > 500) return fail(400, "Шалтгаан хэт урт байна");
  const g = await gate(requestId, actorId, itemId);
  if (!g.ok) return g;
  await prisma.$transaction(async (tx) => {
    await tx.purchaseReceiptWaiver.upsert({
      where: { requestItemId: itemId },
      create: { requestId, requestItemId: itemId, reason: why, waivedById: actorId },
      update: { reason: why, waivedById: actorId, waivedAt: new Date() },
    });
    await tx.auditLog.create({ data: { entityType: "MaterialRequest", entityId: requestId, action: "PURCHASE_RECEIPT_WAIVE", actorId, afterJson: JSON.stringify({ itemId, reason: why }) } });
  });
  emitBroadcast({ type: "request-changed" });
  return { ok: true };
}

/** Which object to serve for a receipt (the thumbnail when asked for and present). */
export async function getReceiptRef(requestId: string, receiptId: string, thumb = false): Promise<Result<{ ref: { fileName: string; mimeType: string; key: string } }>> {
  const r = await prisma.purchaseReceipt.findUnique({ where: { id: receiptId } });
  if (!r || r.requestId !== requestId) return fail(404, "Баримт олдсонгүй");
  if (thumb && r.thumbKey) return { ok: true, ref: { fileName: r.fileName, mimeType: "image/jpeg", key: r.thumbKey } };
  return { ok: true, ref: { fileName: r.fileName, mimeType: r.mimeType, key: r.storageKey } };
}

// --- the Chief Accountant sends it back ---------------------------------------------

/**
 * The Chief Accountant returns the request to the Manager (reason required): it goes back to procurement, the procurement
 * step is open again and the receipts are editable. The managers who worked on it are told.
 */
export async function returnToProcurement(requestId: string, actorId: string, reason: string): Promise<Result<object>> {
  const why = reason.trim();
  if (why.length < MIN_WAIVE_REASON) return fail(400, "Буцаах шалтгаанаа бичнэ үү");
  if (why.length > 1000) return fail(400, "Шалтгаан хэт урт байна");

  const outcome = await prisma.$transaction(async (tx) => {
    const status = (await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "MaterialRequest" WHERE id = ${requestId} FOR UPDATE`)[0]?.status;
    if (!status) return fail(404, "Захиалга олдсонгүй");
    if (status !== "PENDING_ACCOUNTING") return fail(409, "Энэ захиалга одоогоор санхүүгийн бүртгэлийн шатанд байхгүй байна");
    const steps = await tx.approvalStep.findMany({ where: { requestId, type: { in: ["ACCOUNTING_RECORD", "MANAGER_PROCUREMENT"] } } });
    const accounting = steps.find((s) => s.type === "ACCOUNTING_RECORD");
    const procurement = steps.find((s) => s.type === "MANAGER_PROCUREMENT");
    if (!accounting || accounting.assignedUserId !== actorId) return fail(403, "Та санхүүгийн бүртгэл хийх эрхгүй байна");
    if (!procurement) return fail(409, "Энэ захиалга худалдан авалтын шатгүй тул буцаах боломжгүй");

    await tx.approvalStep.update({ where: { id: procurement.id }, data: { status: "PENDING", decidedAt: null, decidedById: null } });
    const request = await tx.materialRequest.update({ where: { id: requestId }, data: { status: "PENDING_PROCUREMENT", version: { increment: 1 } }, select: { requestNumber: true } });
    await tx.auditLog.create({ data: { entityType: "MaterialRequest", entityId: requestId, action: "PROCUREMENT_RETURN", actorId, afterJson: JSON.stringify({ reason: why }) } });

    const buyers = await tx.procurementPurchase.findMany({ where: { requestItem: { requestId } }, select: { purchasedById: true }, distinct: ["purchasedById"] });
    const ids = new Set(buyers.map((b) => b.purchasedById));
    if (procurement.decidedById) ids.add(procurement.decidedById);
    if (ids.size === 0) for (const m of await tx.user.findMany({ where: { role: "MANAGER", isActive: true }, select: { id: true } })) ids.add(m.id);
    for (const userId of ids) {
      await tx.notification.create({
        data: { userId, type: "PROCUREMENT_REQUIRED", title: "Нягтлан худалдан авалтыг буцаалаа", body: `№${request.requestNumber}: ${why}`, relatedRequestId: requestId },
      });
    }
    return { ok: true as const, notify: [...ids] };
  });
  if (!outcome.ok) return outcome;
  emitBroadcast({ type: "request-changed" });
  for (const id of outcome.notify) emitUserEvent(id, { type: "notification" });
  return { ok: true };
}

/** Rows without a receipt or a reason, for callers that only need the verdict (used by tests and the monitoring views). */
export async function missingReceiptItemIds(requestId: string): Promise<string[]> {
  const request = await prisma.materialRequest.findUnique({ where: { id: requestId }, include: requestProcurementInclude });
  if (!request) return [];
  const [receipts, waivers] = await Promise.all([
    prisma.purchaseReceipt.findMany({ where: { requestId }, select: { requestItemId: true } }),
    prisma.purchaseReceiptWaiver.findMany({ where: { requestId }, select: { requestItemId: true } }),
  ]);
  return itemsMissingReceipt({
    itemIds: request.items.map((i) => buildItemView(i, request)).filter((v) => v.requiredQuantity > 0).map((v) => v.itemId),
    receiptItemIds: receipts.map((r) => r.requestItemId),
    waivedItemIds: waivers.map((w) => w.requestItemId),
  });
}
