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

// Structural on purpose: serializeRequest only reads these fields, so the list endpoint can load
// exactly them (requestListSelect) while the detail/workflow paths keep passing full rows.
type ItemWithMaterial = Pick<
  MaterialRequestItem,
  "id" | "lineNo" | "materialId" | "manualMaterialName" | "warehouseBalanceAtRequest" | "unit" | "requestedQuantity" | "unitPrice" | "totalPrice" | "note"
> & {
  material: Pick<Material, "name"> | null;
  warehouseCheckItems: Pick<WarehouseCheckItem, "allocatedQuantity" | "missingQuantity">[];
};
type StepWithUser = Pick<ApprovalStep, "type" | "status" | "assignedUserId" | "decidedAt" | "comment"> & {
  assignedUser: Pick<User, "name"> | null;
  actions: (Pick<ApprovalAction, "documentHash"> & { actor: Pick<User, "role"> })[];
};
type AccountingRecordWithUser = Pick<AccountingRecord, "ledgerNumber" | "recordDate" | "note" | "recordedAt"> & { recordedBy: Pick<User, "name"> };
// storageKey is deliberately left out of requestInclude's attachment
// select below -- the client never needs it, every download goes through
// the authenticated route instead.
type AttachmentMeta = Pick<Attachment, "id" | "fileName" | "mimeType" | "sizeBytes" | "uploadedAt" | "uploadedById">;
type RequestWithRelations = Pick<
  MaterialRequest,
  "id" | "requestNumber" | "createdAt" | "completedAt" | "departmentId" | "requestedById" | "status" | "version" | "note"
> & {
  department: Pick<Department, "name" | "type" | "headId">;
  requestedBy: Pick<User, "name">;
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

// The workflow's effective order. Stored `sequence` is NOT authoritative for it: a request created
// before the procurement stage existed has ACCOUNTING_RECORD at 6 and gets MANAGER_PROCUREMENT
// appended at 7 when the CEO approves (existing rows are never renumbered). Anything that has to
// know "which step comes first" must go by type through this list.
export const STEP_ORDER = [
  "DEPARTMENT_HEAD",
  "WAREHOUSE_CHECK",
  "BRANCH_APPROVAL",
  "FINANCE_APPROVAL",
  "EXECUTIVE_APPROVAL",
  "MANAGER_PROCUREMENT",
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
    departmentHeadId: request.department.headId,
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

// What GET /api/requests loads: the fields serializeRequest reads plus those isRequestHiddenFrom needs
// (decidedById) -- not whole User/Material/Department rows (passwordHash, prices, ...) per step and item.
export const requestListSelect = {
  id: true,
  requestNumber: true,
  createdAt: true,
  completedAt: true,
  departmentId: true,
  requestedById: true,
  status: true,
  version: true,
  note: true,
  department: { select: { name: true, type: true, headId: true } },
  requestedBy: { select: { name: true } },
  items: {
    select: {
      id: true,
      lineNo: true,
      materialId: true,
      manualMaterialName: true,
      warehouseBalanceAtRequest: true,
      unit: true,
      requestedQuantity: true,
      unitPrice: true,
      totalPrice: true,
      note: true,
      material: { select: { name: true } },
      warehouseCheckItems: { select: { allocatedQuantity: true, missingQuantity: true } },
    },
  },
  approvalSteps: {
    select: {
      type: true,
      status: true,
      assignedUserId: true,
      decidedById: true,
      decidedAt: true,
      comment: true,
      assignedUser: { select: { name: true } },
      actions: { select: { documentHash: true, actor: { select: { role: true } } }, orderBy: { createdAt: "desc" as const }, take: 1 },
    },
  },
  attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true, uploadedById: true } },
  accountingRecord: { select: { ledgerNumber: true, recordDate: true, note: true, recordedAt: true, recordedBy: { select: { name: true } } } },
} as const;
