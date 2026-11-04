import type { RequestStatus } from "@/lib/types";

// The real approval pipeline (lib/types.ts RequestStatus), one station per
// pending status plus the intake (draft) and the finished state. Nothing here
// is invented: every count comes from OverviewData.byStatus.
export interface StageDef {
  key: string;
  label: string;
  statuses: RequestStatus[];
  /** Return-to-requester statuses that belong to this station's decision. */
  returned: RequestStatus[];
  /** Where "open all orders" goes when the stage has no wait list. */
  href: string;
  tone: "amber" | "green" | "neutral";
}

export const STAGES: StageDef[] = [
  { key: "draft", label: "Ноорог", statuses: ["DRAFT"], returned: [], href: "/requests", tone: "neutral" },
  { key: "department", label: "Цех", statuses: ["PENDING_DEPARTMENT_APPROVAL"], returned: ["RETURNED_BY_DEPARTMENT"], href: "/approvals", tone: "amber" },
  { key: "warehouse", label: "Агуулах", statuses: ["PENDING_WAREHOUSE_CHECK"], returned: [], href: "/approvals", tone: "amber" },
  { key: "branch", label: "Салбар", statuses: ["PENDING_BRANCH_APPROVAL"], returned: ["RETURNED_BY_BRANCH_APPROVER"], href: "/approvals", tone: "amber" },
  { key: "finance", label: "Санхүү", statuses: ["PENDING_FINANCE_APPROVAL"], returned: ["RETURNED_BY_FINANCE"], href: "/approvals", tone: "amber" },
  { key: "executive", label: "Гүйцэтгэх", statuses: ["PENDING_EXECUTIVE_APPROVAL"], returned: ["RETURNED_BY_EXECUTIVE"], href: "/approvals", tone: "amber" },
  { key: "accounting", label: "Бүртгэл", statuses: ["PENDING_ACCOUNTING"], returned: [], href: "/approvals", tone: "amber" },
  { key: "done", label: "Дууссан", statuses: ["COMPLETED", "ACCOUNTING_COMPLETED", "PARTIALLY_COMPLETED"], returned: [], href: "/archive", tone: "green" },
];

export interface StageView {
  key: string;
  label: string;
  tone: StageDef["tone"];
  count: number;
  returned: number;
}

const sum = (statuses: RequestStatus[], byStatus: Record<string, number>) =>
  statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0);

export function buildStageViews(byStatus: Record<string, number>): StageView[] {
  return STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    tone: s.tone,
    count: sum(s.statuses, byStatus),
    returned: sum(s.returned, byStatus),
  }));
}

/** Imperative handle the zoom buttons use; the 3D scene registers it. */
export interface SceneApi {
  zoomBy: (factor: number) => void;
  reset: () => void;
}
