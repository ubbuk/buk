// Shared reactive client-side state. Requests are loaded from, and request
// creation / department-head approval now write through to, the real
// database via /api/requests/*. The later pipeline stages (warehouse check,
// route approval, director approval) are still simulated client-side only —
// that's the next increment — so an action taken on one screen is still
// immediately visible everywhere else in the same session, same as before.
import { create } from "zustand";
import { DEMO_ACTIVITY } from "./mock-data";
import type { MaterialRequestView, RequestRoute } from "./types";

export interface ActivityEntry {
  id: string;
  time: string;
  text: string;
  type: "create" | "approve" | "reject" | "info";
}

interface NewRequestItemInput {
  materialId?: string | null;
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
  requestsLoading: boolean;
  activity: ActivityEntry[];
  loadRequests: () => Promise<void>;
  createRequest: (input: CreateRequestInput) => Promise<MaterialRequestView>;
  approveDepartmentHead: (requestId: string, actorName: string) => Promise<void>;
  returnDepartmentHead: (requestId: string, actorName: string, reason: string) => Promise<void>;
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

let liveIdCounter = 0;
function nextLiveId() {
  liveIdCounter += 1;
  return `live-${liveIdCounter}`;
}

function pushActivity(activity: ActivityEntry[], entry: Omit<ActivityEntry, "id" | "time">) {
  return [{ id: nextLiveId(), time: logTime(), ...entry }, ...activity];
}

async function apiFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Серверийн алдаа (${res.status})`);
  }
  return res.json();
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

export const useRequestStore = create<RequestStore>((set) => ({
  requests: [],
  requestsLoading: true,
  activity: DEMO_ACTIVITY,

  loadRequests: async () => {
    try {
      const requests: MaterialRequestView[] = await apiFetch("/api/requests");
      set({ requests, requestsLoading: false });
    } catch {
      set({ requestsLoading: false });
    }
  },

  createRequest: async (input) => {
    const created: MaterialRequestView = await apiFetch("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        departmentId: input.departmentId,
        route: input.route,
        items: input.items.map((item) => ({
          materialId: item.materialId ?? null,
          materialName: item.materialName,
          unit: item.unit,
          requestedQuantity: item.requestedQuantity,
          unitPrice: item.unitPrice,
          note: item.note,
        })),
      }),
    });

    set((s) => ({
      requests: [created, ...s.requests],
      activity: pushActivity(s.activity, {
        text: `${input.requestedBy} №${created.requestNumber} захиалга үүсгэв`,
        type: "create",
      }),
    }));

    return created;
  },

  approveDepartmentHead: async (requestId, actorName) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/department-approve`, {
      method: "POST",
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг баталлаа`,
        type: "approve",
      }),
    }));
  },

  returnDepartmentHead: async (requestId, actorName, reason) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/department-return`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг буцаалаа — ${reason}`,
        type: "reject",
      }),
    }));
  },

  // --- Client-only simulation below this line — warehouse check, route and
  // director approval don't write to the database yet (next increment). ---

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
