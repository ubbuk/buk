import type { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { REQUEST_STATUS_LABEL } from "@/lib/types";
import {
  ACTION_CODES,
  codeToStatus,
  FLAG,
  FLAG_LABEL,
  flagNames,
  PENDING_STATUS_CODES,
  STATUS_UNKNOWN,
  statusToCode,
  TRANSITION_ACTIONS,
  type EngineInput,
  type EngineOutput,
} from "./codes";
import { runHistory } from "./engine";
import type {
  Completeness,
  CompletenessReason,
  EngineMeta,
  ReconRequest,
  Reconstruction,
  SnapshotInputs,
} from "./types";

export const MAX_REQUESTS = 20_000;
export const MAX_EVENTS = 200_000;
const CHUNK = 5_000;

export const LIMITATIONS = [
  "Reconstructed only from material-request transition events in the audit log (submit, approve, return, resubmit, warehouse check, accounting record, cancel).",
  "Item quantities, prices, attachments and stock levels at that moment are not reconstructed.",
  "Changes that were never written to the audit log cannot be seen.",
  "This is not a PostgreSQL backup and cannot restore the database.",
];

interface Loaded {
  requests: { id: string; requestNumber: string; department: string; requestedBy: string }[];
  truncatedRequests: boolean;
  truncatedEvents: boolean;
}

// Pure assembly of the engine input from rows; unit-testable without a database.
export interface RequestRow {
  id: string;
  requestNumber: string;
  createdAt: Date;
  status: string;
  completedAt: Date | null;
  department: string;
  requestedBy: string;
}
export interface EventRow {
  entityId: string;
  action: string;
  createdAt: Date;
}

const BRANCH_OR_LATER = new Set(["PENDING_BRANCH_APPROVAL", "RETURNED_BY_BRANCH_APPROVER", "PENDING_FINANCE_APPROVAL", "RETURNED_BY_FINANCE", "PENDING_EXECUTIVE_APPROVAL", "RETURNED_BY_EXECUTIVE", "PENDING_ACCOUNTING", "ACCOUNTING_COMPLETED"]);

export function buildEngineInput(asOf: Date, requests: RequestRow[], events: EventRow[]): EngineInput & { requestIds: string[] } {
  const index = new Map(requests.map((r, i) => [r.id, i]));
  const byReq = new Map<number, EventRow[]>();
  for (const e of events) {
    const i = index.get(e.entityId);
    if (i === undefined || !(e.action in ACTION_CODES)) continue;
    (byReq.get(i) ?? byReq.set(i, []).get(i)!).push(e);
  }

  const out: EngineInput["events"] = [];
  // Keep the caller's event order (already time/id ordered) so seq is deterministic.
  for (const e of events) {
    const i = index.get(e.entityId);
    if (i === undefined || !(e.action in ACTION_CODES)) continue;
    const req = requests[i];
    let hint = STATUS_UNKNOWN;
    if (e.action === "RESERVE_STOCK") {
      // Warehouse check ends either at the branch approver (something missing) or,
      // when everything was in stock, directly at COMPLETED. The audit row does
      // not say which, so infer it from facts that cannot change afterwards.
      const mine = byReq.get(i) ?? [];
      const lastReserve = [...mine].filter((x) => x.action === "RESERVE_STOCK").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).pop();
      const laterDecision = mine.some((x) => (x.action === "APPROVE" || x.action === "RETURN") && x.createdAt.getTime() > e.createdAt.getTime());
      if (req.status === "COMPLETED" && req.completedAt && lastReserve === e) hint = statusToCode("COMPLETED");
      else if (laterDecision || BRANCH_OR_LATER.has(req.status)) hint = statusToCode("PENDING_BRANCH_APPROVAL");
    }
    out.push({ reqIndex: i, action: ACTION_CODES[e.action as keyof typeof ACTION_CODES], timeMs: e.createdAt.getTime(), hint });
  }

  return {
    asOfMs: asOf.getTime(),
    requests: requests.map((r) => ({ createdAtMs: r.createdAt.getTime(), currentStatus: statusToCode(r.status) })),
    events: out,
    requestIds: requests.map((r) => r.id),
  };
}

async function load(asOf: Date): Promise<Loaded & { rows: RequestRow[]; events: EventRow[] }> {
  const reqRows = await prisma.materialRequest.findMany({
    where: { createdAt: { lte: asOf } },
    select: {
      id: true,
      requestNumber: true,
      createdAt: true,
      status: true,
      completedAt: true,
      department: { select: { name: true } },
      requestedBy: { select: { name: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_REQUESTS + 1,
  });
  const truncatedRequests = reqRows.length > MAX_REQUESTS;
  const rows: RequestRow[] = reqRows.slice(0, MAX_REQUESTS).map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    createdAt: r.createdAt,
    status: r.status,
    completedAt: r.completedAt,
    department: r.department?.name ?? "—",
    requestedBy: r.requestedBy?.name ?? "—",
  }));

  const events: EventRow[] = [];
  let truncatedEvents = false;
  for (let i = 0; i < rows.length && !truncatedEvents; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
    const found = await prisma.auditLog.findMany({
      where: { entityType: "MaterialRequest", entityId: { in: ids }, action: { in: TRANSITION_ACTIONS as AuditAction[] } },
      select: { entityId: true, action: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const f of found) events.push(f);
    if (events.length > MAX_EVENTS) {
      truncatedEvents = true;
      events.length = MAX_EVENTS;
    }
  }
  return {
    requests: rows.map((r) => ({ id: r.id, requestNumber: r.requestNumber, department: r.department, requestedBy: r.requestedBy })),
    truncatedRequests,
    truncatedEvents,
    rows,
    events,
  };
}

const REASON_TEXT: Record<string, string> = {
  NO_HISTORY: "Захиалга байсан боловч түүнийг тайлбарлах audit үйл явдал олдсонгүй (төлөв тодорхойгүй)",
  UNEXPLAINED: "Audit үйл явдал workflow-ын дараалалд таарсангүй (төлөв тодорхойгүй)",
  AMBIGUOUS: "Агуулахын шалгалтын дараах төлөвийг өгөгдлөөс тодорхойлж чадсангүй",
  MISMATCH_CURRENT: "Дараагийн үйл явдалгүй байхад сэргээсэн төлөв одоогийн бодит төлөвтэй зөрсөн",
};

export function summarize(
  asOf: Date,
  req: { id: string; requestNumber: string; department: string; requestedBy: string }[],
  out: EngineOutput,
  flagsTruncated: { requests: boolean; events: boolean }
): { requests: ReconRequest[]; completeness: Completeness; summary: Reconstruction["summary"]; counters: Reconstruction["counters"] } {
  const asOfMs = asOf.getTime();
  const requests: ReconRequest[] = req.map((r, i) => {
    const status = codeToStatus(out.statuses[i]);
    const since = out.since[i] >= 0 ? new Date(out.since[i]).toISOString() : null;
    const pending = (PENDING_STATUS_CODES as readonly number[]).includes(out.statuses[i]) && out.since[i] >= 0;
    return {
      ...r,
      status,
      since,
      waitingSeconds: pending ? Math.max(0, Math.floor((asOfMs - out.since[i]) / 1000)) : null,
      flags: flagNames(out.flags[i]),
    };
  });

  const countFlag = (mask: number) => out.flags.filter((f) => (f & mask) !== 0).length;
  const reasons: CompletenessReason[] = [];
  for (const k of ["NO_HISTORY", "UNEXPLAINED", "AMBIGUOUS", "MISMATCH_CURRENT"] as const) {
    const count = countFlag(FLAG[k]);
    if (count > 0) reasons.push({ code: k, count, message: REASON_TEXT[k] });
  }
  if (flagsTruncated.requests) reasons.push({ code: "TRUNCATED_REQUESTS", count: MAX_REQUESTS, message: `Захиалгын тоо ${MAX_REQUESTS}-аас давсан тул эхний ${MAX_REQUESTS}-г л тооцсон` });
  if (flagsTruncated.events) reasons.push({ code: "TRUNCATED_EVENTS", count: MAX_EVENTS, message: `Audit үйл явдал ${MAX_EVENTS}-аас давсан тул эхний ${MAX_EVENTS}-г л тооцсон` });

  const notes: CompletenessReason[] = [];
  for (const k of ["DUPLICATE", "OUT_OF_ORDER", "SAME_TIME"] as const) {
    const count = countFlag(FLAG[k]);
    if (count > 0) notes.push({ code: k, count, message: FLAG_LABEL[k] });
  }

  const byStatus: Record<string, number> = {};
  out.statusCounts.forEach((n, code) => {
    if (n > 0) byStatus[codeToStatus(code)] = n;
  });
  const stages = out.stages
    .filter((s) => s.count > 0)
    .map((s) => ({
      status: codeToStatus(s.status) as string,
      count: s.count,
      avgSeconds: s.avgSeconds,
      medianSeconds: s.medianSeconds,
      maxSeconds: s.maxSeconds,
      totalSeconds: s.sumSeconds,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds || (a.status < b.status ? -1 : 1));

  return {
    requests,
    completeness: { status: reasons.length ? "incomplete" : "complete", reasons, notes },
    summary: { existingRequests: req.length, byStatus, stages, pendingTotal: stages.reduce((n, s) => n + s.count, 0) },
    counters: {
      events: out.counters.input,
      applied: out.counters.applied,
      ignoredAfterAsOf: out.counters.future,
      duplicates: out.counters.duplicates,
      outOfOrder: out.counters.outOfOrder,
      sameTimestamp: out.counters.sameTime,
    },
  };
}

export const statusLabelOf = (s: string) => (s === "UNKNOWN" ? "Тодорхойгүй" : (REQUEST_STATUS_LABEL as Record<string, string>)[s] ?? s);

/** Reads the audit trail and reconstructs the request states at `asOf`. Read-only. */
export async function reconstruct(
  asOf: Date,
  opts: { includeInputs?: boolean; now?: Date } = {}
): Promise<{ result: Reconstruction; inputs?: SnapshotInputs; engine: EngineMeta }> {
  const loaded = await load(asOf);
  const built = buildEngineInput(asOf, loaded.rows, loaded.events);
  const { output, engine } = await runHistory(built);
  const s = summarize(asOf, loaded.requests, output, { requests: loaded.truncatedRequests, events: loaded.truncatedEvents });

  const result: Reconstruction = {
    schemaVersion: 1,
    kind: "historical-reconstruction",
    asOf: asOf.toISOString(),
    generatedAt: (opts.now ?? new Date()).toISOString(),
    engine,
    completeness: s.completeness,
    summary: s.summary,
    counters: s.counters,
    requests: s.requests,
    stateHash: output.stateHash,
    limitations: LIMITATIONS,
  };
  const inputs: SnapshotInputs | undefined = opts.includeInputs
    ? {
        asOfMs: built.asOfMs,
        requests: loaded.rows.map((r, i) => ({ id: r.id, createdAtMs: built.requests[i].createdAtMs, currentStatus: built.requests[i].currentStatus })),
        events: built.events,
      }
    : undefined;
  return { result, inputs, engine };
}
