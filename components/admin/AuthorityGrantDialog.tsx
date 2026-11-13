"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

// Step-up for granting authority (lib/authority-grant.ts): a reason, an explicit confirmation and the administrator's
// OWN password. The server decides whether a change is a grant; the admin page opens this dialog when it answers
// STEP_UP_REQUIRED and then repeats the same request with these fields.

export interface GrantStepUp {
  adminPassword: string;
  reason: string;
  confirmed: true;
}

export interface GrantRequest {
  title: string;
  /** One line naming what is being granted to whom. */
  summary: string;
  /** Defaults for granting authority; set them for another sensitive action (e.g. taking an access away). */
  actionLabel?: string;
  confirmText?: string;
  /** Sends the request again with the step-up fields; resolves to an error message, or null when it succeeded. */
  run: (step: GrantStepUp) => Promise<string | null>;
}

export function AuthorityGrantDialog({ request, onClose }: { request: GrantRequest | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (request) {
      setReason("");
      setConfirmed(false);
      setAdminPassword("");
      setError(null);
    }
  }, [request]);

  async function submit() {
    if (!request) return;
    setBusy(true);
    try {
      const failure = await request.run({ adminPassword, reason: reason.trim(), confirmed: true });
      if (failure) {
        setError(failure);
        setAdminPassword("");
      } else {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!request}
      onClose={onClose}
      title={request?.title ?? "Эрх олгох"}
      description="Эрх олгох үйлдэл аудитад бүртгэгдэж, холбогдох хүмүүс болон бусад админд мэдэгдэл очно. Баталгаажуулахын тулд өөрийн нууц үгээ оруулна уу."
    >
      {request && (
        <div className="space-y-3 text-sm">
          <p className="break-words text-xs text-text-muted">
            <b className="text-text">{request.summary}</b>
          </p>
          {error && (
            <p role="alert" data-testid="grant-error" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <label className="block space-y-1 text-xs text-text-muted">
            Шалтгаан (заавал)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              className="focus-ring w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text"
            />
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-border bg-bg-elevated/40 p-3 text-xs text-text">
            <input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{request.confirmText ?? "Би энэ хүнд дээрх эрхийг өгөх эрхтэй бөгөөд хариуцлагыг хүлээнэ."}</span>
          </label>
          <label className="block space-y-1 text-xs text-text-muted">
            Таны өөрийн нууц үг
            <input
              type="password"
              autoComplete="current-password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Болих
            </Button>
            <Button loading={busy} disabled={!confirmed || reason.trim().length < 3 || adminPassword.length === 0} onClick={() => void submit()}>
              {request.actionLabel ?? "Эрх олгох"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
