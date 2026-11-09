"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, History, PlusCircle, Send, Undo2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { PinModal } from "@/components/workflow/PinModal";
import type { ApprovalItemSummary, ApprovalSummary, DeferredRequestView } from "@/lib/executive-approval";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";

const qty = (v: number) => formatNumber(v, 3);
const inputClass = "focus-ring h-11 w-full rounded-lg border border-border bg-bg-surface px-3 text-sm text-text";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const KIND_LABEL: Record<string, string> = {
  INITIAL_FULL: "Бүрэн баталсан",
  INITIAL_PARTIAL: "Хэсэгчлэн баталсан",
  SUBSEQUENT: "Нэмэлт баталсан",
  DEFERRED_RETURN: "Хүсэлтийг буцаасан",
};
const REQUEST_STATUS_LABEL: Record<DeferredRequestView["status"], string> = {
  PENDING: "Хүлээгдэж байна",
  APPROVED: "Бүрэн батлагдсан",
  PARTIALLY_APPROVED: "Хэсэгчлэн батлагдсан",
  RETURNED: "Буцаагдсан",
};
const REQUEST_STATUS_TONE: Record<DeferredRequestView["status"], string> = {
  PENDING: "bg-warning/15 text-warning",
  APPROVED: "bg-success/15 text-success",
  PARTIALLY_APPROVED: "bg-accent/15 text-accent",
  RETURNED: "bg-danger/15 text-danger",
};

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Серверийн алдаа (${res.status})`);
  return body;
}

type Mode = null | { kind: "approve"; request: DeferredRequestView | null } | { kind: "return"; request: DeferredRequestView } | { kind: "ask" };

/**
 * Executive partial approval for one request: approved vs deferred quantities,
 * the full decision history, the executive's controls (approve more with PIN,
 * return a procurement officer's request) and the procurement officer's
 * "request additional approval" form. Everything is decided server-side; the
 * limits shown here only guide the input.
 */
export function ExecutiveApprovalPanel({ requestId, viewerName, viewerRoleLabel }: { requestId: string; viewerName: string; viewerRoleLabel: string }) {
  const { push } = useToast();
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // One idempotency key per open form: a retry of the same submission is applied once.
  const attemptKey = useRef(newKey());

  const load = useCallback(async () => {
    try {
      setSummary(await call(`/api/requests/${requestId}/executive-approval`));
    } catch {
      /* the panel simply stays hidden when the summary cannot be read */
    }
  }, [requestId]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  if (!summary || (summary.decisions.length === 0 && summary.deferredRequests.length === 0)) return null;

  // The executive may decide on every deferred item; an officer may only ask about the items assigned to them.
  const deferredItems = summary.items.filter((i) => i.deferredQuantity > 0 && (summary.viewerCanRequest ? i.viewerMayRequest : true));

  function open(next: Exclude<Mode, null>) {
    const initial: Record<string, string> = {};
    if (next.kind === "approve") {
      for (const i of deferredItems) {
        const proposed = next.request?.items.find((p) => p.itemId === i.itemId);
        if (next.request) initial[i.itemId] = proposed ? String(Math.min(proposed.requestedQuantity, i.deferredQuantity)) : "";
        else initial[i.itemId] = "";
      }
    }
    setQuantities(initial);
    setText("");
    setFormError(null);
    setPinError(null);
    attemptKey.current = newKey();
    setMode(next);
  }

  function close() {
    setMode(null);
    setPinOpen(false);
  }

  /** Quantities typed in the form, validated for guidance (the server validates again). */
  function readQuantities(limit: (i: ApprovalItemSummary) => number): { itemId: string; quantity: number }[] | null {
    const rows: { itemId: string; quantity: number }[] = [];
    for (const i of deferredItems) {
      const raw = (quantities[i.itemId] ?? "").trim().replace(",", ".");
      if (!raw) continue;
      const q = Number(raw);
      if (!Number.isFinite(q) || q <= 0) return setFormError(`${i.materialName}: тоо хэмжээ 0-с их байх ёстой`), null;
      if (Math.round(q * 1000) / 1000 !== q) return setFormError(`${i.materialName}: хамгийн ихдээ 3 орны нарийвчлал`), null;
      if (q > limit(i)) return setFormError(`${i.materialName}: хамгийн ихдээ ${qty(limit(i))} ${i.unit}`), null;
      rows.push({ itemId: i.itemId, quantity: q });
    }
    if (rows.length === 0) return setFormError("Хамгийн багадаа нэг материалын тоо хэмжээг оруулна уу"), null;
    return rows;
  }

  const limitFor = (i: ApprovalItemSummary) => {
    if (mode?.kind === "approve" && mode.request) {
      const proposed = mode.request.items.find((p) => p.itemId === i.itemId);
      return Math.min(proposed?.requestedQuantity ?? 0, i.deferredQuantity);
    }
    return i.deferredQuantity;
  };

  async function submitApprove(pin: string) {
    if (mode?.kind !== "approve" || !summary) return;
    const items = readQuantities(limitFor);
    if (!items) return setPinOpen(false);
    setBusy(true);
    setPinError(null);
    try {
      const next = await call(`/api/requests/${requestId}/executive-approval/decisions`, {
        method: "POST",
        body: JSON.stringify({
          action: "APPROVE",
          pin,
          items,
          comment: text.trim() || undefined,
          deferredRequestId: mode.request?.id,
          clientRequestId: attemptKey.current,
          expectedRevision: summary.revision,
        }),
      });
      setSummary(next);
      close();
      push({ kind: "success", title: "Нэмэлт тоо хэмжээг баталлаа" });
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Баталгаажуулж чадсангүй");
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function submitReturn() {
    if (mode?.kind !== "return" || !summary) return;
    if (!text.trim()) return setFormError("Буцаах шалтгаанаа бичнэ үү");
    setBusy(true);
    try {
      const next = await call(`/api/requests/${requestId}/executive-approval/decisions`, {
        method: "POST",
        body: JSON.stringify({ action: "RETURN", comment: text.trim(), deferredRequestId: mode.request.id, clientRequestId: attemptKey.current, expectedRevision: summary.revision }),
      });
      setSummary(next);
      close();
      push({ kind: "warning", title: "Хүсэлтийг буцаалаа", description: "Өмнө батлагдсан тоо хэмжээ хэвээр үлдэнэ" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Буцааж чадсангүй");
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function submitAsk() {
    if (!summary) return;
    const items = readQuantities((i) => i.deferredQuantity);
    if (!items) return;
    if (!text.trim()) return setFormError("Шалтгаан эсвэл тайлбараа бичнэ үү");
    setBusy(true);
    try {
      const next = await call(`/api/requests/${requestId}/deferred-requests`, {
        method: "POST",
        body: JSON.stringify({ items, reason: text.trim(), clientRequestId: attemptKey.current }),
      });
      setSummary(next);
      close();
      push({ kind: "success", title: "Нэмэлт зөвшөөрлийн хүсэлт илгээгдлээ", description: "Гүйцэтгэх захиралд мэдэгдэл очлоо" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Илгээж чадсангүй");
      void load();
    } finally {
      setBusy(false);
    }
  }

  const pending = summary.pendingRequest;
  const fully = summary.authorizationStatus === "FULLY_AUTHORIZED";

  return (
    <>
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Гүйцэтгэх захирлын хэсэгчилсэн баталгаа</CardTitle>
          <span className={cn("rounded-md px-2 py-1 text-xs font-medium", fully ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
            {fully ? "Бүрэн батлагдсан" : "Хэсэгчлэн батлагдсан"}
          </span>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <div className="mb-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-text-muted">
              <span>
                Батлагдсан <b className="text-text">{qty(summary.authorizedTotal)}</b> / {qty(summary.requiredTotal)}
              </span>
              <span>
                Хойшлогдсон <b className="text-text">{qty(summary.deferredTotal)}</b>
              </span>
              <span className="font-medium text-text">{formatNumber(summary.approvalPercentage, 2)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={summary.approvalPercentage} aria-valuemin={0} aria-valuemax={100} aria-label="Батлагдсан хувь">
              <div className={cn("h-full rounded-full", fully ? "bg-success" : "bg-accent")} style={{ width: `${Math.min(100, summary.approvalPercentage)}%` }} />
            </div>
          </div>

          <ul className="space-y-2">
            {summary.items
              .filter((i) => i.requiredQuantity > 0)
              .map((i) => (
                <li key={i.itemId} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <p className="break-words font-medium text-text">{i.materialName}</p>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-5">
                    <div>
                      <dt className="text-text-muted">Хүссэн</dt>
                      <dd className="text-text">
                        {qty(i.requestedQuantity)} {i.unit}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Худалдан авах</dt>
                      <dd className="text-text">{qty(i.requiredQuantity)}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Батлагдсан</dt>
                      <dd className="font-medium text-success">
                        {qty(i.authorizedQuantity)} ({formatNumber(i.approvalPercentage, 2)}%)
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Хойшлогдсон</dt>
                      <dd className={cn("font-medium", i.deferredQuantity > 0 ? "text-warning" : "text-text")}>{qty(i.deferredQuantity)}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Худалдан авсан</dt>
                      <dd className="text-text">{qty(i.purchasedQuantity)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
          </ul>

          {pending && (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-3 text-sm">
              <p className="font-medium text-text">
                Нэмэлт зөвшөөрлийн хүсэлт · {pending.requestedByName} · {formatDateTime(pending.requestedAt)}
              </p>
              <p className="break-words text-text-muted">{pending.reason}</p>
              <ul className="text-xs text-text">
                {pending.items.map((p) => (
                  <li key={p.itemId} className="break-words">
                    {p.materialName}: +{qty(p.requestedQuantity)} {p.unit}
                  </li>
                ))}
              </ul>
              {summary.viewerCanDecide && (
                <div className="no-print flex flex-wrap gap-2 pt-1">
                  <Button variant="danger" onClick={() => open({ kind: "return", request: pending })}>
                    <Undo2 className="size-4" /> Буцаах
                  </Button>
                  <Button variant="success" onClick={() => open({ kind: "approve", request: pending })}>
                    <CheckCircle2 className="size-4" /> Батлах
                  </Button>
                </div>
              )}
              {!summary.viewerCanDecide && <p className="text-xs text-text-muted">Гүйцэтгэх захирлын шийдвэр хүлээгдэж байна</p>}
            </div>
          )}

          <div className="no-print flex flex-wrap gap-2">
            {summary.viewerCanDecide && !pending && (
              <Button onClick={() => open({ kind: "approve", request: null })}>
                <PlusCircle className="size-4" /> Нэмэлт тоо хэмжээ батлах
              </Button>
            )}
            {summary.viewerCanRequest && (
              <Button onClick={() => open({ kind: "ask" })}>
                <Send className="size-4" /> Нэмэлт зөвшөөрөл хүсэх
              </Button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="focus-ring inline-flex min-h-11 items-center gap-1 text-xs text-text-muted hover:text-text"
          >
            <History className="size-3.5" /> Шийдвэрийн түүх ({summary.decisions.length}) · Хүсэлтүүд ({summary.deferredRequests.length})
          </button>
          {showHistory && (
            <div className="space-y-3">
              <ol className="space-y-2">
                {summary.decisions.map((d) => (
                  <li key={d.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                    <p className="break-words font-medium text-text">
                      №{d.sequence} · {KIND_LABEL[d.kind] ?? d.kind} · {d.decidedByName}
                    </p>
                    <p className="text-xs text-text-muted">
                      {formatDateTime(d.decidedAt)} · Нийт {formatNumber(d.approvalPercentage, 2)}% ({qty(d.approvedTotalAfter)}/{qty(d.requiredTotal)})
                    </p>
                    {d.comment && <p className="mt-1 break-words text-text">{d.comment}</p>}
                    <ul className="mt-1 text-xs text-text-muted">
                      {d.allocations.map((a) => (
                        <li key={a.itemId} className="break-words">
                          {a.materialName}: +{qty(a.quantity)} {a.unit} (нийт {qty(a.cumulativeAfter)})
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
              {summary.deferredRequests.length > 0 && (
                <ul className="space-y-2">
                  {summary.deferredRequests.map((r) => (
                    <li key={r.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="break-words font-medium text-text">
                          {r.requestedByName} · {formatDateTime(r.requestedAt)}
                        </p>
                        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", REQUEST_STATUS_TONE[r.status])}>{REQUEST_STATUS_LABEL[r.status]}</span>
                      </div>
                      <p className="mt-1 break-words text-text-muted">{r.reason}</p>
                      <ul className="mt-1 text-xs text-text">
                        {r.items.map((p) => (
                          <li key={p.itemId} className="break-words">
                            {p.materialName}: хүссэн {qty(p.requestedQuantity)} {p.unit}
                            {p.approvedQuantity !== null && ` · батлагдсан ${qty(p.approvedQuantity)}`}
                          </li>
                        ))}
                      </ul>
                      {r.decidedByName && (
                        <p className="mt-1 break-words text-xs text-text-muted">
                          {r.decidedByName} · {r.decidedAt && formatDateTime(r.decidedAt)}
                          {r.decisionComment && ` · ${r.decisionComment}`}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={(mode?.kind === "approve" && !pinOpen) || mode?.kind === "ask"}
        onClose={close}
        title={mode?.kind === "ask" ? "Нэмэлт зөвшөөрөл хүсэх" : "Нэмэлт тоо хэмжээ батлах"}
        description={
          mode?.kind === "ask"
            ? "Хойшлогдсон тоо хэмжээнээс хэдийг нэмж батлуулахыг оруулна уу. Та өөрөө батлах эрхгүй, гүйцэтгэх захирал шийднэ."
            : mode?.kind === "approve" && mode.request
              ? "Менежерийн хүсэлтээс бүгдийг эсвэл хэсгийг нь батлах боломжтой."
              : "Одоо нэмж батлах тоо хэмжээг оруулна уу. Үлдсэн хэсэг хойшлогдсон хэвээр байна."
        }
      >
        <div className="space-y-3">
          {deferredItems.map((i) => {
            const max = limitFor(i);
            const disabled = mode?.kind === "approve" && !!mode.request && max <= 0;
            return (
              <label key={i.itemId} className="block space-y-1 text-xs text-text-muted">
                <span className="break-words">
                  {i.materialName} — хойшлогдсон {qty(i.deferredQuantity)} {i.unit}
                  {mode?.kind === "approve" && mode.request ? ` · хүссэн ${qty(max)}` : ""}
                </span>
                <input
                  inputMode="decimal"
                  disabled={disabled}
                  value={quantities[i.itemId] ?? ""}
                  onChange={(e) => setQuantities((q) => ({ ...q, [i.itemId]: e.target.value }))}
                  placeholder={`0 – ${qty(max)}`}
                  className={inputClass}
                />
              </label>
            );
          })}
          <label className="block space-y-1 text-xs text-text-muted">
            {mode?.kind === "ask" ? "Шалтгаан, тайлбар (заавал)" : "Тайлбар (заавал биш)"}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="focus-ring w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text" />
          </label>
          {formError && (
            <p role="alert" className="text-xs text-danger">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={busy}>
              Болих
            </Button>
            {mode?.kind === "ask" ? (
              <Button onClick={() => void submitAsk()} loading={busy}>
                Илгээх
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setFormError(null);
                  if (readQuantities(limitFor)) {
                    setPinError(null);
                    setPinOpen(true);
                  }
                }}
              >
                Үргэлжлүүлэх
              </Button>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={mode?.kind === "return"} onClose={close} title="Хүсэлтийг буцаах" description="Өмнө батлагдсан тоо хэмжээ хүчингүй болохгүй. Буцаах шалтгаанаа бичнэ үү.">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="focus-ring w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text" />
        {formError && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {formError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Болих
          </Button>
          <Button variant="danger" onClick={() => void submitReturn()} loading={busy}>
            Буцаах
          </Button>
        </div>
      </Modal>

      <PinModal open={pinOpen} onClose={() => setPinOpen(false)} onConfirm={(pin) => void submitApprove(pin)} approverName={viewerName} approverRole={viewerRoleLabel} processing={busy} error={pinError} />
    </>
  );
}
