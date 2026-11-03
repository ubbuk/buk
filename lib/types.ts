// Shared view-model types for the procurement UI. These mirror the Prisma
// enums in prisma/schema.prisma so screens can be built against a stable
// shape, matching what the API layer actually serializes.

export type DepartmentType = "OFFICE" | "FACTORY";

export type RequestStatus =
  | "DRAFT"
  | "PENDING_DEPARTMENT_APPROVAL"
  | "RETURNED_BY_DEPARTMENT"
  | "PENDING_WAREHOUSE_CHECK"
  | "PENDING_BRANCH_APPROVAL"
  | "RETURNED_BY_BRANCH_APPROVER"
  | "PENDING_FINANCE_APPROVAL"
  | "RETURNED_BY_FINANCE"
  | "PENDING_EXECUTIVE_APPROVAL"
  | "RETURNED_BY_EXECUTIVE"
  | "PENDING_ACCOUNTING"
  | "ACCOUNTING_COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "COMPLETED"
  | "CANCELLED";

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  DRAFT: "Ноорог",
  PENDING_DEPARTMENT_APPROVAL: "Цехийн даргын баталгаа хүлээж байна",
  RETURNED_BY_DEPARTMENT: "Цехийн дарга буцаасан",
  PENDING_WAREHOUSE_CHECK: "Агуулахын шалгалт хүлээж байна",
  PENDING_BRANCH_APPROVAL: "Инженер/Үйл ажиллагааны захирлын баталгаа хүлээж байна",
  RETURNED_BY_BRANCH_APPROVER: "Инженер/Үйл ажиллагааны захирал буцаасан",
  PENDING_FINANCE_APPROVAL: "Санхүү эрхэлсэн захирлын баталгаа хүлээж байна",
  RETURNED_BY_FINANCE: "Санхүү эрхэлсэн захирал буцаасан",
  PENDING_EXECUTIVE_APPROVAL: "Гүйцэтгэх захирлын баталгаа хүлээж байна",
  RETURNED_BY_EXECUTIVE: "Гүйцэтгэх захирал буцаасан",
  PENDING_ACCOUNTING: "Санхүүгийн бүртгэл хүлээж байна",
  ACCOUNTING_COMPLETED: "Санхүүгийн бүртгэл хийгдсэн",
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
  PENDING_BRANCH_APPROVAL: "accent",
  RETURNED_BY_BRANCH_APPROVER: "danger",
  PENDING_FINANCE_APPROVAL: "accent",
  RETURNED_BY_FINANCE: "danger",
  PENDING_EXECUTIVE_APPROVAL: "accent",
  RETURNED_BY_EXECUTIVE: "danger",
  PENDING_ACCOUNTING: "warning",
  ACCOUNTING_COMPLETED: "success",
  PARTIALLY_COMPLETED: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

export type ApprovalStepType =
  | "DEPARTMENT_HEAD"
  | "WAREHOUSE_CHECK"
  | "BRANCH_APPROVAL"
  | "FINANCE_APPROVAL"
  | "EXECUTIVE_APPROVAL"
  | "ACCOUNTING_RECORD";

export const APPROVAL_STEP_LABEL: Record<ApprovalStepType, string> = {
  DEPARTMENT_HEAD: "Цехийн дарга",
  WAREHOUSE_CHECK: "Нярав",
  BRANCH_APPROVAL: "Инженер / Үйл ажиллагаа эрхэлсэн захирал",
  FINANCE_APPROVAL: "Санхүү эрхэлсэн захирал",
  EXECUTIVE_APPROVAL: "Гүйцэтгэх захирал",
  ACCOUNTING_RECORD: "Ерөнхий нягтлан бодогч",
};

export type ApprovalStepStatus = "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";

export interface MaterialRequestItemView {
  id: string;
  lineNo: number;
  materialId: string | null;
  materialName: string;
  warehouseBalance: number | null;
  unit: string;
  requestedQuantity: number;
  unitPrice: number | null;
  totalPrice: number | null;
  note?: string;
  allocatedQuantity?: number;
  missingQuantity?: number;
}

export interface AttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedById: string;
}

export interface ApprovalStepView {
  type: ApprovalStepType;
  status: ApprovalStepStatus;
  assignedUserId: string | null;
  assignedUserName: string;
  decidedAt?: string;
  comment?: string;
  decidedByRole?: string;
  documentHash?: string;
}

export interface AccountingRecordView {
  ledgerNumber: string;
  recordDate: string;
  note?: string;
  recordedByName: string;
  recordedAt: string;
}

export interface MaterialRequestView {
  id: string;
  requestNumber: string;
  createdAt: string;
  completedAt?: string;
  department: string;
  departmentId: string;
  departmentType: DepartmentType;
  requestedById: string;
  requestedBy: string;
  status: RequestStatus;
  version: number;
  note?: string;
  // null when at least one item has no price yet — the real total is
  // indeterminate, not zero, until every item is priced.
  totalAmount: number | null;
  itemCount: number;
  items: MaterialRequestItemView[];
  approvalSteps: ApprovalStepView[];
  attachments: AttachmentView[];
  accountingRecord?: AccountingRecordView;
}

// The closed 8-role list from the spec. `as const` so this doubles as a
// zod `z.enum(USER_ROLES)` tuple wherever role input is validated.
export const USER_ROLES = [
  "ADMIN",
  "DIRECTOR",
  "BOSS",
  "MANAGER",
  "STOREKEEPER",
  "EMPLOYEE",
  "ENGINEERING",
  "CHIEF_ACCOUNTANT",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

// Role names are displayed in English Title Case everywhere (spec: "all
// labels Mongolian except role names") — every other surrounding label
// stays Mongolian.
export const USER_ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  DIRECTOR: "Director",
  BOSS: "Boss",
  MANAGER: "Manager",
  STOREKEEPER: "Storekeeper",
  EMPLOYEE: "Employee",
  ENGINEERING: "Engineering",
  CHIEF_ACCOUNTANT: "Chief Accountant",
};

// Roles that can hold an approval step (PIN-gated stages: department/boss,
// warehouse-check, branch, finance, executive). CHIEF_ACCOUNTANT holds the
// terminal recording step but it is NOT PIN-gated (data entry, not a
// decision) — see lib/pin.ts call sites. MANAGER has no approve/return
// authority at all.
export const APPROVER_ROLES: UserRole[] = ["BOSS", "STOREKEEPER", "DIRECTOR", "ENGINEERING", "CHIEF_ACCOUNTANT"];

// Mongolian permission bullets shown in the admin UI when a role is
// selected (spec §9: "show a permission summary when ADMIN selects a role").
export const ROLE_PERMISSION_SUMMARY: Record<UserRole, string[]> = {
  ADMIN: [
    "Хэрэглэгч үүсгэх, засах",
    "Эрх (role), албан тушаал, цех/тасаг хуваарилах",
    "Бүртгэл идэвхжүүлэх/түдгэлзүүлэх, нэвтрэх мэдээлэл/PIN шинэчлэх",
    "Баталгаажуулах албан тушаалын хуваарилалт удирдах",
    "Системийн audit log харах",
  ],
  EMPLOYEE: [
    "Материалын хэрэгцээний хүсэлт үүсгэх",
    "Материал нэмэх, тоо хэмжээ, (сайн дурын) үнэ оруулах",
    "Хүсэлтээ илгээх, өөрийн хүсэлтүүдийг харах",
    "Буцаагдсан хүсэлтээ засаж дахин илгээх",
  ],
  DIRECTOR: [
    "Хуваарилагдсан албан тушаалын шатанд ирсэн хүсэлтийг хянах",
    "Батлах (PIN код шаардлагатай) эсвэл шалтгаантай буцаах",
    "Баталгаажуулалтын түүх харах",
  ],
  BOSS: [
    "Цехийн хүсэлтийг хянах, батлах (PIN код шаардлагатай) эсвэл буцаах",
    "Буцаахдаа шалтгаан бичих шаардлагатай",
    "Өөрийн цехийн нэрээр хүсэлт үүсгэх боломжтой",
  ],
  MANAGER: [
    "Хуваарилагдсан хүсэлтийн материалын мэдээллийг хянах",
    "Санал болгох үнийг оруулах/засах (audit trail-д хадгалагдана)",
    "Эцсийн баталгаа эсвэл буцаах эрхгүй",
  ],
  STOREKEEPER: [
    "Агуулахын үлдэгдэл харах",
    "Материал бүрэн/хэсэгчлэн/огт байхгүйг тогтоох (PIN код шаардлагатай)",
    "Олгосон тоо хэмжээг бүртгэх, дутууг дараагийн шат руу шилжүүлэх",
  ],
  ENGINEERING: [
    "Үйлдвэрийн (FACTORY) чиглэлийн хүсэлтийг хянах",
    "Батлах (PIN код шаардлагатай) эсвэл шалтгаантай буцаах",
  ],
  CHIEF_ACCOUNTANT: [
    "Эцсийн баталгаажсан хүсэлтийг хүлээн авах",
    "Санхүүгийн бүртгэлийн дугаар, огноо, тайлбар оруулах",
    "Батлахгүй, татгалзахгүй — зөвхөн бүртгэл хийж шилжүүлнэ",
  ],
};

export interface MaterialCatalogEntry {
  id: string;
  code: string;
  name: string;
  unit: string;
  warehouseBalance: number;
  defaultPrice: number;
}
