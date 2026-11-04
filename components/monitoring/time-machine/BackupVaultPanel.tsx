"use client";

import dynamic from "next/dynamic";
import { Component, useRef, type ReactNode } from "react";
import { DatabaseBackup, FlaskConical, ShieldCheck } from "lucide-react";
import type { SnapshotListItem, SnapshotReport } from "@/lib/monitoring/history/types";
import { cn } from "@/lib/utils";
import { formatUB } from "../format";
import { useSceneEnv } from "./sceneKit";
import type { LoadState, VaultMessage, VaultOp } from "./useTimeMachineApi";
import type { SnapshotListResponse } from "@/lib/monitoring/history/types";
import "./time-machine.css";

const BackupVaultScene = dynamic(() => import("./BackupVaultScene"), {
  ssr: false,
  loading: () => <div className="tm-loading">3D ачаалж байна…</div>,
});

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

type Health = "off" | "ok" | "fail";

function Led({ state, label, value }: { state: Health; label: string; value: string }) {
  return (
    <li className="tm-led" data-state={state}>
      <span className="tm-led-dot" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-text-muted">{label}</span>
        <span className="block truncate text-xs font-medium text-text">{value}</span>
      </span>
    </li>
  );
}

// What a report says, as an indicator. "Not run yet" is off, never green.
function reportHealth(r: SnapshotReport | null | undefined): { state: Health; value: string } {
  if (!r) return { state: "off", value: "Хийгдээгүй" };
  return { state: r.ok ? "ok" : "fail", value: `${r.ok ? "Амжилттай" : "Алдаатай"} · ${formatUB(r.at)}` };
}

export interface BackupVaultPanelProps {
  list: LoadState<SnapshotListResponse>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  busy: VaultOp | null;
  message: VaultMessage | null;
  /** The moment selected on the Time Machine (epoch ms), if any. */
  asOfMs: number | null;
  onCreate: () => void;
  onVerify: () => void;
  onRestore: () => void;
}

export function BackupVaultPanel({ list, selectedId, onSelect, busy, message, asOfMs, onCreate, onVerify, onRestore }: BackupVaultPanelProps) {
  const box = useRef<HTMLDivElement>(null);
  const { webgl, reduced, active } = useSceneEnv(box);
  const frameloop = !active ? "never" : reduced ? "demand" : "always";

  const data = list.status === "done" ? list.data : null;
  const snapshots = data?.snapshots ?? [];
  const selected: SnapshotListItem | null = snapshots.find((s) => s.manifest.snapshotId === selectedId) ?? snapshots[0] ?? null;
  const latest = snapshots[0] ?? null;

  // The 3D vault is lit only by real state: a stored snapshot whose last verification passed.
  const lit = !!selected && selected.lastVerify?.ok === true;
  const verify = reportHealth(selected?.lastVerify);
  const restore = reportHealth(selected?.lastRestoreTest);

  const badge =
    list.status === "loading" ? { kind: "off", text: "Ачаалж байна" } : list.status === "error" ? { kind: "fail", text: "Unavailable" } : data && !data.storage.durable ? { kind: "js", text: "Not durable" } : { kind: "wasm", text: data?.storage.driver === "s3" ? "S3 storage" : "Local storage" };

  const idle = busy === null;
  const canCreate = idle && data !== null && asOfMs !== null;
  const canAct = idle && data !== null && selected !== null;

  const operations = [
    { key: "create", label: "Create", icon: DatabaseBackup, enabled: canCreate, onClick: onCreate, title: asOfMs === null ? "Эхлээд Time Machine дээр цаг сонгоно уу" : "Time Machine-ийн сонгосон мөчөөр түүхэн snapshot үүсгэх" },
    { key: "verify", label: "Verify", icon: ShieldCheck, enabled: canAct, onClick: onVerify, title: selected ? "Хадгалсан snapshot-ын SHA-256, хэмжээ, бүтцийг шалгах" : "Шалгах snapshot алга" },
    { key: "restore", label: "Test Restore", icon: FlaskConical, enabled: canAct, onClick: onRestore, title: selected ? "Тусдаа, унших-горимын туршилтын сэргээлт (өгөгдлийн санд хүрэхгүй)" : "Сэргээх snapshot алга" },
  ] as const;

  return (
    <section className="tm-card" aria-label="Backup Vault">
      <header className="tm-head">
        <h3>Backup Vault</h3>
        <span className="tm-badge" data-kind={badge.kind}>
          {badge.text}
        </span>
      </header>

      <div ref={box} className="tm-stage tm-stage--vault">
        {webgl === null ? (
          <div className="tm-loading">Ачаалж байна…</div>
        ) : webgl ? (
          <SceneBoundary fallback={<div className="tm-loading">3D харагдац ачаалж чадсангүй</div>}>
            <BackupVaultScene lit={lit} frameloop={frameloop} reduced={reduced} busy={busy !== null} />
          </SceneBoundary>
        ) : (
          <div className="tm-loading">3D дэмжигдэхгүй байна</div>
        )}
      </div>

      <div className="tm-vault-body">
        <p className="tm-warn" role="note">
          <b>Түүхэн snapshot хадгалах сан.</b> Энд зөвхөн audit log-оос сэргээсэн түүхэн төлөв хадгалагдана. Энэ нь <b>PostgreSQL backup биш</b>, өгөгдлийн санг сэргээж чадахгүй.
          {data && !data.storage.durable && " Энэ орчны локал диск удаан хадгалахгүй (STORAGE_DRIVER=s3 шаардлагатай)."}
        </p>
        {list.status === "error" && (
          <p role="alert" className="tm-warn" style={{ borderLeftColor: "rgb(var(--color-danger))" }}>
            Хадгалалтын мэдээлэл ачаалж чадсангүй: {list.error}
          </p>
        )}

        <ul className="tm-leds">
          <Led state={latest ? "ok" : "off"} label="Сүүлийн snapshot" value={latest ? formatUB(latest.manifest.createdAt) : "Байхгүй"} />
          <Led state={verify.state} label="Бүрэн бүтэн байдал" value={selected ? verify.value : "—"} />
          <Led state={restore.state} label="Туршилтын сэргээлт" value={selected ? restore.value : "—"} />
          <Led state={data ? "ok" : "off"} label="Хадгалах зай" value={data ? `${data.storage.objects} объект · ${formatBytes(data.storage.totalBytes)}` : "—"} />
        </ul>

        <dl className="tm-facts">
          <div>
            <dt>Last snapshot</dt>
            <dd>{selected ? formatUB(selected.manifest.createdAt) : "—"}</dd>
          </div>
          <div>
            <dt>Snapshot size</dt>
            <dd>{selected ? formatBytes(selected.manifest.artifact.sizeBytes) : "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt>SHA-256</dt>
            <dd className="break-all font-mono text-[10.5px] font-normal" title={selected?.manifest.artifact.sha256}>
              {selected ? selected.manifest.artifact.sha256 : "—"}
            </dd>
          </div>
          <div className="col-span-2">
            <dt>Storage location</dt>
            <dd className="text-[11px] font-normal">{data ? data.storage.location : "—"}</dd>
          </div>
        </dl>

        <div>
          <p className="mb-1 text-[11px] text-text-muted">Snapshot-ууд ({snapshots.length}{data?.truncated ? "+" : ""})</p>
          {snapshots.length === 0 ? (
            <p className="text-xs text-text-muted">{list.status === "loading" ? "Ачаалж байна…" : "Snapshot хараахан үүсгэгдээгүй байна."}</p>
          ) : (
            <ul className="tm-snaplist" role="listbox" aria-label="Түүхэн snapshot-ууд">
              {snapshots.map((s) => {
                const id = s.manifest.snapshotId;
                const v = s.lastVerify;
                const r = s.lastRestoreTest;
                return (
                  <li key={id}>
                    <button type="button" role="option" aria-selected={id === selected?.manifest.snapshotId} onClick={() => onSelect(id)} className="tm-snap focus-ring">
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-xs font-medium text-text">{formatUB(s.manifest.asOf)} (УБ)</span>
                        <span className="block truncate text-[10.5px] text-text-muted">
                          үүсгэсэн {formatUB(s.manifest.createdAt)} · {formatBytes(s.manifest.artifact.sizeBytes)}
                        </span>
                      </span>
                      <span className={cn("tm-tag", s.manifest.completeness.status === "incomplete" && "is-warn")} title={s.manifest.completeness.reasons.map((x) => x.message).join("; ")}>
                        {s.manifest.completeness.status === "incomplete" ? "бүрэн бус" : "бүрэн"}
                      </span>
                      <span className={cn("tm-tag", v ? (v.ok ? "is-ok" : "is-bad") : "")} title="Бүрэн бүтэн байдлын шалгалт">
                        V {v ? (v.ok ? "✓" : "✗") : "–"}
                      </span>
                      <span className={cn("tm-tag", r ? (r.ok ? "is-ok" : "is-bad") : "")} title="Туршилтын сэргээлт">
                        R {r ? (r.ok ? "✓" : "✗") : "–"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="tm-ops">
          {operations.map(({ key, label, icon: Icon, enabled, onClick, title }) => (
            <button key={key} type="button" disabled={!enabled} onClick={onClick} title={title} aria-busy={busy === key} className="tm-op focus-ring">
              <Icon className="size-4" aria-hidden />
              <span>{busy === key ? "…" : label}</span>
            </button>
          ))}
        </div>

        <p className="min-h-[1.2rem] text-xs" role="status" aria-live="polite" style={{ color: message?.kind === "error" ? "rgb(var(--color-danger))" : message?.kind === "success" ? "rgb(var(--color-success))" : "rgb(var(--color-text-muted))" }}>
          {message?.text}
        </p>

        <p className="tm-note">
          Test Restore нь санах ойд, унших горимд ажиллаж checksum-ыг шалгаад хадгалсан оролтоос C++ ба хараат бус JS engine-ээр дахин тооцоолно. Өгөгдлийн санд хүрэхгүй, PostgreSQL-д юу ч сэргээхгүй. Production сэргээлтийг энэ интерфейсээс хэзээ ч ажиллуулахгүй.
        </p>
      </div>
    </section>
  );
}
