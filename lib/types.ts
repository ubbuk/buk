// Shared view-model types for the procurement UI. These mirror the Prisma
// enums in prisma/schema.prisma so Phase 2 screens can be built against a
// stable shape before the API layer (Phase 3) replaces the mock data in
// lib/mock-data.ts with real fetches.

export type RequestRoute = "OFFICE" | "FACTORY";

export type RequestStatus =
  | "DRAFT"
  | "PENDING_DEPARTMENT_APPROVAL"
  | "RETURNED_BY_DEPARTMENT"
  | "PENDING_WAREHOUSE_CHECK"
  | "PENDING_ROUTE_APPROVAL"
  | "RETURNED_BY_ROUTE_APPROVER"
  | "PENDING_DIRECTOR_APPROVAL"
  | "RETURNED_BY_DIRECTOR"
  | "FULFILLMENT_IN_PROGRESS"
  | "PARTIALLY_COMPLETED"
  | "COMPLETED"
  | "CANCELLED";

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  DRAFT: "Ноорог",
  PENDING_DEPARTMENT_APPROVAL: "Цехийн даргын баталгаа хүлээж байна",
  RETURNED_BY_DEPARTMENT: "Цехийн дарга буцаасан",
  PENDING_WAREHOUSE_CHECK: "Агуулахын шалгалт хүлээж байна",
  PENDING_ROUTE_APPROVAL: "Хариуцсан удирдлагын баталгаа хүлээж байна",
  RETURNED_BY_ROUTE_APPROVER: "Удирдлага буцаасан",
  PENDING_DIRECTOR_APPROVAL: "Захирлын баталгаа хүлээж байна",
  RETURNED_BY_DIRECTOR: "Захирал буцаасан",
  FULFILLMENT_IN_PROGRESS: "Гүйцэтгэл хийгдэж байна",
  PARTIALLY_COMPLETED: "Хэсэгчлэн дууссан",
  COMPLETED: "Дууссан",
  CANCELLED: "Цуцалсан",
};

export const REQUEST_STATUS_TONE: Record<
  RequestStatus,
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  DRAFT: "neutral",
  PENDING_DEPARTMENT_APPROVAL: "accent",
  RETURNED_BY_DEPARTMENT: "danger",
  PENDING_WAREHOUSE_CHECK: "accent",
  PENDING_ROUTE_APPROVAL: "accent",
  RETURNED_BY_ROUTE_APPROVER: "danger",
  PENDING_DIRECTOR_APPROVAL: "accent",
  RETURNED_BY_DIRECTOR: "danger",
  FULFILLMENT_IN_PROGRESS: "warning",
  PARTIALLY_COMPLETED: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

export type ApprovalStepType =
  | "DEPARTMENT_HEAD"
  | "WAREHOUSE_CHECK"
  | "ROUTE_APPROVAL"
  | "DIRECTOR_APPROVAL";

export const APPROVAL_STEP_LABEL: Record<ApprovalStepType, string> = {
  DEPARTMENT_HEAD: "Цехийн дарга",
  WAREHOUSE_CHECK: "Нярав",
  ROUTE_APPROVAL: "Үйлдвэр/Оффис",
  DIRECTOR_APPROVAL: "Захирал",
};

export type ApprovalStepStatus = "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";

export interface MaterialRequestItemView {
  id: string;
  lineNo: number;
  materialName: string;
  warehouseBalance: number | null;
  unit: string;
  requestedQuantity: number;
  unitPrice: number;
  totalPrice: number;
  note?: string;
  allocatedQuantity?: number;
  missingQuantity?: number;
}

export interface ApprovalStepView {
  type: ApprovalStepType;
  status: ApprovalStepStatus;
  assignedUserName: string;
  decidedAt?: string;
  comment?: string;
}

export interface MaterialRequestView {
  id: string;
  requestNumber: string;
  createdAt: string;
  department: string;
  requestedBy: string;
  route: RequestRoute;
  status: RequestStatus;
  totalAmount: number;
  itemCount: number;
  items: MaterialRequestItemView[];
  approvalSteps: ApprovalStepView[];
}

export const PURCHASE_STATUS_LABEL: Record<string, string> = {
  PENDING_ROUTE_APPROVAL: "Удирдлагын баталгаа хүлээж байна",
  PENDING_DIRECTOR_APPROVAL: "Захирлын баталгаа хүлээж байна",
  APPROVED: "Баталсан",
  IN_PROCUREMENT: "Худалдан авалтад",
  FULFILLED: "Хүлээн авсан",
};

export const RECEIVING_STATUS_LABEL: Record<string, string> = {
  NOT_ORDERED: "Захиалаагүй",
  ORDERED: "Захиалсан",
  PARTIALLY_RECEIVED: "Хэсэгчлэн ирсэн",
  RECEIVED: "Бүрэн ирсэн",
};

export interface MaterialCatalogEntry {
  id: string;
  code: string;
  name: string;
  unit: string;
  warehouseBalance: number;
  defaultPrice: number;
}
