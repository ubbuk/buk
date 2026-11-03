"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

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

  useEffect(() => {
    if (open) setPin("");
  }, [open]);

  const noPinSet = error?.includes("тохируулна уу");

  return (
    <Modal open={open} onClose={onClose} title="Захиалга баталгаажуулах" description="Баталгаажуулахын тулд өөрийн дөрөв оронтой PIN-ээ оруулна уу">
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated/50 px-3 py-2 text-sm">
          <ShieldCheck className="size-4 text-accent" />
          <span className="text-text">{approverName}</span>
          <span className="text-text-muted">({approverRole})</span>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-muted">PIN</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pin.length === 4) onConfirm(pin);
            }}
            placeholder="····"
            className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-3 text-center text-lg tracking-[0.5em] text-text placeholder:text-text-muted"
          />
        </label>

        {error && (
          <p className="text-xs text-danger">
            {error}
            {noPinSet && (
              <>
                {" "}
                <Link href="/settings" className="underline">
                  Тохиргоо руу очих
                </Link>
              </>
            )}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={processing}>
            Болих
          </Button>
          <Button onClick={() => onConfirm(pin)} loading={processing} disabled={pin.length !== 4}>
            Баталгаажуулах
          </Button>
        </div>
      </div>
    </Modal>
  );
}
