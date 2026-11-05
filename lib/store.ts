
import { create } from "zustand";
import { DEMO_ACTIVITY } from "./mock-data";
import type { MaterialRequestView } from "./types";

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
  unitPrice: number | null;
  warehouseBalance: number | null;
  note?: string;
}

interface CreateRequestInput {
  departmentId: string;
  requestedBy: string;
  items: NewRequestItemInput[];
}

interface RequestStore {
  requests: MaterialRequestView[];
  requestsLoading: boolean;
  activity: ActivityEntry[];
  loadRequests: () => Promise<void>;
  createRequest: (input: CreateRequestInput) => Promise<MaterialRequestView>;
  approveDepartmentHead: (requestId: string, actorName: string, pin: string, expectedVersion: number) => Promise<void>;
  returnDepartmentHead: (requestId: string, actorName: string, reason: string, expectedVersion: number) => Promise<void>;
  warehouseCheck: (
    requestId: string,
    items: { requestItemId: string; availableQuantity: number }[],
    actorName: string,
    pin: string,
    expectedVersion: number
  ) => Promise<void>;
  branchApprove: (requestId: string, actorName: string, pin: string, expectedVersion: number) => Promise<void>;
  branchReturn: (requestId: string, actorName: string, reason: string, expectedVersion: number) => Promise<void>;
  financeApprove: (requestId: string, actorName: string, pin: string, expectedVersion: number) => Promise<void>;
  financeReturn: (requestId: string, actorName: string, reason: string, expectedVersion: number) => Promise<void>;
  executiveApprove: (requestId: string, actorName: string, pin: string, expectedVersion: number) => Promise<void>;
  executiveReturn: (requestId: string, actorName: string, reason: string, expectedVersion: number) => Promise<void>;
  recordAccounting: (
    requestId: string,
    actorName: string,
    input: { ledgerNumber: string; recordDate: string; note?: string },
    expectedVersion: number
  ) => Promise<void>;
  resubmitDepartment: (
    requestId: string,
    actorName: string,
    expectedVersion: number,
    items: NewRequestItemInput[],
    note?: string
  ) => Promise<void>;
  resubmitPositionStep: (
    requestId: string,
    actorName: string,
    expectedVersion: number,
    adjustments: { requestItemId: string; quantity: number }[]
  ) => Promise<void>;
  updateItemPrice: (
    requestId: string,
    itemId: string,
    actorName: string,
    unitPrice: number,
    expectedVersion: number
  ) => Promise<void>;
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
  "PENDING_BRANCH_APPROVAL",
  "PENDING_FINANCE_APPROVAL",
  "PENDING_EXECUTIVE_APPROVAL",
  "PENDING_PROCUREMENT",
  "PENDING_ACCOUNTING",
]);

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export function selectKpis(requests: MaterialRequestView[]) {
  const now = Date.now();
  return {
    totalRequests: requests.length,
    pendingApproval: requests.filter((r) =>
      ["PENDING_DEPARTMENT_APPROVAL", "PENDING_BRANCH_APPROVAL", "PENDING_FINANCE_APPROVAL", "PENDING_EXECUTIVE_APPROVAL"].includes(
        r.status
      )
    ).length,
    warehouseCheck: requests.filter((r) => r.status === "PENDING_WAREHOUSE_CHECK").length,
    pendingAccounting: requests.filter((r) => r.status === "PENDING_ACCOUNTING").length,
    completed: requests.filter((r) => r.status === "COMPLETED" || r.status === "ACCOUNTING_COMPLETED").length,
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

  approveDepartmentHead: async (requestId, actorName, pin, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/department-approve`, {
      method: "POST",
      body: JSON.stringify({ pin, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг баталлаа`,
        type: "approve",
      }),
    }));
  },

  returnDepartmentHead: async (requestId, actorName, reason, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/department-return`, {
      method: "POST",
      body: JSON.stringify({ reason, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг буцаалаа — ${reason}`,
        type: "reject",
      }),
    }));
  },

  warehouseCheck: async (requestId, items, actorName, pin, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/warehouse-check`, {
      method: "POST",
      body: JSON.stringify({ items, pin, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} агуулахын шалгалтыг баталгаажуулав`,
        type: "approve",
      }),
    }));
  },

  branchApprove: async (requestId, actorName, pin, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/branch-approve`, {
      method: "POST",
      body: JSON.stringify({ pin, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг баталлаа`,
        type: "approve",
      }),
    }));
  },

  branchReturn: async (requestId, actorName, reason, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/branch-return`, {
      method: "POST",
      body: JSON.stringify({ reason, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг буцаалаа — ${reason}`,
        type: "reject",
      }),
    }));
  },

  financeApprove: async (requestId, actorName, pin, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/finance-approve`, {
      method: "POST",
      body: JSON.stringify({ pin, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг баталлаа`,
        type: "approve",
      }),
    }));
  },

  financeReturn: async (requestId, actorName, reason, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/finance-return`, {
      method: "POST",
      body: JSON.stringify({ reason, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг буцаалаа — ${reason}`,
        type: "reject",
      }),
    }));
  },

  executiveApprove: async (requestId, actorName, pin, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/executive-approve`, {
      method: "POST",
      body: JSON.stringify({ pin, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг баталлаа`,
        type: "approve",
      }),
    }));
  },

  executiveReturn: async (requestId, actorName, reason, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/executive-return`, {
      method: "POST",
      body: JSON.stringify({ reason, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг буцаалаа — ${reason}`,
        type: "reject",
      }),
    }));
  },

  recordAccounting: async (requestId, actorName, input, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/accounting-record`, {
      method: "POST",
      body: JSON.stringify({ ...input, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийн санхүүгийн бүртгэл хийв`,
        type: "info",
      }),
    }));
  },

  resubmitDepartment: async (requestId, actorName, expectedVersion, items, note) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/resubmit`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion,
        note,
        items: items.map((item) => ({
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
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг засварлаж дахин илгээв`,
        type: "info",
      }),
    }));
  },

  resubmitPositionStep: async (requestId, actorName, expectedVersion, adjustments) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/resubmit`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, adjustments }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийг дахин илгээв`,
        type: "info",
      }),
    }));
  },

  updateItemPrice: async (requestId, itemId, actorName, unitPrice, expectedVersion) => {
    const updated: MaterialRequestView = await apiFetch(`/api/requests/${requestId}/items/${itemId}/price`, {
      method: "PATCH",
      body: JSON.stringify({ unitPrice, expectedVersion }),
    });
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? updated : r)),
      activity: pushActivity(s.activity, {
        text: `${actorName} №${updated.requestNumber} хүсэлтийн үнийг шинэчлэв`,
        type: "info",
      }),
    }));
  },
}));
