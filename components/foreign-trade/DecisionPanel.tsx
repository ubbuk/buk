"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { PinModal } from "@/components/workflow/PinModal";
import { FT_STAGE_LABEL } from "@/lib/foreign-trade-rules";
import type { FtOrderView } from "@/lib/foreign-trade";
import { ftApi, textareaClass } from "./api";
import { HoloPanel } from "./holo/HoloPanel";

/**
 * The decision of the stage the viewer holds (technical review is an OR: either position decides, the other is told it is
 * done). Approving asks for the PIN; returning asks for the reason. The server decides whether the viewer may.
 */
export function DecisionPanel({ order, onChange }: { order: FtOrderView; onChange: () => void }) {
  const stage = order.access.decisionStage;
  const { data: session } = useSession();
  const toast = useToast();
  const [pinOpen, setPinOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!stage) return null;

  async function decide(action: "APPROVE" | "RETURN", pin?: string) {
    setBusy(true);
    setError(null);
    const r = await ftApi(`/api/foreign-trade/${order.id}/decision`, { json: { action, pin, reason: action === "RETURN" ? reason : undefined, expectedVersion: order.version } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      // somebody else got there first (or the page was stale): show the current state
      if (r.status === 409) onChange();
      return;
    }
    setPinOpen(false);
    setReturnOpen(false);
    setReason("");
    toast.push({ kind: "success", title: action === "APPROVE" ? "Баталгаажууллаа" : "Буцаалаа" });
    onChange();
  }

  return (
    <>
      <HoloPanel tone="amber" bodyClassName="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-text">Таны шийдвэр хүлээж байна — {FT_STAGE_LABEL[stage]}</p>
          <p className="text-xs text-text-muted">
            {stage === "TECHNICAL" ? "Үйлдвэр хариуцсан захирал эсвэл Ерөнхий инженер аль нэг нь батлахад хангалттай. Нэг нь батлангуут энэ шат дуусна." : "Захиалгыг хянаад батлах эсвэл шалтгаан бичиж буцаана уу."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => { setError(null); setReturnOpen(true); }}>
            <Undo2 className="size-4" /> Буцаах
          </Button>
          <Button variant="success" onClick={() => { setError(null); setPinOpen(true); }}>
            <Check className="size-4" /> Батлах
          </Button>
        </div>
      </HoloPanel>

      <PinModal open={pinOpen} onClose={() => setPinOpen(false)} onConfirm={(pin) => decide("APPROVE", pin)} approverName={session?.user?.name ?? ""} approverRole={FT_STAGE_LABEL[stage]} processing={busy} error={error} />

      <Modal open={returnOpen} onClose={() => !busy && setReturnOpen(false)} title="Захиалга буцаах" description={stage === "TECHNICAL" ? "MANAGER руу тайлбартай буцна" : "Цехийн дарга руу тайлбартай буцна"}>
        <div className="space-y-3">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={2000} placeholder="Буцаах шалтгаан" aria-label="Буцаах шалтгаан" className={textareaClass} />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReturnOpen(false)} disabled={busy}>Болих</Button>
            <Button variant="danger" onClick={() => decide("RETURN")} loading={busy} disabled={!reason.trim()}>Буцаах</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
