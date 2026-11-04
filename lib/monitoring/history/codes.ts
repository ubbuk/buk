import type { RequestStatus } from "@/lib/types";

// Numeric codes shared with native/history-engine/history_engine.cpp. Keep in sync.

export const STATUS_CODES = [
  "DRAFT",
  "PENDING_DEPARTMENT_APPROVAL",
  "RETURNED_BY_DEPARTMENT",
  "PENDING_WAREHOUSE_CHECK",
  "PENDING_BRANCH_APPROVAL",
  "RETURNED_BY_BRANCH_APPROVER",
  "PENDING_FINANCE_APPROVAL",
  "RETURNED_BY_FINANCE",
  "PENDING_EXECUTIVE_APPROVAL",
  "RETURNED_BY_EXECUTIVE",
  "PENDING_ACCOUNTING",
  "ACCOUNTING_COMPLETED",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "CANCELLED",
] as const satisfies readonly RequestStatus[];

export const STATUS_UNKNOWN = 15;
export type ReconstructedStatus = RequestStatus | "UNKNOWN";

export const statusToCode = (s: string): number => {
  const i = (STATUS_CODES as readonly string[]).indexOf(s);
  return i < 0 ? STATUS_UNKNOWN : i;
};
export const codeToStatus = (c: number): ReconstructedStatus => (c >= 0 && c < STATUS_CODES.length ? STATUS_CODES[c] : "UNKNOWN");

/** Stages where a request waits for somebody (what the bottleneck analysis covers). */
export const PENDING_STATUS_CODES = [1, 3, 4, 6, 8, 10] as const;

// Audit actions that move a request between statuses (AuditLog.action).
export const ACTION_CODES = {
  SUBMIT: 0,
  APPROVE: 1,
  RETURN: 2,
  RESUBMIT: 3,
  RESERVE_STOCK: 4,
  ACCOUNTING_RECORD: 5,
  CANCEL: 6,
  REJECT: 7,
} as const;
export type TransitionAction = keyof typeof ACTION_CODES;
export const TRANSITION_ACTIONS = Object.keys(ACTION_CODES) as TransitionAction[];

export const FLAG = {
  NO_HISTORY: 1,
  UNEXPLAINED: 2,
  AMBIGUOUS: 4,
  MISMATCH_CURRENT: 8,
  DUPLICATE: 16,
  OUT_OF_ORDER: 32,
  SAME_TIME: 64,
} as const;
/** Flags that make the reconstruction of a request unreliable (=> report incomplete). */
export const INCOMPLETE_FLAGS = FLAG.NO_HISTORY | FLAG.UNEXPLAINED | FLAG.AMBIGUOUS | FLAG.MISMATCH_CURRENT;

export const FLAG_LABEL: Record<keyof typeof FLAG, string> = {
  NO_HISTORY: "Түүх олдсонгүй",
  UNEXPLAINED: "Тайлбарлагдаагүй шилжилт",
  AMBIGUOUS: "Агуулахын үр дүн тодорхойгүй",
  MISMATCH_CURRENT: "Одоогийн төлөвтэй зөрсөн",
  DUPLICATE: "Давхардсан үйл явдал нэгтгэв",
  OUT_OF_ORDER: "Дарааллын алдаатай үйл явдал",
  SAME_TIME: "Ижил цагтай үйл явдал",
};
export const flagNames = (flags: number): (keyof typeof FLAG)[] =>
  (Object.keys(FLAG) as (keyof typeof FLAG)[]).filter((k) => (flags & FLAG[k]) !== 0);

export interface EngineRequestInput {
  /** Milliseconds since epoch. */
  createdAtMs: number;
  /** Live RequestStatus code, used only to cross-check the reconstruction. */
  currentStatus: number;
}
export interface EngineEventInput {
  reqIndex: number;
  action: number;
  timeMs: number;
  /** Status the warehouse step led to (only for RESERVE_STOCK), or STATUS_UNKNOWN. */
  hint: number;
}
export interface EngineInput {
  asOfMs: number;
  requests: EngineRequestInput[];
  events: EngineEventInput[];
}

export interface StageStat {
  status: number;
  count: number;
  sumSeconds: number;
  avgSeconds: number;
  medianSeconds: number;
  maxSeconds: number;
}
export interface EngineOutput {
  statuses: number[];
  /** ms epoch of entering the reconstructed status, or -1. */
  since: number[];
  flags: number[];
  statusCounts: number[];
  stages: StageStat[];
  counters: {
    input: number;
    applied: number;
    future: number;
    duplicates: number;
    outOfOrder: number;
    sameTime: number;
    unexplained: number;
    ambiguous: number;
  };
  /** 64-bit FNV-1a of the final state, hex. */
  stateHash: string;
}
