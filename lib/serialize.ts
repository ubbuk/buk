import type {
  ApprovalStep,
  Department,
  Material,
  MaterialRequest,
  MaterialRequestItem,
  User,
} from "@prisma/client";
import type {
  ApprovalStepView,
  MaterialRequestItemView,
  MaterialRequestView,
} from "./types";

function dec(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

type ItemWithMaterial = MaterialRequestItem & { material: Material | null };
type StepWithUser = ApprovalStep & { assignedUser: User | null };
type RequestWithRelations = MaterialRequest & {
  department: Department;
  requestedBy: User;
  items: ItemWithMaterial[];
  approvalSteps: StepWithUser[];
};

export function serializeItem(item: ItemWithMaterial): MaterialRequestItemView {
  return {
    id: item.id,
    lineNo: item.lineNo,
    materialName: item.material?.name ?? item.manualMaterialName ?? "—",
    warehouseBalance: item.warehouseBalanceAtRequest === null ? null : dec(item.warehouseBalanceAtRequest),
    unit: item.unit,
    requestedQuantity: dec(item.requestedQuantity),
    unitPrice: dec(item.unitPrice),
    totalPrice: dec(item.totalPrice),
    note: item.note ?? undefined,
  };
}

export function serializeStep(step: StepWithUser): ApprovalStepView {
  return {
    type: step.type,
    status: step.status,
    assignedUserName: step.assignedUser?.name ?? "—",
    decidedAt: step.decidedAt?.toISOString(),
    comment: step.comment ?? undefined,
  };
}

export function serializeRequest(request: RequestWithRelations): MaterialRequestView {
  const items = request.items.sort((a, b) => a.lineNo - b.lineNo).map(serializeItem);
  const stepOrder = ["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "ROUTE_APPROVAL", "DIRECTOR_APPROVAL"];
  const approvalSteps = [...request.approvalSteps]
    .sort((a, b) => stepOrder.indexOf(a.type) - stepOrder.indexOf(b.type))
    .map(serializeStep);

  return {
    id: request.id,
    requestNumber: request.requestNumber,
    createdAt: request.createdAt.toISOString(),
    completedAt: request.completedAt?.toISOString(),
    department: request.department.name,
    requestedBy: request.requestedBy.name,
    route: request.route,
    status: request.status,
    totalAmount: items.reduce((sum, i) => sum + i.totalPrice, 0),
    itemCount: items.length,
    items,
    approvalSteps,
  };
}

export const requestInclude = {
  department: true,
  requestedBy: true,
  items: { include: { material: true } },
  approvalSteps: { include: { assignedUser: true } },
} as const;
