import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectStorage, StoredObjectInfo } from "@/lib/storage";
import { ACTION_CODES as A } from "./codes";
import { runHistory } from "./engine";
import { buildEngineInput, LIMITATIONS, summarize } from "./reconstruct";
import type { Reconstruction, SnapshotInputs } from "./types";

// reconstruct() reads PostgreSQL; here it is replaced by the same pure pipeline
// fed with fixed rows, so the snapshot / storage logic is tested on its own.
const ASOF = new Date("2026-11-03T10:00:00.000Z");
const T = new Date("2026-11-03T08:00:00.000Z").getTime();

async function fixtureReconstruction(asOf: Date): Promise<{ result: Reconstruction; inputs: SnapshotInputs; engine: Reconstruction["engine"] }> {
  const row = (id: string, n: string, status: string) => ({ id, requestNumber: n, createdAt: new Date(T), status, completedAt: null, department: "Цех", requestedBy: "Ажилтан" });
  const rows = [row("r1", "2026-1", "PENDING_FINANCE_APPROVAL"), row("r2", "2026-2", "PENDING_DEPARTMENT_APPROVAL"), row("r3", "2026-3", "PENDING_DEPARTMENT_APPROVAL")]; // r3: no audit rows
  const at = (ms: number) => new Date(T + ms);
  const events = [
    { entityId: "r1", action: "SUBMIT", createdAt: at(1000) },
    { entityId: "r1", action: "APPROVE", createdAt: at(2000) },
    { entityId: "r1", action: "RESERVE_STOCK", createdAt: at(3000) },
    { entityId: "r1", action: "APPROVE", createdAt: at(4000) },
    { entityId: "r2", action: "SUBMIT", createdAt: at(5000) },
  ];
  const built = buildEngineInput(asOf, rows, events);
  const { output, engine } = await runHistory(built);
  const s = summarize(asOf, rows, output, { requests: false, events: false });
  const result: Reconstruction = {
    schemaVersion: 1,
    kind: "historical-reconstruction",
    asOf: asOf.toISOString(),
    generatedAt: "2026-11-04T00:00:00.000Z",
    engine,
    completeness: s.completeness,
    summary: s.summary,
    counters: s.counters,
    requests: s.requests,
    stateHash: output.stateHash,
    limitations: LIMITATIONS,
  };
  return {
    result,
    engine,
    inputs: { asOfMs: built.asOfMs, requests: rows.map((r, i) => ({ id: r.id, createdAtMs: built.requests[i].createdAtMs, currentStatus: built.requests[i].currentStatus })), events: built.events },
  };
}

vi.mock("./reconstruct", async (orig) => {
  const actual = await orig<typeof import("./reconstruct")>();
  return { ...actual, reconstruct: vi.fn() };
});

import * as reconstructModule from "./reconstruct";
import { canonicalJson, createSnapshot, isValidSnapshotId, listSnapshots, SnapshotError, testRestoreSnapshot, verifySnapshot } from "./snapshots";

// In-memory ObjectStorage that records how it was written to.
class MemoryStorage implements ObjectStorage {
  files = new Map<string, Buffer>();
  calls = { put: 0, putNew: 0, delete: 0 };
  async put(key: string, data: Buffer) {
    this.calls.put++;
    this.files.set(key, data);
  }
  async putNew(key: string, data: Buffer) {
    this.calls.putNew++;
    if (this.files.has(key)) return false;
    this.files.set(key, data);
    return true;
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.calls.delete++;
    this.files.delete(key);
  }
  async list(prefix: string): Promise<StoredObjectInfo[]> {
    return [...this.files.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, v]) => ({ key, size: v.length, lastModified: null }));
  }
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  vi.mocked(reconstructModule.reconstruct).mockImplementation(async (asOf) => fixtureReconstruction(asOf));
});

const iso = (s: string) => new Date(s);

describe("snapshot creation", () => {
  it("stores an immutable artifact and manifest with size, SHA-256 and engine version", async () => {
    const m = await createSnapshot(ASOF, "user-1", { storage: store, now: iso("2026-11-04T09:00:00.000Z") });

    expect(isValidSnapshotId(m.snapshotId)).toBe(true);
    expect(m.asOf).toBe(ASOF.toISOString());
    expect(m.createdAt).toBe("2026-11-04T09:00:00.000Z");
    expect(m.createdBy.userId).toBe("user-1");
    expect(m.notADatabaseBackup).toBe(true);
    expect(m.disclaimer).toMatch(/NOT a PostgreSQL backup/);
    expect(m.engine).toMatchObject({ name: "history-engine", version: "1.0.0", kind: "wasm" });

    const artifact = store.files.get(m.artifact.key)!;
    expect(m.artifact.key.startsWith("snapshots/")).toBe(true);
    expect(m.artifact.sizeBytes).toBe(artifact.length);
    expect(m.artifact.sha256).toBe(createHash("sha256").update(artifact).digest("hex"));
    expect(m.snapshotId.split("_")[2]).toBe(m.artifact.sha256.slice(0, 12));
    expect(store.files.has(`snapshots/${m.snapshotId}.manifest.json`)).toBe(true);

    // The write path never overwrites and never deletes.
    expect(store.calls.put).toBe(0);
    expect(store.calls.delete).toBe(0);
  });

  it("records that the reconstruction is incomplete when the audit trail has gaps", async () => {
    const m = await createSnapshot(ASOF, "user-1", { storage: store });
    expect(m.completeness.status).toBe("incomplete");
    expect(m.completeness.reasons.map((r) => r.code)).toContain("NO_HISTORY"); // r3 has no events
    const artifact = JSON.parse(store.files.get(m.artifact.key)!.toString());
    expect(artifact.requests.find((r: { id: string }) => r.id === "r3")).toMatchObject({ status: "UNKNOWN", since: null });
    expect(artifact.requests.find((r: { id: string }) => r.id === "r1")).toMatchObject({ status: "PENDING_FINANCE_APPROVAL" });
  });

  it("never reuses a key: two snapshots of the same moment are two objects", async () => {
    const a = await createSnapshot(ASOF, "u", { storage: store, now: iso("2026-11-04T09:00:00.000Z") });
    const b = await createSnapshot(ASOF, "u", { storage: store, now: iso("2026-11-04T09:00:00.000Z") });
    expect(a.snapshotId).not.toBe(b.snapshotId); // identical content and time still get distinct ids
    expect(store.files.size).toBe(4); // 2 artifacts + 2 manifests
  });

  it("produces byte-identical output for identical content (canonical JSON)", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 0 } })).toBe(canonicalJson({ a: { c: 0, d: [3, { y: 2, z: 1 }] }, b: 1 }));
  });

  it("rejects the future and invalid dates without storing anything", async () => {
    await expect(createSnapshot(new Date("2999-01-01T00:00:00Z"), "u", { storage: store, now: iso("2026-11-04T09:00:00Z") })).rejects.toBeInstanceOf(SnapshotError);
    await expect(createSnapshot(new Date("nope"), "u", { storage: store })).rejects.toBeInstanceOf(SnapshotError);
    expect(store.files.size).toBe(0);
  });
});

describe("verification", () => {
  it("passes for an untouched snapshot and stores the report", async () => {
    const m = await createSnapshot(ASOF, "u", { storage: store });
    const r = await verifySnapshot(m.snapshotId, "auditor", { storage: store });
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect([...store.files.keys()].some((k) => k.startsWith(`snapshots/reports/${m.snapshotId}/verify-`))).toBe(true);
  });

  it("fails when the artifact bytes were altered", async () => {
    const m = await createSnapshot(ASOF, "u", { storage: store });
    const original = store.files.get(m.artifact.key)!;
    store.files.set(m.artifact.key, Buffer.from(original.toString().replace("PENDING_FINANCE_APPROVAL", "COMPLETED")));
    const r = await verifySnapshot(m.snapshotId, "auditor", { storage: store });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name.startsWith("SHA-256 manifest"))!.ok).toBe(false);
  });

  it("fails when the artifact was replaced and the manifest rewritten to match (identifier mismatch)", async () => {
    const m = await createSnapshot(ASOF, "u", { storage: store });
    const forged = Buffer.from(store.files.get(m.artifact.key)!.toString().replace("2026-1", "2026-9"));
    store.files.set(m.artifact.key, forged);
    const forgedManifest = { ...m, artifact: { ...m.artifact, sizeBytes: forged.length, sha256: createHash("sha256").update(forged).digest("hex") } };
    store.files.set(`snapshots/${m.snapshotId}.manifest.json`, Buffer.from(JSON.stringify(forgedManifest)));
    const r = await verifySnapshot(m.snapshotId, "auditor", { storage: store });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name.includes("ID-тай"))!.ok).toBe(false);
  });

  it("fails when the artifact is missing, and 404s on an unknown snapshot", async () => {
    const m = await createSnapshot(ASOF, "u", { storage: store });
    store.files.delete(m.artifact.key);
    expect((await verifySnapshot(m.snapshotId, "a", { storage: store })).ok).toBe(false);
    await expect(verifySnapshot("20260101T000000000Z_20260101T000000000Z_000000000000_00000000", "a", { storage: store })).rejects.toMatchObject({ status: 404 });
  });
});

describe("isolated test restore", () => {
  it("re-computes the reconstruction from the stored inputs with two engines and matches", async () => {
    const m = await createSnapshot(ASOF, "u", { storage: store });
    const r = await testRestoreSnapshot(m.snapshotId, "auditor", { storage: store });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("restore-test");
    expect(r.scope).toMatch(/does not read or write any database/);
    expect(r.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Engine үр дүн хадгалсан state hash-тай таарна", "C++ ба хараат бус JS reference ижил үр дүн өгнө", "Захиалга бүрийн төлөв дахин тооцоололтой таарна"])
    );
  });

  it("detects tampered stored inputs", async () => {
    const m = await createSnapshot(ASOF, "u", { storage: store });
    const a = JSON.parse(store.files.get(m.artifact.key)!.toString());
    a.inputs.events[0].action = A.CANCEL; // pretend history was different
    store.files.set(m.artifact.key, Buffer.from(canonicalJson(a)));
    const r = await testRestoreSnapshot(m.snapshotId, "auditor", { storage: store });
    expect(r.ok).toBe(false);
  });
});

describe("listing", () => {
  it("lists newest first with the latest verify / restore-test results and storage totals", async () => {
    const first = await createSnapshot(ASOF, "u", { storage: store, now: iso("2026-11-04T09:00:00.000Z") });
    const second = await createSnapshot(ASOF, "u", { storage: store, now: iso("2026-11-04T10:00:00.000Z") });
    await verifySnapshot(first.snapshotId, "a", { storage: store, now: iso("2026-11-04T11:00:00.000Z") });
    await testRestoreSnapshot(first.snapshotId, "a", { storage: store, now: iso("2026-11-04T11:05:00.000Z") });

    const list = await listSnapshots(50, store);
    expect(list.snapshots.map((s) => s.manifest.snapshotId)).toEqual([second.snapshotId, first.snapshotId]);
    expect(list.snapshots[0].lastVerify).toBeNull();
    expect(list.snapshots[1].lastVerify?.ok).toBe(true);
    expect(list.snapshots[1].lastRestoreTest?.ok).toBe(true);
    expect(list.storage.totalBytes).toBe([...store.files.values()].reduce((n, b) => n + b.length, 0));
    expect(list.storage.objects).toBe(store.files.size);
    expect(list.truncated).toBe(false);
    expect((await listSnapshots(1, store)).truncated).toBe(true);
  });

  it("is empty (not faked) when nothing was stored", async () => {
    const list = await listSnapshots(50, store);
    expect(list.snapshots).toEqual([]);
    expect(list.storage.objects).toBe(0);
  });
});

describe("snapshot ids", () => {
  it("only accepts the generated format (no path traversal)", () => {
    expect(isValidSnapshotId("../../etc/passwd")).toBe(false);
    expect(isValidSnapshotId("20260101T000000000Z_20260101T000000000Z_abcdef012345_01234567")).toBe(true);
    expect(isValidSnapshotId("snapshots/x")).toBe(false);
  });
});
