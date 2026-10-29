// Shared reactive client-side state for the demo. Every screen that shows
// requests reads from this store instead of the frozen arrays in
// mock-data.ts, so an action taken on one screen (submit, approve, return,
// warehouse check) is immediately visible everywhere else in the same
// session — no page refresh, no backend required yet. This is real-time
// within the browser tab; cross-session/multi-user sync still needs the
// Phase 3 API.
import { create } from "zustand";
import { DEMO_ACTIVITY, DEMO_REQUESTS } from "./mock-data";
import { DEMO_APPROVERS, DEMO_DEPARTMENTS } from "./mock-session";
import type {
  ApprovalStepView,
  MaterialRequestItemView,
  MaterialRequestView,
  RequestRoute,
} from "./types";

export interface ActivityEntry {
  id: string;
  time: string;
  text: string;
  type: "create" | "approve" | "reject" | "info";
}

interface NewRequestItemInput {
  materialName: string;
  unit: string;
  requestedQuantity: number;
  unitPrice: number;
  warehouseBalance: number | null;
  note?: string;
}

interface CreateRequestInput {
  departmentId: string;
  route: RequestRoute;
  requestedBy: string;
  items: NewRequestItemInput[];
}

interface RequestStore {
  requests: MaterialRequestView[];
  activity: ActivityEntry[];
  nextSequence: number;
  createRequest: (input: CreateRequestInput) => MaterialRequestView;
  approveStep: (requestId: string, actorName: string) => void;
  returnStep: (requestId: string, actorName: string, reason: string) => void;
  submitWarehouseCheck: (
    requestId: string,
    availableByItemId: Record<string, number>,
    actorName: string
  ) => void;
}

function logTime() {
  return new Date().toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" });
}

function departmentHeadName(departmentId: string) {
  return DEMO_DEPARTMENTS.find((d) => d.id === departmentId)?.headName ?? "Цехийн дарга";
}

function routeApproverName(route: RequestRoute) {
  return route === "FACTORY" ? DEMO_APPROVERS.FACTORY_APPROVER : DEMO_APPROVERS.OFFICE_APPROVER;
}

let liveIdCounter = 0;
function nextLiveId() {
  liveIdCounter += 1;
  return `live-${liveIdCounter}`;
}

function pushActivity(activity: ActivityEntry[], entry: Omit<ActivityEntry, "id" | "time">) {
  return [{ id: nextLiveId(), time: logTime(), ...entry }, ...activity];
}

const OPEN_STATUSES = new Set([
  "DRAFT",
  "PENDING_DEPARTMENT_APPROVAL",
  "PENDING_WAREHOUSE_CHECK",
  "PENDING_ROUTE_APPROVAL",
  "PENDING_DIRECTOR_APPROVAL",
  "FULFILLMENT_IN_PROGRESS",
]);

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export function selectKpis(requests: MaterialRequestView[]) {
  const now = Date.now();
  return {
    totalRequests: requests.length,
    pendingApproval: requests.filter((r) =>
      ["PENDING_DEPARTMENT_APPROVAL", "PENDING_ROUTE_APPROVAL", "PENDING_DIRECTOR_APPROVAL"].includes(r.status)
    ).length,
    warehouseCheck: requests.filter((r) => r.status === "PENDING_WAREHOUSE_CHECK").length,
    needsProcurement: requests.filter((r) =>
      ["PENDING_ROUTE_APPROVAL", "PENDING_DIRECTOR_APPROVAL"].includes(r.status)
    ).length,
    completed: requests.filter((r) => r.status === "COMPLETED").length,
    overdue: requests.filter(
      (r) => OPEN_STATUSES.has(r.status) && now - new Date(r.createdAt).getTime() > FIVE_DAYS_MS
    ).length,
  };
}

export const useRequestStore = create<RequestStore>((set, get) => ({
  requests: DEMO_REQUESTS,
  activity: DEMO_ACTIVITY,
  nextSequence: 1372,

  createRequest: (input) => {
    const department = DEMO_DEPARTMENTS.find((d) => d.id === input.departmentId);
    const sequence = get().nextSequence;
    const requestNumber = `2026-${sequence}`;

    const items: MaterialRequestItemView[] = input.items.map((item, i) => ({
      id: `${nextLiveId()}-item${i + 1}`,
      lineNo: i + 1,
      materialName: item.materialName,
      warehouseBalance: item.warehouseBalance,
      unit: item.unit,
      requestedQuantity: item.requestedQuantity,
      unitPrice: item.unitPrice,
      totalPrice: item.requestedQuantity * item.unitPrice,
      note: item.note,
    }));

    const approvalSteps: ApprovalStepView[] = [
      { type: "DEPARTMENT_HEAD", status: "PENDING", assignedUserName: departmentHeadName(input.departmentId) },
      { type: "WAREHOUSE_CHECK", status: "PENDING", assignedUserName: DEMO_APPROVERS.WAREHOUSE_CLERK },
      { type: "ROUTE_APPROVAL", status: "PENDING", assignedUserName: routeApproverName(input.route) },
      { type: "DIRECTOR_APPROVAL", status: "PENDING", assignedUserName: DEMO_APPROVERS.DIRECTOR },
    ];

    const newRequest: MaterialRequestView = {
      id: nextLiveId(),
      requestNumber,
      createdAt: new Date().toISOString(),
      department: department?.name ?? "—",
      requestedBy: input.requestedBy,
      route: input.route,
      status: "PENDING_DEPARTMENT_APPROVAL",
      totalAmount: items.reduce((sum, i) => sum + i.totalPrice, 0),
      itemCount: items.length,
      items,
      approvalSteps,
    };

    set((s) => ({
      requests: [newRequest, ...s.requests],
      nextSequence: s.nextSequence + 1,
      activity: pushActivity(s.activity, {
        text: `${input.requestedBy} №${requestNumber} захиалга үүсгэв`,
        type: "create",
      }),
    }));

    return newRequest;
  },

  approveStep: (requestId, actorName) => {
    let approvedRequestNumber = "";
    set((s) => ({
      requests: s.requests.map((r) => {
        if (r.id !== requestId) return r;
        const stepIndex = r.approvalSteps.findIndex((st) => st.status === "PENDING");
        if (stepIndex === -1) return r;
        approvedRequestNumber = r.requestNumber;

        const decidedAt = new Date().toISOString();
        const step = r.approvalSteps[stepIndex];
        const approvalSteps = r.approvalSteps.map((st, i) =>
          i === stepIndex ? { ...st, status: "APPROVED" as const, decidedAt } : st
        );

        let status = r.status;
        const completedAt = r.completedAt;
        switch (step.type) {
          case "DEPARTMENT_HEAD":
            status = "PENDING_WAREHOUSE_CHECK";
            break;
          case "ROUTE_APPROVAL":
            status = "PENDING_DIRECTOR_APPROVAL";
            break;
          case "DIRECTOR_APPROVAL":
            status = "FULFILLMENT_IN_PROGRESS";
            break;
          case "WAREHOUSE_CHECK":
            // Warehouse verification is handled by submitWarehouseCheck
            // (it needs per-item quantities), not this generic approve.
            break;
        }

        return { ...r, approvalSteps, status, completedAt };
      }),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${approvedRequestNumber} хүсэлтийг баталлаа`,
        type: "approve",
      }),
    }));
  },

  returnStep: (requestId, actorName, reason) => {
    let returnedRequestNumber = "";
    set((s) => ({
      requests: s.requests.map((r) => {
        if (r.id !== requestId) return r;
        const stepIndex = r.approvalSteps.findIndex((st) => st.status === "PENDING");
        if (stepIndex === -1) return r;
        returnedRequestNumber = r.requestNumber;

        const decidedAt = new Date().toISOString();
        const step = r.approvalSteps[stepIndex];
        const approvalSteps = r.approvalSteps.map((st, i) => {
          if (i === stepIndex) return { ...st, status: "REJECTED" as const, decidedAt, comment: reason };
          if (i > stepIndex) return { ...st, status: "SKIPPED" as const };
          return st;
        });

        let status = r.status;
        switch (step.type) {
          case "DEPARTMENT_HEAD":
            status = "RETURNED_BY_DEPARTMENT";
            break;
          case "ROUTE_APPROVAL":
            status = "RETURNED_BY_ROUTE_APPROVER";
            break;
          case "DIRECTOR_APPROVAL":
            status = "RETURNED_BY_DIRECTOR";
            break;
          case "WAREHOUSE_CHECK":
            // Not exposed via the generic return UI — the warehouse clerk
            // only ever reports quantities, never rejects the request.
            break;
        }

        return { ...r, approvalSteps, status };
      }),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${returnedRequestNumber} хүсэлтийг буцаалаа — ${reason}`,
        type: "reject",
      }),
    }));
  },

  submitWarehouseCheck: (requestId, availableByItemId, actorName) => {
    let checkedRequestNumber = "";
    set((s) => ({
      requests: s.requests.map((r) => {
        if (r.id !== requestId) return r;
        checkedRequestNumber = r.requestNumber;

        const items = r.items.map((item) => {
          const available = availableByItemId[item.id] ?? item.warehouseBalance ?? 0;
          const allocatedQuantity = Math.min(available, item.requestedQuantity);
          const missingQuantity = Math.max(item.requestedQuantity - allocatedQuantity, 0);
          return { ...item, warehouseBalance: available, allocatedQuantity, missingQuantity };
        });

        const hasMissing = items.some((i) => (i.missingQuantity ?? 0) > 0);
        const decidedAt = new Date().toISOString();

        const approvalSteps = r.approvalSteps.map((st) => {
          if (st.type === "WAREHOUSE_CHECK") return { ...st, status: "APPROVED" as const, decidedAt };
          if (!hasMissing && (st.type === "ROUTE_APPROVAL" || st.type === "DIRECTOR_APPROVAL")) {
            return { ...st, status: "SKIPPED" as const };
          }
          return st;
        });

        return {
          ...r,
          items,
          approvalSteps,
          status: hasMissing ? "PENDING_ROUTE_APPROVAL" : "COMPLETED",
          completedAt: hasMissing ? r.completedAt : decidedAt,
        };
      }),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${checkedRequestNumber} агуулахын шалгалтыг баталгаажуулав`,
        type: "approve",
      }),
    }));
  },
}));
