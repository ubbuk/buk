"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { HandoverPreview } from "@/lib/procurement-handover";

const inputClass = "focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `h-${Date.now()}-${Math.random().toString(36).slice(2)}`);

interface Props {
  open: boolean;
  position: "DOMESTIC_PROCUREMENT_MANAGER" | "INTERNATIONAL_PROCUREMENT_MANAGER";
  label: string;
  /** current holder (to recover stranded work without changing the holder) or a freshly picked replacement */
  initialManagerId: string;
  managers: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * ADMIN review of a procurement-manager replacement / handover: who is leaving, who is
 * coming, exactly what unfinished work would move, and a mandatory reason. Nothing moves
 * until the administrator confirms here -- changing the position alone never transfers work.
 */
export function ProcurementHandoverDialog({ open, position, label, initialManagerId, managers, onClose, onDone }: Props) {
  const { push } = useToast();
  const [newManagerId, setNewManagerId] = useState(initialManagerId);
  const [preview, setPreview] = useState<HandoverPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const keyRef = useRef(newKey());

  useEffect(() => {
    if (!open) return;
    setNewManagerId(initialManagerId);
    setReason("");
    keyRef.current = newKey();
  }, [open, initialManagerId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ position });
    if (newManagerId) qs.set("newManagerId", newManagerId);
    fetch(`/api/admin/procurement-handover?${qs}`)
      .then((r) => (r.ok ? (r.json() as Promise<HandoverPreview>) : null))
      .then((p) => !cancelled && setPreview(p))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, position, newManagerId, nonce]);

  const hasWork = !!preview && preview.affectedItems > 0;
  const holderChanges = !!preview && !!newManagerId && preview.previousManager?.id !== newManagerId;
  const blocked = !!preview?.newManagerProblem;
  const canConfirm = !!newManagerId && !!preview && !blocked && !loading && (hasWork ? reason.trim().length >= 3 : holderChanges);

  async function confirm() {
    if (!preview || !newManagerId) return;
    setBusy(true);
    try {
      const res = hasWork
        ? await fetch("/api/admin/procurement-handover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ position, newManagerId, reason, clientRequestId: keyRef.current, expectedItems: preview.affectedItems }),
          })
        : await fetch("/api/admin/approval-roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: position, userId: newManagerId }),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ kind: "error", title: "Шилжүүлж чадсангүй", description: body.error });
        if (body.code === "WORK_CHANGED" || body.code === "HANDOVER_REQUIRED") setNonce((n) => n + 1); // re-review the current state
        return;
      }
      push({ kind: "success", title: hasWork ? "Дуусаагүй ажил шилжлээ" : "Томилогдлоо", description: hasWork ? `${preview.affectedItems} материал шинэ менежерт шилжлээ` : undefined });
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
      title="Дуусаагүй ажлыг шилжүүлэх"
      description="Худалдан авалтын бичлэг, үнэ, огноо, хүчингүй болгосон түүх өөрчлөгдөхгүй. Шинэ менежер зөвхөн үлдсэн (авагдаагүй) тоо хэмжээг хариуцна."
    >
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-text-muted">Хариуцлага</dt>
          <dd className="text-text">{label}</dd>
          <dt className="text-text-muted">Өмнөх менежер</dt>
          <dd className="text-text">
            {preview?.previousManager ? preview.previousManager.name : "—"}
            {preview?.previousManager && (!preview.previousManager.isActive || !preview.previousManager.isManager) && <span className="ml-2 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] text-danger">идэвхгүй</span>}
          </dd>
        </dl>

        <label className="block space-y-1 text-xs text-text-muted">
          Шинэ менежер
          <select value={newManagerId} onChange={(e) => setNewManagerId(e.target.value)} className={inputClass}>
            <option value="">Сонгох</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {preview?.newManagerProblem && <p className="text-xs text-danger">{preview.newManagerProblem}</p>}

        {preview && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-busy={loading}>
            {[
              ["Нөлөөлөх захиалга", preview.affectedRequests],
              ["Шилжих материал", preview.affectedItems],
              ["Хэсэгчлэн авсан", preview.partiallyPurchasedItems],
              ["Ангилах хүлээж буй", preview.pendingClassificationRequests],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg border border-border bg-bg-elevated/40 p-2 text-center">
                <p className="text-lg font-semibold text-text">{v}</p>
                <p className="text-[10px] text-text-muted">{k}</p>
              </div>
            ))}
          </div>
        )}

        {preview && preview.items.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-xs">
            {preview.items.map((i) => (
              <li key={i.itemId} className="flex flex-wrap justify-between gap-x-3">
                <span className="text-text">
                  №{i.requestNumber} · {i.materialName}
                </span>
                <span className="text-text-muted">
                  үлдэгдэл {i.remaining} {i.unit} (авсан {i.purchased}/{i.required}) · {i.fromManagerName}
                </span>
              </li>
            ))}
          </ul>
        )}
        {preview && preview.pendingClassificationRequests > 0 && position === "INTERNATIONAL_PROCUREMENT_MANAGER" && (
          <p className="text-xs text-text-muted">Ангилал хүлээж буй захиалгууд албан тушаалтай хамт шинэ менежерт очно (өгөгдөл шилжихгүй), шинэ менежерт мэдэгдэл очно.</p>
        )}
        {preview && !hasWork && newManagerId && !blocked && <p className="text-xs text-text-muted">Шилжүүлэх дуусаагүй материал алга.</p>}

        {hasWork && (
          <label className="block space-y-1 text-xs text-text-muted">
            Шилжүүлэх шалтгаан (заавал)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={500} />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Болих
          </Button>
          <Button disabled={!canConfirm} loading={busy} onClick={() => void confirm()}>
            {hasWork ? "Шилжүүлж баталгаажуулах" : "Томилох"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
