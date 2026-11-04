import { createHash, randomBytes } from "node:crypto";
import { describeStorage, storage, type ObjectStorage } from "@/lib/storage";
import { codeToStatus, type EngineInput } from "./codes";
import { getHistoryEngineInfo, runHistory } from "./engine";
import { runHistoryJs } from "./engine-js";
import { reconstruct, summarize } from "./reconstruct";
import {
  RESTORE_TEST_SCOPE,
  SNAPSHOT_DISCLAIMER,
  type CheckResult,
  type SnapshotArtifact,
  type SnapshotListItem,
  type SnapshotListResponse,
  type SnapshotManifest,
  type SnapshotReport,
} from "./types";

// Immutable historical snapshots in object storage (namespace "snapshots/").
//
//   snapshots/<id>.json                       the artifact (reconstruction + engine inputs)
//   snapshots/<id>.manifest.json              timestamps, size, SHA-256, engine, completeness
//   snapshots/reports/<id>/<kind>-<ts>-<r>.json   verification / restore-test results
//
// Every object is written with putNew (never overwritten) and nothing here
// deletes. The id embeds the first 12 hex digits of the artifact's SHA-256, so a
// swapped artifact is caught even if its manifest were rewritten too.

export const SNAPSHOT_PREFIX = "snapshots/";
export const REPORT_PREFIX = "snapshots/reports/";
const ID_RE = /^[0-9]{8}T[0-9]{9}Z_[0-9]{8}T[0-9]{9}Z_[0-9a-f]{12}_[0-9a-f]{8}$/;
export const isValidSnapshotId = (id: string) => ID_RE.test(id);

export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const compact = (d: Date) => d.toISOString().replace(/[-:.]/g, "");
const artifactKey = (id: string) => `${SNAPSHOT_PREFIX}${id}.json`;
const manifestKey = (id: string) => `${SNAPSHOT_PREFIX}${id}.manifest.json`;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// Stable serialisation: keys sorted at every level, so identical content always
// produces identical bytes (and therefore an identical checksum).
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonicalize((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}
export const canonicalJson = (v: unknown) => JSON.stringify(canonicalize(v));

export async function createSnapshot(
  asOf: Date,
  userId: string,
  deps: { storage?: ObjectStorage; now?: Date } = {}
): Promise<SnapshotManifest> {
  const store = deps.storage ?? storage;
  const now = deps.now ?? new Date();
  if (Number.isNaN(asOf.getTime())) throw new SnapshotError("Огноо буруу байна");
  if (asOf.getTime() > now.getTime() + 60_000) throw new SnapshotError("Ирээдүйн цагаар snapshot үүсгэх боломжгүй");

  const { result, inputs, engine } = await reconstruct(asOf, { includeInputs: true, now });
  if (!inputs) throw new Error("inputs missing");
  const artifact: SnapshotArtifact = {
    ...result,
    kind: "historical-reconstruction-snapshot",
    notADatabaseBackup: true,
    disclaimer: SNAPSHOT_DISCLAIMER,
    inputs,
  };
  const body = Buffer.from(canonicalJson(artifact), "utf8");
  const digest = sha256(body);

  let id = "";
  let stored = false;
  for (let attempt = 0; attempt < 4 && !stored; attempt++) {
    id = `${compact(now)}_${compact(asOf)}_${digest.slice(0, 12)}_${randomBytes(4).toString("hex")}`;
    stored = await store.putNew(artifactKey(id), body);
  }
  if (!stored) throw new SnapshotError("Snapshot түлхүүр давхцсан тул хадгалж чадсангүй", 409);

  // Read it back: the stored bytes must hash to what we computed.
  const back = await store.get(artifactKey(id));
  if (!back || sha256(back) !== digest) throw new SnapshotError("Хадгалсан snapshot-ын checksum таарсангүй", 500);

  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    snapshotId: id,
    kind: "historical-reconstruction-snapshot",
    notADatabaseBackup: true,
    disclaimer: SNAPSHOT_DISCLAIMER,
    asOf: asOf.toISOString(),
    createdAt: now.toISOString(),
    createdBy: { userId },
    completeness: result.completeness,
    artifact: { key: artifactKey(id), sizeBytes: body.length, sha256: digest, contentType: "application/json" },
    engine,
    stateHash: result.stateHash,
    counts: { requests: inputs.requests.length, events: inputs.events.length },
    storageDriver: describeStorage().driver,
  };
  const wrote = await store.putNew(manifestKey(id), Buffer.from(canonicalJson(manifest), "utf8"));
  if (!wrote) throw new SnapshotError("Manifest давхцсан тул хадгалж чадсангүй", 409);
  return manifest;
}

async function readJson<T>(store: ObjectStorage, key: string): Promise<T | null> {
  const buf = await store.get(key);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function getManifest(id: string, store: ObjectStorage = storage): Promise<SnapshotManifest | null> {
  if (!isValidSnapshotId(id)) return null;
  const m = await readJson<SnapshotManifest>(store, manifestKey(id));
  return m && m.schemaVersion === 1 && m.snapshotId === id ? m : null;
}

const check = (name: string, ok: boolean, detail: string): CheckResult => ({ name, ok, detail });

// The integrity checks shared by Verify and Test Restore.
async function integrityChecks(
  store: ObjectStorage,
  id: string,
  manifest: SnapshotManifest
): Promise<{ checks: CheckResult[]; artifact: SnapshotArtifact | null; computed: string | null }> {
  const checks: CheckResult[] = [];
  const buf = await store.get(manifest.artifact.key);
  checks.push(check("Artifact хадгалагдсан", !!buf, buf ? `${buf.length} байт` : "Artifact олдсонгүй"));
  if (!buf) return { checks, artifact: null, computed: null };

  const computed = sha256(buf);
  checks.push(check("Хэмжээ manifest-тэй таарна", buf.length === manifest.artifact.sizeBytes, `${buf.length} / ${manifest.artifact.sizeBytes} байт`));
  checks.push(check("SHA-256 manifest-тэй таарна", computed === manifest.artifact.sha256, computed === manifest.artifact.sha256 ? computed : `тооцоолсон ${computed}, manifest ${manifest.artifact.sha256}`));
  checks.push(check("SHA-256 snapshot ID-тай таарна", id.split("_")[2] === computed.slice(0, 12), `ID дахь ${id.split("_")[2]}`));

  let artifact: SnapshotArtifact | null = null;
  try {
    artifact = JSON.parse(buf.toString("utf8")) as SnapshotArtifact;
  } catch {
    /* reported below */
  }
  checks.push(check("JSON задрагдана", !!artifact, artifact ? "OK" : "JSON буруу"));
  if (artifact) {
    const shapeOk = artifact.schemaVersion === 1 && artifact.kind === "historical-reconstruction-snapshot" && artifact.notADatabaseBackup === true && !!artifact.inputs;
    checks.push(check("Schema/төрөл зөв", shapeOk, shapeOk ? "schemaVersion 1" : "Тодорхойгүй schema"));
    checks.push(check("Manifest-тэй нийцнэ", artifact.asOf === manifest.asOf && artifact.stateHash === manifest.stateHash, `asOf ${artifact.asOf}, stateHash ${artifact.stateHash}`));
  }
  return { checks, artifact, computed };
}

async function writeReport(store: ObjectStorage, report: SnapshotReport): Promise<void> {
  const key = `${REPORT_PREFIX}${report.snapshotId}/${report.kind}-${compact(new Date(report.at))}-${randomBytes(3).toString("hex")}.json`;
  if (!(await store.putNew(key, Buffer.from(canonicalJson(report), "utf8")))) throw new SnapshotError("Тайлан давхцсан", 409);
}

export async function verifySnapshot(id: string, userId: string, deps: { storage?: ObjectStorage; now?: Date } = {}): Promise<SnapshotReport> {
  const store = deps.storage ?? storage;
  const started = Date.now();
  const manifest = await getManifest(id, store);
  if (!manifest) throw new SnapshotError("Snapshot олдсонгүй", 404);
  const { checks } = await integrityChecks(store, id, manifest);
  const report: SnapshotReport = {
    schemaVersion: 1,
    kind: "verify",
    snapshotId: id,
    at: (deps.now ?? new Date()).toISOString(),
    by: { userId },
    ok: checks.every((c) => c.ok),
    checks,
    durationMs: Date.now() - started,
    scope: "Verifies the stored artifact against its manifest: size, SHA-256, identifier and structure.",
  };
  await writeReport(store, report);
  return report;
}

// "Isolated test restore": nothing is written back to the ERP and no database is
// touched. The stored inputs are replayed through the C++ engine and through the
// independent TypeScript reference; both must reproduce the stored result.
export async function testRestoreSnapshot(id: string, userId: string, deps: { storage?: ObjectStorage; now?: Date } = {}): Promise<SnapshotReport> {
  const store = deps.storage ?? storage;
  const started = Date.now();
  const manifest = await getManifest(id, store);
  if (!manifest) throw new SnapshotError("Snapshot олдсонгүй", 404);
  const { checks, artifact } = await integrityChecks(store, id, manifest);

  if (artifact && checks.every((c) => c.ok)) {
    const input: EngineInput = {
      asOfMs: artifact.inputs.asOfMs,
      requests: artifact.inputs.requests.map((r) => ({ createdAtMs: r.createdAtMs, currentStatus: r.currentStatus })),
      events: artifact.inputs.events,
    };
    const { output, engine } = await runHistory(input);
    const ref = runHistoryJs(input);
    checks.push(check("Engine үр дүн хадгалсан state hash-тай таарна", output.stateHash === artifact.stateHash, `${engine.kind}: ${output.stateHash} / хадгалсан ${artifact.stateHash}`));
    checks.push(check("C++ ба хараат бус JS reference ижил үр дүн өгнө", output.stateHash === ref.stateHash && JSON.stringify(output.statuses) === JSON.stringify(ref.statuses), `reference ${ref.stateHash}`));

    const same = artifact.requests.length === output.statuses.length && artifact.requests.every((r, i) => r.status === codeToStatus(output.statuses[i]) && r.id === artifact.inputs.requests[i].id);
    checks.push(check("Захиалга бүрийн төлөв дахин тооцоололтой таарна", same, `${artifact.requests.length} захиалга`));

    const s = summarize(new Date(artifact.asOf), artifact.requests.map(({ id: rid, requestNumber, department, requestedBy }) => ({ id: rid, requestNumber, department, requestedBy })), output, { requests: false, events: false });
    checks.push(check("Нэгтгэл (төлөвөөр/шатаар) таарна", canonicalJson(s.summary) === canonicalJson(artifact.summary), `${Object.keys(s.summary.byStatus).length} төлөв`));
  }

  const report: SnapshotReport = {
    schemaVersion: 1,
    kind: "restore-test",
    snapshotId: id,
    at: (deps.now ?? new Date()).toISOString(),
    by: { userId },
    ok: checks.length > 0 && checks.every((c) => c.ok),
    checks,
    durationMs: Date.now() - started,
    scope: RESTORE_TEST_SCOPE,
  };
  await writeReport(store, report);
  return report;
}

export async function listSnapshots(limit = 50, store: ObjectStorage = storage): Promise<SnapshotListResponse> {
  const all = await store.list(SNAPSHOT_PREFIX);
  const manifests = all.filter((o) => o.key.endsWith(".manifest.json") && !o.key.startsWith(REPORT_PREFIX)).map((o) => o.key);
  // Ids start with the creation time, so reverse key order is newest first.
  const newest = manifests.sort().reverse();
  const picked = newest.slice(0, limit);

  const reportsById = new Map<string, string[]>();
  for (const o of all) {
    if (!o.key.startsWith(REPORT_PREFIX)) continue;
    const id = o.key.slice(REPORT_PREFIX.length).split("/")[0];
    (reportsById.get(id) ?? reportsById.set(id, []).get(id)!).push(o.key);
  }

  const latest = async (id: string, kind: "verify" | "restore-test"): Promise<SnapshotReport | null> => {
    const keys = (reportsById.get(id) ?? []).filter((k) => k.split("/").pop()!.startsWith(`${kind}-`)).sort();
    const key = keys[keys.length - 1];
    return key ? readJson<SnapshotReport>(store, key) : null;
  };

  const items: SnapshotListItem[] = [];
  for (const key of picked) {
    const id = key.slice(SNAPSHOT_PREFIX.length, -".manifest.json".length);
    const manifest = await getManifest(id, store);
    if (!manifest) continue;
    items.push({ manifest, lastVerify: await latest(id, "verify"), lastRestoreTest: await latest(id, "restore-test") });
  }

  const info = describeStorage();
  const engine = await getHistoryEngineInfo();
  return {
    storage: { ...info, objects: all.length, totalBytes: all.reduce((n, o) => n + o.size, 0) },
    engine,
    snapshots: items,
    truncated: newest.length > picked.length,
  };
}
