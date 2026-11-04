"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Reconstruction, SnapshotListResponse, SnapshotManifest, SnapshotReport } from "@/lib/monitoring/history/types";

const API = "/api/admin/time-machine";

export type ReconstructionView = Reconstruction & { requestsTotal: number };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || `Серверийн алдаа (${res.status})`);
  return body as T;
}

export type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; data: T }
  | { status: "error"; error: string };

/** Read-only reconstruction at a chosen moment. */
export function useReconstruction() {
  const [state, setState] = useState<LoadState<ReconstructionView>>({ status: "idle" });
  const seq = useRef(0);
  const run = useCallback(async (asOfMs: number) => {
    const mine = ++seq.current;
    setState({ status: "loading" });
    try {
      const data = await call<ReconstructionView>(`${API}/reconstruct?asOf=${encodeURIComponent(new Date(asOfMs).toISOString())}`);
      if (mine === seq.current) setState({ status: "done", data });
    } catch (e) {
      if (mine === seq.current) setState({ status: "error", error: e instanceof Error ? e.message : "Алдаа гарлаа" });
    }
  }, []);
  return { state, run };
}

export type VaultOp = "create" | "verify" | "restore";
export interface VaultMessage {
  kind: "info" | "success" | "error";
  text: string;
}

/** Snapshot list, storage status and the three vault operations. */
export function useVault() {
  const [list, setList] = useState<LoadState<SnapshotListResponse>>({ status: "loading" });
  const [busy, setBusy] = useState<VaultOp | null>(null);
  const [message, setMessage] = useState<VaultMessage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await call<SnapshotListResponse>(`${API}/snapshots`);
      setList({ status: "done", data });
      setSelectedId((cur) => (cur && data.snapshots.some((s) => s.manifest.snapshotId === cur) ? cur : data.snapshots[0]?.manifest.snapshotId ?? null));
    } catch (e) {
      setList({ status: "error", error: e instanceof Error ? e.message : "Алдаа гарлаа" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (op: VaultOp, progress: string, action: () => Promise<VaultMessage>) => {
      if (busy) return;
      setBusy(op);
      setMessage({ kind: "info", text: progress });
      try {
        setMessage(await action());
      } catch (e) {
        setMessage({ kind: "error", text: e instanceof Error ? e.message : "Алдаа гарлаа" });
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [busy, refresh]
  );

  const create = useCallback(
    (asOfMs: number) =>
      run("create", "Түүхэн snapshot үүсгэж байна…", async () => {
        const m = await call<SnapshotManifest>(`${API}/snapshots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asOf: new Date(asOfMs).toISOString() }) });
        setSelectedId(m.snapshotId);
        const note = m.completeness.status === "incomplete" ? " (түүх бүрэн бус гэж тэмдэглэгдсэн)" : "";
        return { kind: "success", text: `Snapshot хадгалагдлаа${note}. SHA-256 ${m.artifact.sha256.slice(0, 16)}…, ${m.artifact.sizeBytes} байт.` };
      }),
    [run]
  );

  const report = (r: SnapshotReport, okText: string, failText: string): VaultMessage =>
    r.ok
      ? { kind: "success", text: `${okText} (${r.checks.length} шалгалт, ${r.durationMs} мс).` }
      : { kind: "error", text: `${failText}: ${r.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}` };

  const verify = useCallback(
    (id: string) => run("verify", "Бүрэн бүтэн байдлыг шалгаж байна…", async () => report(await call<SnapshotReport>(`${API}/snapshots/${id}/verify`, { method: "POST" }), "Бүрэн бүтэн байдал баталгаажлаа", "Шалгалт амжилтгүй")),
    [run]
  );
  const restore = useCallback(
    (id: string) => run("restore", "Туршилтын сэргээлт хийж байна…", async () => report(await call<SnapshotReport>(`${API}/snapshots/${id}/test-restore`, { method: "POST" }), "Туршилтын сэргээлт амжилттай (өгөгдлийн санд хүрээгүй)", "Туршилтын сэргээлт амжилтгүй")),
    [run]
  );

  return { list, busy, message, selectedId, setSelectedId, refresh, create, verify, restore };
}
