// Захиалга (MaterialRequest) БҮРЭН устгах: нэг захиалга (ADMIN, API) ба ашиглалтын өмнөх цэвэрлэгээ (scripts/cleanup-test-orders.ts)
// хоёрт нэг л логик. 1С-д огт хамаагүй (зөвхөн ERP-ийн өөрийн DB, хавсралтын агуулах).
//
// Устах: захиалга, мөрүүд, батлалтын алхам + түүх (ApprovalAction), агуулахын шалгалт/нөөцлөлт/олголт, худалдан авалт, баримт/чек,
// гүйцэтгэх захирлын шийдвэр, мэдэгдэл, хавсралтын мөр, санхүүгийн бүртгэл (зөвхөн includeFinance), дараа нь агуулахын файлууд (thumb-тэй).
// Үлдэх: хэрэглэгч, хэлтэс, материал, тохиргоо, 1С-ийн өгөгдөл, аудит лог (REQUEST_DELETE: хэн, хэзээ, ямар захиалга, дүн, үүсгэгч).
// Анхаар: агуулахаас олгогдсон нөөц (quantityOnHand) БУЦААГДАХГҮЙ — бодит хөдөлгөөн болсон гэж үзнэ.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { storage } from "./storage";

import { FINANCE_BLOCK_MESSAGE } from "./request-delete-text";
export { FINANCE_BLOCK_MESSAGE };

export interface DeletionSummary {
  id: string;
  requestNumber: string;
  status: string;
  createdAt: Date;
  requesterId: string;
  requesterName: string;
  /** Мөрүүдийн нийт дүн; үнэгүй мөр байвал null */
  totalAmount: number | null;
  financeRecorded: boolean;
  counts: {
    items: number;
    approvalSteps: number;
    approvalActions: number;
    notifications: number;
    attachments: number;
    receipts: number;
    purchases: number;
    stockIssues: number;
  };
  /** Агуулахаас устгах объектын түлхүүрүүд (файл + thumb) */
  storageKeys: string[];
}

export type DeleteOutcome =
  | { ok: true; summary: DeletionSummary; storageFailed: string[] }
  | { ok: false; status: number; error: string };

/** Санхүүд бүртгэгдсэн = нягтлангийн бүртгэл (AccountingRecord) байгаа эсвэл төлөв нь ACCOUNTING_COMPLETED. */
export const isFinanceRecorded = (r: { status: string; accountingRecord: unknown | null }) => r.accountingRecord !== null || r.status === "ACCOUNTING_COMPLETED";

type Db = Prisma.TransactionClient;

async function summarize(db: Db, id: string): Promise<DeletionSummary | null> {
  const r = await db.materialRequest.findUnique({
    where: { id },
    select: {
      id: true,
      requestNumber: true,
      status: true,
      createdAt: true,
      requestedById: true,
      requestedBy: { select: { name: true } },
      accountingRecord: { select: { id: true } },
      items: { select: { totalPrice: true, _count: { select: { reservations: true, purchases: true } } } },
      attachments: { select: { storageKey: true, thumbKey: true } },
      purchaseReceipts: { select: { storageKey: true, thumbKey: true } },
      _count: { select: { approvalSteps: true, notifications: true } },
    },
  });
  if (!r) return null;
  const [approvalActions, stockIssues] = await Promise.all([
    db.approvalAction.count({ where: { approvalStep: { requestId: id } } }),
    db.stockIssue.count({ where: { reservation: { requestItem: { requestId: id } } } }),
  ]);
  const files = [...r.attachments, ...r.purchaseReceipts];
  const keys = new Set<string>();
  for (const f of files) {
    keys.add(f.storageKey);
    if (f.thumbKey) keys.add(f.thumbKey);
  }
  return {
    id: r.id,
    requestNumber: r.requestNumber,
    status: r.status,
    createdAt: r.createdAt,
    requesterId: r.requestedById,
    requesterName: r.requestedBy.name,
    totalAmount: r.items.some((i) => i.totalPrice === null) ? null : r.items.reduce((s, i) => s + Number(i.totalPrice), 0),
    financeRecorded: isFinanceRecorded(r),
    counts: {
      items: r.items.length,
      approvalSteps: r._count.approvalSteps,
      approvalActions,
      notifications: r._count.notifications,
      attachments: r.attachments.length,
      receipts: r.purchaseReceipts.length,
      purchases: r.items.reduce((s, i) => s + i._count.purchases, 0),
      stockIssues,
    },
    storageKeys: [...keys],
  };
}

/** Устгахгүйгээр: юу устахыг тоолно (dry-run, дэлгэрэнгүйн урьдчилсан харагдац). */
export const describeDeletion = (id: string) => summarize(prisma, id);

/**
 * Нэг захиалгыг устгана (эрх, нэр, PIN-ийн шалгалтыг дуудагч хийсэн байх ёстой).
 * Санхүүд бүртгэгдсэн бол includeFinance=false үед ХЭЗЭЭ Ч устгахгүй (транзакц дотор дахин шалгана).
 * DB-ийн устгал + аудит нэг транзакц; файлыг commit-ийн дараа устгана, амжилтгүй түлхүүрийг аудитад тэмдэглэнэ.
 */
export async function deleteRequest(
  id: string,
  actor: { id: string; ipAddress?: string | null },
  opts: { includeFinance?: boolean; via?: "api" | "cleanup-script" } = {}
): Promise<DeleteOutcome> {
  let auditId = "";
  const summary = await prisma.$transaction(async (tx): Promise<DeletionSummary | "NOT_FOUND" | "FINANCE"> => {
    const s = await summarize(tx, id);
    if (!s) return "NOT_FOUND";
    if (s.financeRecorded && !opts.includeFinance) return "FINANCE";

    // Cascade-гүй хамаарлыг дарааллаар нь (хүүхдээс эцэг рүү). Бусад (мөр, алхам, шийдвэр, баримт, хавсралт) onDelete: Cascade.
    await tx.stockIssue.deleteMany({ where: { reservation: { requestItem: { requestId: id } } } });
    await tx.stockReservation.deleteMany({ where: { requestItem: { requestId: id } } });
    await tx.procurementPurchase.deleteMany({ where: { requestItem: { requestId: id } } });
    await tx.warehouseCheck.deleteMany({ where: { requestId: id } }); // WarehouseCheckItem cascade
    await tx.approvalAction.deleteMany({ where: { approvalStep: { requestId: id } } });
    await tx.notification.deleteMany({ where: { relatedRequestId: id } });
    await tx.accountingRecord.deleteMany({ where: { requestId: id } });
    await tx.materialRequest.delete({ where: { id } });

    const audit = await tx.auditLog.create({
      data: {
        entityType: "MaterialRequest",
        entityId: id,
        action: "REQUEST_DELETE",
        actorId: actor.id,
        ipAddress: actor.ipAddress ?? null,
        beforeJson: JSON.stringify({
          requestNumber: s.requestNumber,
          status: s.status,
          totalAmount: s.totalAmount,
          requesterId: s.requesterId,
          requesterName: s.requesterName,
          createdAt: s.createdAt.toISOString(),
          financeRecorded: s.financeRecorded,
          counts: s.counts,
          files: s.storageKeys.length,
          via: opts.via ?? "api",
        }),
      },
      select: { id: true },
    });
    auditId = audit.id;
    return s;
  });

  if (summary === "NOT_FOUND") return { ok: false, status: 404, error: "Захиалга олдсонгүй" };
  if (summary === "FINANCE") return { ok: false, status: 409, error: FINANCE_BLOCK_MESSAGE };

  // Файлыг DB-ийн commit-ийн дараа: DB-д мөр үлдээд файл байхгүй болохоос (эвдэрсэн холбоос) сэргийлнэ. Амжилтгүй бол түлхүүрийг аудитад үлдээнэ.
  const storageFailed: string[] = [];
  for (const key of summary.storageKeys) {
    try {
      await storage.delete(key);
    } catch {
      storageFailed.push(key);
    }
  }
  if (storageFailed.length > 0) {
    await prisma.auditLog.update({ where: { id: auditId }, data: { afterJson: JSON.stringify({ storageDeleteFailed: storageFailed }) } });
  }
  return { ok: true, summary, storageFailed };
}

export interface CleanupFilter {
  /** createdAt < before (Улаанбаатарын цагаар 00:00) */
  before?: Date;
  /** id эсвэл requestNumber */
  ids?: string[];
}

export interface CleanupPlan {
  targets: DeletionSummary[];
  /** Санхүүд бүртгэгдсэн тул алгассан (includeFinance=false) */
  skippedFinance: DeletionSummary[];
  /** --ids-д өгсөн боловч олдоогүй */
  notFound: string[];
  totals: { requests: number; items: number; approvalActions: number; notifications: number; attachmentRows: number; storageObjects: number; stockIssues: number };
}

/** Аль захиалга устахыг тодорхойлно (юуг ч устгахгүй). */
export async function planCleanup(filter: CleanupFilter, opts: { includeFinance?: boolean } = {}): Promise<CleanupPlan> {
  if (!filter.before && !(filter.ids && filter.ids.length > 0)) throw new Error("--before эсвэл --ids заавал өгнө");
  const where: Prisma.MaterialRequestWhereInput = filter.ids?.length
    ? { OR: [{ id: { in: filter.ids } }, { requestNumber: { in: filter.ids } }] }
    : { createdAt: { lt: filter.before } };
  const found = await prisma.materialRequest.findMany({ where, select: { id: true, requestNumber: true }, orderBy: { createdAt: "asc" } });
  const notFound = filter.ids?.length ? filter.ids.filter((x) => !found.some((f) => f.id === x || f.requestNumber === x)) : [];
  const all: DeletionSummary[] = [];
  for (const f of found) {
    const s = await describeDeletion(f.id);
    if (s) all.push(s);
  }
  const targets = all.filter((s) => !s.financeRecorded || opts.includeFinance);
  const skippedFinance = all.filter((s) => s.financeRecorded && !opts.includeFinance);
  const sum = (f: (s: DeletionSummary) => number) => targets.reduce((a, s) => a + f(s), 0);
  return {
    targets,
    skippedFinance,
    notFound,
    totals: {
      requests: targets.length,
      items: sum((s) => s.counts.items),
      approvalActions: sum((s) => s.counts.approvalActions),
      notifications: sum((s) => s.counts.notifications),
      attachmentRows: sum((s) => s.counts.attachments + s.counts.receipts),
      storageObjects: sum((s) => s.storageKeys.length),
      stockIssues: sum((s) => s.counts.stockIssues),
    },
  };
}

/** Төлөвлөгөөг гүйцэтгэнэ (--apply). Захиалга тус бүр тусдаа транзакц: нэг нь унавал бусад нь хэвээр. */
export async function applyCleanup(plan: CleanupPlan, actorId: string, opts: { includeFinance?: boolean } = {}) {
  const deleted: string[] = [];
  const failed: { requestNumber: string; error: string }[] = [];
  const storageFailed: string[] = [];
  for (const t of plan.targets) {
    const r = await deleteRequest(t.id, { id: actorId, ipAddress: "cleanup-script" }, { includeFinance: opts.includeFinance, via: "cleanup-script" });
    if (r.ok) {
      deleted.push(t.requestNumber);
      storageFailed.push(...r.storageFailed);
    } else failed.push({ requestNumber: t.requestNumber, error: r.error });
  }
  return { deleted, failed, storageFailed };
}

/** `--before 2026-11-28` → Улаанбаатарын (UTC+8) тэр өдрийн 00:00. */
export function parseBeforeDate(v: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("--before нь YYYY-MM-DD хэлбэртэй байна");
  const d = new Date(`${v}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) throw new Error("--before огноо буруу");
  return d;
}
