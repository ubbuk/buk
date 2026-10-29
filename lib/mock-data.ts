// ---------------------------------------------------------------------------
// DEMO DATA — Phase 2 UI only.
//
// None of the values below come from a database; the backend (Prisma +
// API routes) lands in Phase 3. Every screen that reads from this file
// renders a small "Жишээ өгөгдөл" (demo data) badge so nobody mistakes it
// for live production numbers.
// ---------------------------------------------------------------------------

import type { MaterialCatalogEntry, MaterialRequestView } from "./types";

export const DEMO_MATERIALS: MaterialCatalogEntry[] = [
  { id: "m1", code: "CEM-500", name: "Цемент М-500", unit: "тн", warehouseBalance: 12.4, defaultPrice: 420000 },
  { id: "m2", code: "REB-12", name: "Арматур ∅12", unit: "м", warehouseBalance: 850, defaultPrice: 9800 },
  { id: "m3", code: "REB-16", name: "Арматур ∅16", unit: "м", warehouseBalance: 120, defaultPrice: 15600 },
  { id: "m4", code: "SND-WSH", name: "Элс угаасан", unit: "м³", warehouseBalance: 34, defaultPrice: 48000 },
  { id: "m5", code: "GRV-20", name: "Хайрга 5-20мм", unit: "м³", warehouseBalance: 18.5, defaultPrice: 52000 },
  { id: "m6", code: "WLD-ROD", name: "Гагнуурын утас", unit: "кг", warehouseBalance: 64, defaultPrice: 12500 },
  { id: "m7", code: "FRM-OIL", name: "Хашлагын тос", unit: "л", warehouseBalance: 6, defaultPrice: 8900 },
  { id: "m8", code: "STL-SHT4", name: "Ган хуудас 4мм", unit: "хуудас", warehouseBalance: 9, defaultPrice: 310000 },
  { id: "m9", code: "WIRE-1.2", name: "Холбох утас ∅1.2", unit: "кг", warehouseBalance: 210, defaultPrice: 6200 },
  { id: "m10", code: "GLV-BND", name: "Гагнуурын баллон (CO2)", unit: "ш", warehouseBalance: 2, defaultPrice: 185000 },
];

export const DEMO_KPIS = {
  totalRequests: 128,
  pendingApproval: 14,
  warehouseCheck: 6,
  needsProcurement: 9,
  completed: 92,
  overdue: 3,
};

export const DEMO_REQUESTS: MaterialRequestView[] = [
  {
    id: "r1371",
    requestNumber: "2026-1371",
    createdAt: "2026-10-27T09:12:00+08:00",
    department: "Бетон цех",
    requestedBy: "Б.Төмөрбаатар",
    route: "FACTORY",
    status: "PENDING_WAREHOUSE_CHECK",
    totalAmount: 6_420_000,
    itemCount: 4,
    items: [
      { id: "i1", lineNo: 1, materialName: "Цемент М-500", warehouseBalance: 12.4, unit: "тн", requestedQuantity: 8, unitPrice: 420000, totalPrice: 3_360_000 },
      { id: "i2", lineNo: 2, materialName: "Элс угаасан", warehouseBalance: 34, unit: "м³", requestedQuantity: 20, unitPrice: 48000, totalPrice: 960_000 },
      { id: "i3", lineNo: 3, materialName: "Хайрга 5-20мм", warehouseBalance: 18.5, unit: "м³", requestedQuantity: 15, unitPrice: 52000, totalPrice: 780_000 },
      { id: "i4", lineNo: 4, materialName: "Арматур ∅12", warehouseBalance: 850, unit: "м", requestedQuantity: 130, unitPrice: 9800, totalPrice: 1_274_000 },
    ],
    approvalSteps: [
      { type: "DEPARTMENT_HEAD", status: "APPROVED", assignedUserName: "Ц.Болд", decidedAt: "2026-10-27T10:05:00+08:00" },
      { type: "WAREHOUSE_CHECK", status: "PENDING", assignedUserName: "Хангамжийн нярав" },
      { type: "ROUTE_APPROVAL", status: "PENDING", assignedUserName: "Б.Нармандах" },
      { type: "DIRECTOR_APPROVAL", status: "PENDING", assignedUserName: "Хамхоев Магомед" },
    ],
  },
  {
    id: "r1336",
    requestNumber: "2026-1336",
    createdAt: "2026-10-24T14:40:00+08:00",
    department: "Механик засвар",
    requestedBy: "Д.Ганбат",
    route: "FACTORY",
    status: "PENDING_DIRECTOR_APPROVAL",
    totalAmount: 1_295_000,
    itemCount: 2,
    items: [
      { id: "i5", lineNo: 1, materialName: "Гагнуурын утас", warehouseBalance: 64, unit: "кг", requestedQuantity: 40, unitPrice: 12500, totalPrice: 500_000, allocatedQuantity: 40, missingQuantity: 0 },
      { id: "i6", lineNo: 2, materialName: "Ган хуудас 4мм", warehouseBalance: 9, unit: "хуудас", requestedQuantity: 11, unitPrice: 310000, totalPrice: 3_410_000, allocatedQuantity: 9, missingQuantity: 2 },
    ],
    approvalSteps: [
      { type: "DEPARTMENT_HEAD", status: "APPROVED", assignedUserName: "Н.Эрдэнэ", decidedAt: "2026-10-24T15:02:00+08:00" },
      { type: "WAREHOUSE_CHECK", status: "APPROVED", assignedUserName: "Г.Сарнай", decidedAt: "2026-10-25T08:30:00+08:00" },
      { type: "ROUTE_APPROVAL", status: "APPROVED", assignedUserName: "Б.Нармандах", decidedAt: "2026-10-25T11:15:00+08:00" },
      { type: "DIRECTOR_APPROVAL", status: "PENDING", assignedUserName: "Хамхоев Магомед" },
    ],
  },
  {
    id: "r1298",
    requestNumber: "2026-1298",
    createdAt: "2026-10-20T08:55:00+08:00",
    department: "Санхүү, аж ахуй",
    requestedBy: "О.Мөнхзул",
    route: "OFFICE",
    status: "RETURNED_BY_DEPARTMENT",
    totalAmount: 312_000,
    itemCount: 1,
    items: [
      { id: "i7", lineNo: 1, materialName: "Гагнуурын баллон (CO2)", warehouseBalance: 2, unit: "ш", requestedQuantity: 3, unitPrice: 185000, totalPrice: 555_000 },
    ],
    approvalSteps: [
      { type: "DEPARTMENT_HEAD", status: "REJECTED", assignedUserName: "Н.Хүнцэнгэл", decidedAt: "2026-10-20T13:10:00+08:00", comment: "Тоо хэмжээг тодруулж дахин илгээнэ үү." },
      { type: "WAREHOUSE_CHECK", status: "SKIPPED", assignedUserName: "Хангамжийн нярав" },
      { type: "ROUTE_APPROVAL", status: "SKIPPED", assignedUserName: "Н.Хүнцэнгэл" },
      { type: "DIRECTOR_APPROVAL", status: "SKIPPED", assignedUserName: "Хамхоев Магомед" },
    ],
  },
  {
    id: "r1260",
    requestNumber: "2026-1260",
    createdAt: "2026-10-14T10:00:00+08:00",
    department: "Бетон цех",
    requestedBy: "Б.Төмөрбаатар",
    route: "FACTORY",
    status: "COMPLETED",
    totalAmount: 2_150_000,
    itemCount: 3,
    items: [
      { id: "i8", lineNo: 1, materialName: "Цемент М-500", warehouseBalance: 12.4, unit: "тн", requestedQuantity: 5, unitPrice: 420000, totalPrice: 2_100_000, allocatedQuantity: 5, missingQuantity: 0 },
    ],
    approvalSteps: [
      { type: "DEPARTMENT_HEAD", status: "APPROVED", assignedUserName: "Ц.Болд", decidedAt: "2026-10-14T11:00:00+08:00" },
      { type: "WAREHOUSE_CHECK", status: "APPROVED", assignedUserName: "Г.Сарнай", decidedAt: "2026-10-14T13:30:00+08:00" },
      { type: "ROUTE_APPROVAL", status: "APPROVED", assignedUserName: "Б.Нармандах", decidedAt: "2026-10-15T09:00:00+08:00" },
      { type: "DIRECTOR_APPROVAL", status: "APPROVED", assignedUserName: "Хамхоев Магомед", decidedAt: "2026-10-15T14:20:00+08:00" },
    ],
  },
];

export const DEMO_ACTIVITY = [
  { id: "a1", time: "09:12", text: "Б.Төмөрбаатар №2026-1371 захиалга үүсгэв", type: "create" as const },
  { id: "a2", time: "10:05", text: "Ц.Болд №2026-1371 захиалгыг баталлаа", type: "approve" as const },
  { id: "a3", time: "11:15", text: "Б.Нармандах №2026-1336 захиалгыг баталлаа", type: "approve" as const },
  { id: "a4", time: "13:10", text: "Н.Хүнцэнгэл №2026-1298 захиалгыг буцаалаа", type: "reject" as const },
  { id: "a5", time: "14:20", text: "Хамхоев М. №2026-1260 захиалгыг эцэслэн баталлаа", type: "approve" as const },
];

export const DEMO_DEPARTMENT_SPEND = [
  { department: "Бетон цех", amount: 18_950_000 },
  { department: "Механик засвар", amount: 9_480_000 },
  { department: "Металл хийцийн цех", amount: 7_120_000 },
  { department: "Санхүү, аж ахуй", amount: 2_340_000 },
  { department: "Удирдлага, захиргаа", amount: 980_000 },
];

export const DEMO_STATUS_BREAKDOWN = [
  { label: "Дууссан", count: 92, tone: "success" as const },
  { label: "Батлах хүлээлттэй", count: 14, tone: "accent" as const },
  { label: "Гүйцэтгэл хийгдэж байна", count: 9, tone: "warning" as const },
  { label: "Буцаасан", count: 8, tone: "danger" as const },
  { label: "Цуцалсан", count: 5, tone: "neutral" as const },
];

export interface PurchaseQueueEntry {
  id: string;
  requestNumber: string;
  materialName: string;
  quantity: number;
  unit: string;
  supplier: string | null;
  estimatedPrice: number;
  actualPrice: number | null;
  status: "PENDING_ROUTE_APPROVAL" | "PENDING_DIRECTOR_APPROVAL" | "APPROVED" | "IN_PROCUREMENT" | "FULFILLED";
  expectedDelivery: string | null;
  receivingStatus: "NOT_ORDERED" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED";
}

export const DEMO_PURCHASE_QUEUE: PurchaseQueueEntry[] = [
  {
    id: "pq1",
    requestNumber: "2026-1336",
    materialName: "Ган хуудас 4мм",
    quantity: 2,
    unit: "хуудас",
    supplier: "Эрдэнэт Строй Материалс ХХК",
    estimatedPrice: 320000,
    actualPrice: null,
    status: "PENDING_DIRECTOR_APPROVAL",
    expectedDelivery: null,
    receivingStatus: "NOT_ORDERED",
  },
  {
    id: "pq2",
    requestNumber: "2026-1298",
    materialName: "Гагнуурын баллон (CO2)",
    quantity: 1,
    unit: "ш",
    supplier: "Моннекс ХХК",
    estimatedPrice: 190000,
    actualPrice: 188000,
    status: "IN_PROCUREMENT",
    expectedDelivery: "2026-11-03",
    receivingStatus: "ORDERED",
  },
  {
    id: "pq3",
    requestNumber: "2026-1211",
    materialName: "Арматур ∅16",
    quantity: 60,
    unit: "м",
    supplier: "Дархан Төмөрлөг ХХК",
    estimatedPrice: 15600,
    actualPrice: 15200,
    status: "FULFILLED",
    expectedDelivery: "2026-10-18",
    receivingStatus: "RECEIVED",
  },
];

export const DEMO_URGENT_ALERTS = [
  {
    id: "al1",
    text: "Ган хуудас 4мм — агуулахад 9ш үлдсэн, 2 захиалга хүлээгдэж байна",
    severity: "warning" as const,
    materialId: "m8",
  },
  {
    id: "al2",
    text: "Гагнуурын баллон (CO2) — нөөц 2ш, доод хязгаараас доогуур",
    severity: "danger" as const,
    materialId: "m10",
  },
];
