// Response shapes of the procurement sections of /api/admin/monitoring/*.
// Dates are ISO strings (UTC); durations are whole seconds (null = a timestamp is missing).
import type { ItemStatus, ProcurementStage, UnitQuantity } from "./procurement-calc";
import type { Paged } from "./types";

export type TrackKind = "DOMESTIC" | "INTERNATIONAL";

export interface TrackKpi {
  /** requests holding at least one outstanding item of this track (a shared request counts once here) */
  requests: number;
  /** outstanding items (required > 0, not fully purchased) */
  items: number;
  /** remaining quantity per unit -- units are never merged */
  quantities: UnitQuantity[];
}

export interface ManagerLoad {
  userId: string;
  name: string;
  kind: TrackKind;
  isActive: boolean;
  requests: number;
  items: number;
  /** oldest assignment among the outstanding items (a handover resets it for moved items) */
  oldestAssignedAt: string | null;
  oldestSeconds: number | null;
  avgSeconds: number | null;
}

export interface OldestWork {
  requestId: string;
  requestNumber: string;
  enteredAt: string | null;
  ageSeconds: number | null;
  idleSeconds: number | null;
}

export interface ProcurementOverview {
  asOf: string;
  range: string;
  /** a monitoring filter chosen by the viewer -- there is no SLA configured anywhere in the system */
  thresholdHours: number;
  mode: "LEGACY" | "ASSIGNED";
  requests: {
    /** currently in PENDING_PROCUREMENT */
    awaitingProcurement: number;
    /** assigned mode only: no classification yet and something to buy */
    awaitingClassification: number;
    /** everything bought, the Manager has not completed the stage yet */
    readyToComplete: number;
    /** procurement stage completed within the selected range */
    completedInRange: number;
    /** procurement completed, request waiting for the Chief Accountant */
    awaitingAccounting: number;
    /** unfinished with no meaningful activity for >= thresholdHours */
    idleOverThreshold: number;
    /** in procurement but the CEO approval time is unknown (excluded from time statistics) */
    missingTimestamps: number;
  };
  items: {
    domesticOutstanding: number;
    internationalOutstanding: number;
    /** outstanding items without an assignment (awaiting classification, or legacy mode) */
    unassignedOutstanding: number;
    partiallyPurchased: number;
    /** items the warehouse covered completely (no purchase needed) */
    warehouseFulfilled: number;
  };
  domestic: TrackKpi;
  international: TrackKpi;
  partial: { requests: number; items: number };
  cost: {
    /** active (non-voided) purchases of requests still in procurement */
    openRequests: number;
    /** active purchases recorded within the range */
    inRange: number;
    purchasesInRange: number;
  };
  timing: {
    classification: {
      waitingRequests: number;
      avgWaitingSeconds: number | null;
      maxWaitingSeconds: number | null;
      classifiedInRange: number;
      avgClassifiedSeconds: number | null;
    };
    oldest: OldestWork | null;
    longestIdleSeconds: number | null;
  };
  managers: ManagerLoad[];
}

export interface MonitoredItem {
  itemId: string;
  lineNo: number;
  materialName: string;
  unit: string;
  requested: number;
  /** taken from stock by the warehouse (latest check) */
  warehouseIssued: number;
  /** what had to be bought: the latest check's shortfall (0 = nothing to buy) */
  required: number;
  purchased: number;
  outstanding: number;
  status: ItemStatus;
  kind: TrackKind | null;
  managerId: string | null;
  managerName: string | null;
  assignedAt: string | null;
  activePurchases: number;
  /** quantity-weighted cost of the active purchases */
  actualCost: number;
  estimatedUnitPrice: number | null;
  lastActivityAt: string | null;
}

export interface TrackSummary {
  kind: TrackKind;
  totalItems: number;
  outstandingItems: number;
  managers: string[];
  actualCost: number;
}

export interface ProcurementRow {
  requestId: string;
  requestNumber: string;
  requestStatus: string;
  department: string;
  requestedBy: string;
  stage: ProcurementStage;
  enteredAt: string | null;
  classifiedAt: string | null;
  completedAt: string | null;
  ageSeconds: number | null;
  idleSeconds: number | null;
  classificationWaitSeconds: number | null;
  lastActivityAt: string | null;
  requiredItems: number;
  completeItems: number;
  partialItems: number;
  partiallyPurchased: boolean;
  completionPercent: number | null;
  completionBasis: "value" | "items" | "none";
  domestic: TrackSummary | null;
  international: TrackSummary | null;
  unassignedOutstandingItems: number;
  actualCost: number;
  delayed: boolean;
  items: MonitoredItem[];
}

export interface ProcurementList extends Paged<ProcurementRow> {
  asOf: string;
  scope: ProcurementScope;
  thresholdHours: number;
  mode: "LEGACY" | "ASSIGNED";
}

export type ProcurementScope = "active" | "accounting" | "completed";
export type ProcurementFilter = "all" | "classification" | "domestic" | "international" | "partial" | "ready" | "delayed";

export interface MonitoredPurchase {
  id: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  total: number;
  purchasedAt: string;
  purchasedByName: string;
  voided: boolean;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  replacesId: string | null;
  note: string | null;
}

export interface TimelineEvent {
  id: string;
  at: string;
  action: string;
  actorName: string;
  summary: string | null;
}

export interface HandoverEvent {
  id: string;
  at: string;
  itemId: string;
  materialName: string;
  kind: TrackKind | null;
  fromManagerName: string | null;
  toManagerName: string | null;
  actorName: string;
  reason: string | null;
  /** present when moved by an ADMIN handover; absent for a controlled reassignment */
  handoverId: string | null;
}

export interface ProcurementDetail {
  asOf: string;
  row: ProcurementRow;
  classification: { confirmedByName: string; confirmedAt: string } | null;
  purchases: MonitoredPurchase[];
  timeline: TimelineEvent[];
  handovers: HandoverEvent[];
  timelineTruncated: boolean;
}
