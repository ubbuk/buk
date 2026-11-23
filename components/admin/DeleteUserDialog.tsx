"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { RemovalInspection } from "@/lib/user-removal";

const selectClass = "focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text";
const inputClass = "focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";
const EMPTY = "__empty__";
const CANCEL = "__cancel__";

interface Props {
  user: { id: string; name: string; email: string } | null;
  onClose: () => void;
  onDone: () => void;
}

/**
 * One window for removing a user: what the person is responsible for (approval positions, department head, warehouse keeper,
 * waiting orders) and, for each, who takes it over, or «leave empty» (shown in red: that step then has nobody). Nothing is chosen
 * for the administrator: every responsibility needs an answer. Confirmed with the administrator's own password.
 */
export function DeleteUserDialog({ user, onClose, onDone }: Props) {
  const { push } = useToast();
  const [info, setInfo] = useState<RemovalInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pendingReceiver, setPendingReceiver] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setInfo(null);
    setError(null);
    setAnswers({});
    setPendingReceiver("");
    setPassword("");
    let cancelled = false;
    fetch(`/api/admin/users/${user.id}/removal`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setError(body.error ?? "Мэдээлэл татаж чадсангүй");
        else setInfo(body as RemovalInspection);
      })
      .catch(() => !cancelled && setError("Мэдээлэл татаж чадсангүй"));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const responsibilities = info?.responsibilities ?? [];
  const pendingCount = info?.pending.requests ?? 0;
  const allAnswered = responsibilities.every((r) => answers[r.key]);
  const pendingNeeded = pendingCount > 0;
  const canConfirm = !!info && allAnswered && (!pendingNeeded || !!pendingReceiver || coveredBySpecificAnswers()) && password.length > 0 && !busy;
  const emptied = responsibilities.filter((r) => answers[r.key] === EMPTY);

  /** waiting orders that every kind of answer already covers: only executive orders (they follow the Executive Director position) */
  function coveredBySpecificAnswers(): boolean {
    if (!info) return false;
    const exec = answers["position:EXECUTIVE_DIRECTOR"];
    return info.pending.executiveRequests === info.pending.requests && !!exec && exec !== EMPTY;
  }

  async function confirm() {
    if (!user || !info) return;
    setBusy(true);
    try {
      const transfers = Object.fromEntries(responsibilities.map((r) => [r.key, answers[r.key] === EMPTY ? null : answers[r.key]]));
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, transfers, pendingReceiverId: pendingReceiver && pendingReceiver !== CANCEL ? pendingReceiver : null, cancelPending: pendingReceiver === CANCEL }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ kind: "error", title: "Устгаж чадсангүй", description: body.error });
        return;
      }
      push({ kind: "success", title: `${user.name} устгагдлаа` });
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!user} onClose={onClose} title="Хэрэглэгч устгах" description={user ? `${user.name} (${user.email})` : undefined} className="max-w-2xl">
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {!info && !error && <p className="py-6 text-center text-sm text-text-muted">Юу хариуцдгийг шалгаж байна...</p>}
      {info && (
        <div className="space-y-4">
          {responsibilities.length === 0 && pendingCount === 0 ? (
            <p className="text-sm text-text-muted">Энэ хүн албан тушаал, цех, агуулах, хүлээгдэж буй захиалга хариуцаагүй байна.</p>
          ) : (
            <p className="text-sm text-text-muted">Энэ хүн доорх зүйлийг хариуцаж байна. Хэнд шилжүүлэхээ сонгоно уу.</p>
          )}

          {responsibilities.map((r) => (
            <div key={r.key} className="space-y-1.5 rounded-lg border border-border bg-bg-elevated/40 p-3">
              <p className="text-sm font-medium text-text">{r.title}</p>
              {(r.items > 0 || r.classification > 0) && (
                <p className="text-xs text-text-muted">
                  {r.items > 0 ? `Дуусаагүй ${r.items} материал` : ""}
                  {r.items > 0 && r.classification > 0 ? " · " : ""}
                  {r.classification > 0 ? `Ангилах ${r.classification} захиалга` : ""}
                </p>
              )}
              <select aria-label={`${r.title}: хэнд шилжүүлэх`} className={selectClass} value={answers[r.key] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [r.key]: e.target.value }))}>
                <option value="">Хэнд шилжүүлэх...</option>
                {r.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={EMPTY}>Хоосон үлдээх</option>
              </select>
              {r.candidates.length === 0 && <p className="text-xs text-text-muted">Шилжүүлэх боломжтой идэвхтэй хэрэглэгч алга.</p>}
              {answers[r.key] === EMPTY && (
                <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Энэ шат хүнгүй болно: хүн томилох хүртэл ажил гацна.
                </p>
              )}
            </div>
          ))}

          {pendingCount > 0 && (
            <div className="space-y-1.5 rounded-lg border border-border bg-bg-elevated/40 p-3">
              <p className="text-sm font-medium text-text">Хүлээгдэж буй захиалга: {pendingCount}</p>
              <p className="text-xs text-text-muted">Энэ хүний батлах ээлжинд байгаа захиалгыг шинэ хүнд дахин онооно.{info.pending.executiveRequests > 0 ? ` (${info.pending.executiveRequests} нь гүйцэтгэх захирлын баталгаа: «Гүйцэтгэх захирал» албан тушаалын шинэ эзэнд очно)` : ""}</p>
              <select aria-label="Хүлээгдэж буй захиалгыг хэнд шилжүүлэх" className={selectClass} value={pendingReceiver} onChange={(e) => setPendingReceiver(e.target.value)}>
                <option value="">Хэнд шилжүүлэх...</option>
                {info.pending.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={CANCEL}>Захиалгыг цуцлах</option>
              </select>
              {pendingReceiver === CANCEL && (
                <p role="alert" className="text-xs font-medium text-warning">
                  {info.pending.cancellable} захиалга цуцлагдана (шалтгаан: «Хэрэглэгч устгагдсан (админ)», захиалагчид мэдэгдэнэ).
                </p>
              )}
              {info.pending.candidates.length === 0 && <p className="text-xs text-text-muted">Шилжүүлэх боломжтой ижил эрхтэй идэвхтэй хэрэглэгч алга.</p>}
            </div>
          )}

          {info.strayItems > 0 && (
            <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {info.strayItems} дуусаагүй худалдан авалтын материал хариуцагчгүй үлдэнэ.
            </p>
          )}
          {emptied.length > 0 && <p className="text-xs text-danger">Хоосон үлдээх: {emptied.map((r) => r.title).join(", ")}</p>}

          <label className="block space-y-1">
            <span className="text-xs text-text-muted">Админы нууц үг (баталгаажуулах)</span>
            <input type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Таны нууц үг" />
          </label>
          <p className="text-xs text-text-muted">Түүхгүй бол бүрмөсөн устна. Түүхтэй (баталсан захиалга, аудит) бол жагсаалтаас нуугдаж, нэвтрэх боломжгүй болно; имэйл чөлөөлөгдөж, хэн юу баталсан нь хэвээр үлдэнэ.</p>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Болих
            </Button>
            <Button variant="danger" onClick={() => void confirm()} disabled={!canConfirm} loading={busy}>
              Устгах
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
