"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PIN_MAX, PIN_MIN } from "@/lib/pin-format";

export function PinModal({
  open,
  onClose,
  onConfirm,
  approverName,
  approverRole,
  processing,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (pin: string) => void;
  approverName: string;
  approverRole: string;
  processing: boolean;
  error?: string | null;
}) {
  const [pin, setPin] = useState("");
  // null = not known yet (the PIN field stays usable); false = no PIN: say so before anything is typed
  const [hasPin, setHasPin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setPin("");
    setHasPin(null);
    let cancelled = false;
    fetch("/api/me/pin")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { hasPin: boolean } | null) => !cancelled && setHasPin(data ? data.hasPin : null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const noPinSet = hasPin === false || !!error?.includes("тохируулна уу");
  const ready = pin.length >= PIN_MIN && !noPinSet;

  return (
    <Modal open={open} onClose={onClose} title="Захиалга баталгаажуулах" description={`Баталгаажуулахын тулд өөрийн ${PIN_MIN}-${PIN_MAX} оронтой PIN-ээ оруулна уу`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated/50 px-3 py-2 text-sm">
          <ShieldCheck className="size-4 text-accent" />
          <span className="text-text">{approverName}</span>
          <span className="text-text-muted">({approverRole})</span>
        </div>

        {noPinSet ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Эхлээд PIN тохируулна уу.{" "}
              <Link href="/settings#pin" className="font-medium underline">
                Тохиргоо руу очих
              </Link>
            </span>
          </div>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={PIN_MAX}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready) onConfirm(pin);
              }}
              placeholder="······"
              className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-3 text-center text-lg tracking-[0.5em] text-text placeholder:text-text-muted"
            />
          </label>
        )}

        {error && !noPinSet && <p className="text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={processing}>
            Болих
          </Button>
          <Button onClick={() => onConfirm(pin)} loading={processing} disabled={!ready}>
            Баталгаажуулах
          </Button>
        </div>
      </div>
    </Modal>
  );
}
