// ---------------------------------------------------------------------------
// DEMO DATA — Phase 2 UI only.
//
// None of the values below come from a database; the backend (Prisma +
// API routes) lands in Phase 3. Every screen that reads from this file
// renders a small "Жишээ өгөгдөл" (demo data) badge so nobody mistakes it
// for live production numbers.
// ---------------------------------------------------------------------------

// Requests now come from the database (GET /api/requests) via lib/store.ts;
// this file only still holds illustrative data for screens not yet wired up
// (reports, procurement queue) plus the live activity log's initial state.

// Real actions (submit, approve, return) push their own entries here via
// lib/store.ts's pushActivity — starts empty rather than fake history.
export const DEMO_ACTIVITY: { id: string; time: string; text: string; type: "create" | "approve" | "reject" | "info" }[] = [];

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
    text: "Подшипник 6205 — агуулахад 4ш үлдсэн, захиалга хүрэлцэхгүй байж болзошгүй",
    severity: "warning" as const,
    materialId: "m-brg6205",
  },
  {
    id: "al2",
    text: "Гагнуурын баллон (CO2) — нөөц 2ш, доод хязгаараас доогуур",
    severity: "danger" as const,
    materialId: "m-co2",
  },
];
