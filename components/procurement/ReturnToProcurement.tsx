"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/** The Chief Accountant sends the request back to the Manager (reason required), e.g. a missing or wrong receipt. */
export function ReturnToProcurement({ requestId, requestNumber, onDone }: { requestId: string; requestNumber: string; onDone: () => void }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/accounting-return`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Буцааж чадсангүй");
      push({ kind: "success", title: "Менежер рүү буцаалаа", description: `№${requestNumber}` });
      setOpen(false);
      setReason("");
      onDone();
    } catch (err) {
      push({ kind: "error", title: "Буцааж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Undo2 className="size-4" /> Буцаах
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Худалдан авалтыг менежер рүү буцаах" description="Юуг засах ёстойг (жишээ нь: падаан алга, дүн таарахгүй) тодорхой бичнэ үү. Менежерт мэдэгдэл очно.">
        <div className="space-y-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Буцаах шалтгаан"
            aria-label="Буцаах шалтгаан"
            className="focus-ring w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Болих
            </Button>
            <Button variant="danger" onClick={() => void submit()} loading={busy} disabled={reason.trim().length < 3}>
              Буцаах
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
