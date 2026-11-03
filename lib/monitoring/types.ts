// Response shapes of /api/admin/monitoring/*. Dates are ISO strings (UTC); the
// UI formats them in Asia/Ulaanbaatar.

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DailyCount {
  /** Calendar day in Ulaanbaatar, YYYY-MM-DD. */
  day: string;
  count: number;
}

export interface OverviewData {
  asOf: string;
  range: string;
  users: { active: number; total: number; loggedIn24h: number; acted24h: number };
  departments: number;
  requests: {
    total: number;
    pending: number;
    returned: number;
    completed: number;
    cancelled: number;
  };
  byStatus: Record<string, number>;
  daily: DailyCount[];
}

export interface DepartmentRow {
  id: string;
  name: string;
  type: string;
  activeMembers: number;
  total: number;
  pending: number;
  returned: number;
  completed: number;
}

export interface EmployeeRow {
  id: string;
  name: string;
  department: string | null;
  role: string;
  isActive: boolean;
  total: number;
  pending: number;
  returned: number;
  completed: number;
}

export interface PendingRow {
  id: string;
  requestNumber: string;
  status: string;
  department: string;
  requestedBy: string;
  assignee: string | null;
  /** When the request entered its current status. */
  since: string;
  waitingSeconds: number;
}

export interface StageBottleneck {
  status: string;
  count: number;
  avgSeconds: number;
  medianSeconds: number;
  maxSeconds: number;
  totalSeconds: number;
}

export interface AssigneeBottleneck {
  userId: string | null;
  name: string;
  count: number;
  avgSeconds: number;
  maxSeconds: number;
}

export interface PendingData {
  asOf: string;
  stages: StageBottleneck[];
  assignees: AssigneeBottleneck[];
  list: Paged<PendingRow>;
  /** True when more pending requests exist than the aggregate cap. */
  truncated: boolean;
}

export interface ReturnedRow {
  id: string;
  requestNumber: string;
  status: string;
  department: string;
  requestedBy: string;
  returnedBy: string | null;
  reason: string | null;
  returnedAt: string | null;
}

export interface ActivityRow {
  id: string;
  action: string;
  actorId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  /** Human reference for the entity when it is a request. */
  entityLabel: string | null;
  createdAt: string;
}
