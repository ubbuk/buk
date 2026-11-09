"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { ExecutiveHandoverPreview } from "@/lib/executive-handover";

const inputClass = "focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `x-${Date.now()}-${Math.random().toString(36).slice(2)}`);

interface Props {
  open: boolean;
  /** the current EXECUTIVE_DIRECTOR position holder: the only possible recipient */
  currentHolder: { id: string; name: string } | null;
  /** every DIRECTOR (active or not) that may still own pending executive work */
  directors: { id: string; name: string; isActive: boolean }[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * ADMIN review of a transfer of pending executive responsibility: from whom, to the current
 * executive (never a free choice), exactly which requests move, and a mandatory reason. The ADMIN
 * only moves the responsibility; approving quantities stays with the executive, who confirms
 * every decision with their own PIN.
 */
export function ExecutiveHandoverDialog({ open, currentHolder, directors, onClose, onDone }: Props) {
  const { push } = useToast();
  const [fromId, setFromId] = useState("");
  const [preview, setPreview] = useState<ExecutiveHandoverPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const keyRef = useRef(newKey());

  useEffect(() => {
    if (!open) return;
    setFromId("");
    setReason("");
    setPreview(null);
    keyRef.current = newKey();
  }, [open]);

  useEffect(() => {
    if (!open || !fromId) return;
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ fromUserId: fromId });
    if (currentHolder) qs.set("toUserId", currentHolder.id);
    fetch(`/api/admin/executive-handover?${qs}`)
      .then((r) => (r.ok ? (r.json() as Promise<ExecutiveHandoverPreview>) : null))
      .then((p) => !cancelled && setPreview(p))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, fromId, currentHolder, nonce]);

  const problem = preview?.newExecutiveProblem ?? preview?.fromProblem ?? null;
  const canConfirm = !!preview && !!currentHolder && !problem && !loading && preview.affectedRequests > 0 && reason.trim().length >= 3;

  async function confirm() {
    if (!preview || !currentHolder) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/executive-handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId: fromId, toUserId: currentHolder.id, reason, clientRequestId: keyRef.current, expectedRequests: preview.affectedRequests }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ kind: "error", title: "Шилжүүлж чадсангүй", description: body.error });
        if (body.code === "WORK_CHANGED") setNonce((n) => n + 1);
        return;
      }
      push({ kind: "success", title: "Баталгаа шилжлээ", description: `${preview.affectedRequests} захиалга шинэ гүйцэтгэх захиралд шилжлээ` });
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Гүйцэтгэх захирлын баталгааг шилжүүлэх"
      description="Өмнөх шийдвэр, тоо хэмжээ, аудитын түүх өөрчлөгдөхгүй. Зөвхөн хүлээгдэж буй шийдвэр одоогийн гүйцэтгэх захиралд шилжинэ. Та өөрөө батлах эрхгүй."
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-text-muted">
          Шинэ гүйцэтгэх захирал: <b className="text-text">{currentHolder?.name ?? "Томилогдоогүй"}</b>
          {!currentHolder && " — эхлээд дээрх хуваарилалтаас томилно уу"}
        </p>
        <label className="block space-y-1 text-xs text-text-muted">
          Өмнөх захирал (шилжүүлэх хүн)
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={inputClass}>
            <option value="">Сонгох</option>
            {directors
              .filter((d) => d.id !== currentHolder?.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isActive ? "" : " (идэвхгүй)"}
                </option>
              ))}
          </select>
        </label>
        {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}

        {preview && !problem && (
          <div className="grid grid-cols-3 gap-2" aria-busy={loading}>
            {[
              ["Нийт захиалга", preview.affectedRequests],
              ["Эхний батлалт", preview.initialPending],
              ["Нэмэлт батлалт", preview.deferredOpen],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg border border-border bg-bg-elevated/40 p-2 text-center">
                <p className="text-lg font-semibold text-text">{v}</p>
                <p className="text-[10px] text-text-muted">{k}</p>
              </div>
            ))}
          </div>
        )}
        {preview && !problem && preview.requests.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-xs">
            {preview.requests.map((r) => (
              <li key={r.requestId} className="flex flex-wrap justify-between gap-x-3">
                <span className="text-text">№{r.requestNumber}</span>
                <span className="text-text-muted">{r.stage === "INITIAL_PENDING" ? "эхний батлалт хүлээж байна" : "нэмэлт батлалт боломжтой"}</span>
              </li>
            ))}
          </ul>
        )}
        {preview && !problem && preview.affectedRequests === 0 && <p className="text-xs text-text-muted">Шилжүүлэх хүлээгдэж буй захиалга алга.</p>}

        <label className="block space-y-1 text-xs text-text-muted">
          Шилжүүлэх шалтгаан (заавал)
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={500} />
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Болих
          </Button>
          <Button disabled={!canConfirm} loading={busy} onClick={() => void confirm()}>
            Шилжүүлж баталгаажуулах
          </Button>
        </div>
      </div>
    </Modal>
  );
}
