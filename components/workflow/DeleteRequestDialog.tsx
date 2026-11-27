"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { FINANCE_BLOCK_MESSAGE } from "@/lib/request-delete-text";

const inputClass = "focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";

/**
 * ЗӨВХӨН ADMIN: захиалгыг бүрэн устгах. Захиалгын дугаарыг гараар бичиж + PIN-ээр баталгаажуулна.
 * Санхүүд бүртгэгдсэн захиалгад товч идэвхгүй, шалтгааныг нь харуулна (сервер ч мөн 409-өөр татгалзана).
 */
export function DeleteRequestDialog({ requestId, requestNumber, financeRecorded, onDeleted }: { requestId: string; requestNumber: string; financeRecorded: boolean; onDeleted?: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (financeRecorded) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-elevated/50 px-3 py-2 text-xs text-text-muted" data-testid="delete-blocked">
        <Trash2 className="size-3.5" />
        {FINANCE_BLOCK_MESSAGE}
      </div>
    );
  }

  const matches = name.trim() === requestNumber;
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmName: name.trim(), pin }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Устгаж чадсангүй");
        return;
      }
      setOpen(false);
      push({ kind: "success", title: `Захиалга №${requestNumber} устгагдлаа` });
      onDeleted?.();
      router.push("/requests");
    } catch {
      setError("Сүлжээний алдаа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="danger"
        onClick={() => {
          setName("");
          setPin("");
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 className="size-4" />
        Устгах
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Захиалгыг бүрэн устгах" description="Захиалга, мөр, батлалтын түүх, мэдэгдэл, хавсралт файлууд БҮРМӨСӨН устна. Буцаах боломжгүй.">
        <div className="space-y-3">
          <label className="block text-sm text-text">
            Баталгаажуулахын тулд захиалгын дугаарыг бичнэ үү: <span className="font-semibold">{requestNumber}</span>
            <input className={`${inputClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="delete-confirm-name" />
          </label>
          <label className="block text-sm text-text">
            Таны PIN
            <input className={`${inputClass} mt-1`} type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" data-testid="delete-pin" />
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Болих
            </Button>
            <Button variant="danger" onClick={() => void submit()} disabled={busy || !matches || pin.length < 4} data-testid="delete-submit">
              Устгах
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
