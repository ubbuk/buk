// Shapes shared by the history API and the Time Machine / Backup Vault UI
// (no server imports here: safe for client components).

export interface ReconRequest {
  id: string;
  requestNumber: string;
  department: string;
  requestedBy: string;
  /** Reconstructed RequestStatus, or "UNKNOWN" when the audit trail cannot say. */
  status: string;
  /** When the request entered `status` (ISO), if known. */
  since: string | null;
  /** Seconds waiting in `status` at asOf (pending stages only). */
  waitingSeconds: number | null;
  flags: string[];
}

export interface CompletenessReason {
  code: string;
  count: number;
  message: string;
}
export interface Completeness {
  status: "complete" | "incomplete";
  /** Why the reconstruction cannot be trusted as complete (empty when complete). */
  reasons: CompletenessReason[];
  /** Advisory notes that do not make the result incomplete (re-sorted, duplicates...). */
  notes: CompletenessReason[];
}

export interface StageSummary {
  status: string;
  count: number;
  avgSeconds: number;
  medianSeconds: number;
  maxSeconds: number;
  totalSeconds: number;
}

export interface EngineMeta {
  name: string;
  version: string;
  kind: "wasm" | "js-fallback";
  wasmSha256: string;
  note?: string;
}

export interface ReconstructionSummary {
  existingRequests: number;
  byStatus: Record<string, number>;
  /** Pending stages ordered by total waiting time (the bottleneck first). */
  stages: StageSummary[];
  pendingTotal: number;
}

export interface Reconstruction {
  schemaVersion: 1;
  kind: "historical-reconstruction";
  asOf: string;
  generatedAt: string;
  engine: EngineMeta;
  completeness: Completeness;
  summary: ReconstructionSummary;
  counters: {
    events: number;
    applied: number;
    ignoredAfterAsOf: number;
    duplicates: number;
    outOfOrder: number;
    sameTimestamp: number;
  };
  requests: ReconRequest[];
  stateHash: string;
  limitations: string[];
}

/** Raw engine inputs, stored in snapshot artifacts so a restore test can replay them. */
export interface SnapshotInputs {
  asOfMs: number;
  requests: { id: string; createdAtMs: number; currentStatus: number }[];
  events: { reqIndex: number; action: number; timeMs: number; hint: number }[];
}

export interface SnapshotArtifact extends Omit<Reconstruction, "kind"> {
  kind: "historical-reconstruction-snapshot";
  notADatabaseBackup: true;
  disclaimer: string;
  inputs: SnapshotInputs;
}

export interface SnapshotManifest {
  schemaVersion: 1;
  snapshotId: string;
  kind: "historical-reconstruction-snapshot";
  /** Always true: a snapshot is reconstructed audit data, never a database backup. */
  notADatabaseBackup: true;
  disclaimer: string;
  /** The historical moment that was reconstructed. */
  asOf: string;
  createdAt: string;
  createdBy: { userId: string };
  completeness: Completeness;
  artifact: { key: string; sizeBytes: number; sha256: string; contentType: "application/json" };
  engine: EngineMeta;
  stateHash: string;
  counts: { requests: number; events: number };
  storageDriver: "local" | "s3";
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}
export interface SnapshotReport {
  schemaVersion: 1;
  kind: "verify" | "restore-test";
  snapshotId: string;
  at: string;
  by: { userId: string };
  ok: boolean;
  checks: CheckResult[];
  durationMs: number;
  /** Always states what a restore test does and does not do. */
  scope: string;
}

export interface SnapshotListItem {
  manifest: SnapshotManifest;
  lastVerify: SnapshotReport | null;
  lastRestoreTest: SnapshotReport | null;
}

export interface SnapshotListResponse {
  storage: { driver: "local" | "s3"; location: string; durable: boolean; objects: number; totalBytes: number };
  engine: EngineMeta;
  snapshots: SnapshotListItem[];
  /** True when more snapshots exist than were returned. */
  truncated: boolean;
}

export const SNAPSHOT_DISCLAIMER =
  "Historical snapshot: reconstructed from the application's audit log. It is NOT a PostgreSQL backup and cannot restore the database.";
export const RESTORE_TEST_SCOPE =
  "Read-only validation in memory: checks integrity, then re-computes the reconstruction from the stored inputs with two independent engines. It does not read or write any database and does not restore PostgreSQL.";
