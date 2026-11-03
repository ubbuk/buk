import type {
  AccountingRecord,
  ApprovalAction,
  ApprovalStep,
  Attachment,
  Department,
  Material,
  MaterialRequest,
  MaterialRequestItem,
  User,
  WarehouseCheckItem,
} from "@prisma/client";
import type {
  AccountingRecordView,
  ApprovalStepView,
  AttachmentView,
  MaterialRequestItemView,
  MaterialRequestView,
} from "./types";

function dec(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

// For fields where null is a real, distinct value ("no price entered yet")
// rather than something safe to default to 0 — see formatCurrency, which
// renders this null as "Тодорхойгүй" rather than ₮0.
function decOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

type ItemWithMaterial = MaterialRequestItem & {
  material: Material | null;
  warehouseCheckItems: WarehouseCheckItem[];
};
type StepWithUser = ApprovalStep & {
  assignedUser: User | null;
  actions: (ApprovalAction & { actor: User })[];
};
type AccountingRecordWithUser = AccountingRecord & { recordedBy: User };
// storageKey is deliberately left out of requestInclude's attachment
// select below -- the client never needs it, every download goes through
// the authenticated route instead.
type AttachmentMeta = Pick<Attachment, "id" | "fileName" | "mimeType" | "sizeBytes" | "uploadedAt" | "uploadedById">;
type RequestWithRelations = MaterialRequest & {
  department: Department;
  requestedBy: User;
  items: ItemWithMaterial[];
  approvalSteps: StepWithUser[];
  attachments: AttachmentMeta[];
  accountingRecord: AccountingRecordWithUser | null;
};

export function serializeItem(item: ItemWithMaterial): MaterialRequestItemView {
  // At most one per item today — the WAREHOUSE_CHECK step can only be
  // decided once — but take the latest if that ever changes.
  const check = item.warehouseCheckItems[item.warehouseCheckItems.length - 1];
  return {
    id: item.id,
    lineNo: item.lineNo,
    materialId: item.materialId,
    // manualMaterialName is a snapshot of the name as it was at the moment
    // of ordering (see app/api/requests/route.ts and
    // resubmitDepartmentReturn) -- preferred over the live catalog join so
    // a later rename of the material can't rewrite what an old request
    // appears to have been for. Rows created before this snapshot existed
    // fall back to the live name.
    materialName: item.manualMaterialName ?? item.material?.name ?? "—",
    warehouseBalance: item.warehouseBalanceAtRequest === null ? null : dec(item.warehouseBalanceAtRequest),
    unit: item.unit,
    requestedQuantity: dec(item.requestedQuantity),
    unitPrice: decOrNull(item.unitPrice),
    totalPrice: decOrNull(item.totalPrice),
    note: item.note ?? undefined,
    allocatedQuantity: check ? dec(check.allocatedQuantity) : undefined,
    missingQuantity: check ? dec(check.missingQuantity) : undefined,
  };
}

export function serializeAttachment(attachment: AttachmentMeta): AttachmentView {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    uploadedAt: attachment.uploadedAt.toISOString(),
    uploadedById: attachment.uploadedById,
  };
}

export function serializeStep(step: StepWithUser): ApprovalStepView {
  // Latest action on this step — the electronic-approval record (actor,
  // role, decision, server timestamp, document hash) backing the
  // signature block. A resubmitted-then-redecided step naturally has more
  // than one action over time; only the most recent one reflects the
  // step's current decision.
  const latestAction = step.actions[0];
  return {
    type: step.type,
    status: step.status,
    assignedUserId: step.assignedUserId,
    assignedUserName: step.assignedUser?.name ?? "—",
    decidedAt: step.decidedAt?.toISOString(),
    comment: step.comment ?? undefined,
    decidedByRole: latestAction ? latestAction.actor.role : undefined,
    documentHash: latestAction?.documentHash ?? undefined,
  };
}

export function serializeAccountingRecord(record: AccountingRecordWithUser): AccountingRecordView {
  return {
    ledgerNumber: record.ledgerNumber,
    recordDate: record.recordDate.toISOString(),
    note: record.note ?? undefined,
    recordedByName: record.recordedBy.name,
    recordedAt: record.recordedAt.toISOString(),
  };
}

const STEP_ORDER = [
  "DEPARTMENT_HEAD",
  "WAREHOUSE_CHECK",
  "BRANCH_APPROVAL",
  "FINANCE_APPROVAL",
  "EXECUTIVE_APPROVAL",
  "ACCOUNTING_RECORD",
];

export function serializeRequest(request: RequestWithRelations): MaterialRequestView {
  const items = request.items.sort((a, b) => a.lineNo - b.lineNo).map(serializeItem);
  const approvalSteps = [...request.approvalSteps]
    .sort((a, b) => STEP_ORDER.indexOf(a.type) - STEP_ORDER.indexOf(b.type))
    .map(serializeStep);

  return {
    id: request.id,
    requestNumber: request.requestNumber,
    createdAt: request.createdAt.toISOString(),
    completedAt: request.completedAt?.toISOString(),
    department: request.department.name,
    departmentId: request.departmentId,
    departmentType: request.department.type,
    requestedById: request.requestedById,
    requestedBy: request.requestedBy.name,
    status: request.status,
    version: request.version,
    note: request.note ?? undefined,
    totalAmount: items.some((i) => i.totalPrice === null)
      ? null
      : items.reduce((sum, i) => sum + (i.totalPrice as number), 0),
    itemCount: items.length,
    items,
    approvalSteps,
    attachments: [...request.attachments]
      .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())
      .map(serializeAttachment),
    accountingRecord: request.accountingRecord ? serializeAccountingRecord(request.accountingRecord) : undefined,
  };
}

export const requestInclude = {
  department: true,
  requestedBy: true,
  items: { include: { material: true, warehouseCheckItems: true } },
  approvalSteps: { include: { assignedUser: true, actions: { include: { actor: true }, orderBy: { createdAt: "desc" as const }, take: 1 } } },
  attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true, uploadedById: true } },
  accountingRecord: { include: { recordedBy: true } },
} as const;
