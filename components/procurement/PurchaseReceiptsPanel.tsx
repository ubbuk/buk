"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, FileText, Plus, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { AttachmentPicker } from "@/components/attachments/AttachmentPicker";
import { UploadQueueList } from "@/components/attachments/UploadQueueList";
import { useUploadQueue } from "@/components/attachments/useUploadQueue";
import { finalizeUploads } from "@/lib/attachment-client";
import { RECEIPT_KINDS, RECEIPT_KIND_LABEL, type ReceiptKind } from "@/lib/purchase-receipt-core";
import type { ReceiptItemView, ReceiptsOverview, ReceiptView } from "@/lib/purchase-receipts";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { cn, formatDate, formatFileSize, formatNumber } from "@/lib/utils";

const money = (v: number | null) => (v === null ? "—" : `${formatNumber(v, 2)}₮`);
const inputClass = "focus-ring h-10 w-full rounded-lg border border-border bg-bg-surface px-3 text-sm text-text placeholder:text-text-muted";
const base = (requestId: string) => `/api/requests/${requestId}/procurement/receipts`;

/**
 * Purchase receipts of a request: per purchased row (and for the whole purchase), the files with their kind / supplier /
 * number / date / amount, and the receipts-vs-purchases comparison. The Manager (`overview.editable` and `canAttach`) adds
 * and removes them from a phone (camera, gallery, document); everybody who may see the request just reads, zooms in and
 * compares (the Chief Accountant reviews here).
 */
export function PurchaseReceiptsPanel({ requestId, title = "Худалдан авалтын баримтууд", refreshKey }: { requestId: string; title?: string; refreshKey?: unknown }) {
  const { push } = useToast();
  const [overview, setOverview] = useState<ReceiptsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReceiptView | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base(requestId), { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Баримтыг татаж чадсангүй");
      setOverview(body as ReceiptsOverview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Баримтыг татаж чадсангүй");
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  useLiveRefresh(load);

  async function remove(r: ReceiptView) {
    try {
      const res = await fetch(`${base(requestId)}/${r.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Устгаж чадсангүй");
      push({ kind: "success", title: "Баримт устгагдлаа" });
    } catch (err) {
      push({ kind: "error", title: "Устгаж чадсангүй", description: err instanceof Error ? err.message : undefined });
    }
    await load();
  }

  if (error && !overview) return <p className="text-sm text-text-muted">{error}</p>;
  if (!overview) return <p className="text-sm text-text-muted">Баримт татаж байна...</p>;
  if (overview.items.length === 0 && overview.wholePurchase.length === 0) return null;

  const c = overview.comparison;
  return (
    <Card data-testid="purchase-receipts">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {overview.missingCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">
            <AlertTriangle className="size-3.5" aria-hidden /> {overview.missingCount} мөрөнд баримт алга
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
            <CheckCircle2 className="size-3.5" aria-hidden /> Бүх мөрөнд баримттай
          </span>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <Comparison c={c} waived={overview.waivedCount} />

        {overview.items.map((item) => (
          <ItemBlock key={item.itemId} requestId={requestId} item={item} onChanged={load} onPreview={setPreview} onRemove={remove} />
        ))}

        {(overview.wholePurchase.length > 0 || overview.canAttachWhole) && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-text">Нийт худалдан авалтын баримт</p>
            <p className="text-xs text-text-muted">Бүх мөрийг хамарсан нэг баримт (жишээ нь нэг падаан).</p>
            <ReceiptList requestId={requestId} receipts={overview.wholePurchase} onPreview={setPreview} onRemove={remove} />
            {overview.canAttachWhole && <AddReceipt requestId={requestId} itemId={null} onAdded={load} />}
          </div>
        )}
      </CardBody>
      <Lightbox requestId={requestId} receipt={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

function Comparison({ c, waived }: { c: ReceiptsOverview["comparison"]; waived: number }) {
  const tone = c.receipts === 0 ? "text-text-muted" : c.matches ? "text-success" : "text-warning";
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-bg-elevated/40 p-3 text-sm sm:grid-cols-4" data-testid="receipt-comparison">
      <div>
        <p className="text-xs text-text-muted">Худалдан авалтын нийт дүн</p>
        <p className="font-medium text-text">{money(c.purchased)}</p>
      </div>
      <div>
        <p className="text-xs text-text-muted">Баримтын нийт дүн</p>
        <p className="font-medium text-text">{c.receipts > 0 || c.receiptsWithoutAmount === 0 ? money(c.receipts) : "—"}</p>
      </div>
      <div>
        <p className="text-xs text-text-muted">Зөрүү</p>
        <p className={cn("font-medium", tone)}>{c.receipts === 0 ? "—" : `${c.difference > 0 ? "+" : ""}${money(c.difference)}`}</p>
      </div>
      <div>
        <p className="text-xs text-text-muted">Үр дүн</p>
        <p className={cn("font-medium", tone)}>
          {c.matches ? "Таарч байна" : c.receipts === 0 && c.receiptsWithoutAmount > 0 ? "Баримтад дүн оруулаагүй" : c.receipts === 0 ? "Баримтын дүн алга" : "Таарахгүй байна"}
        </p>
        {c.receiptsWithoutAmount > 0 && c.receipts > 0 && <p className="text-[11px] text-text-muted">{c.receiptsWithoutAmount} баримтад дүн оруулаагүй</p>}
        {waived > 0 && <p className="text-[11px] text-danger">{waived} мөр баримтгүй (шалтгаантай)</p>}
      </div>
    </div>
  );
}

function ItemBlock({ requestId, item, onChanged, onPreview, onRemove }: { requestId: string; item: ReceiptItemView; onChanged: () => Promise<void>; onPreview: (r: ReceiptView) => void; onRemove: (r: ReceiptView) => void }) {
  const { push } = useToast();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const noOwn = item.receipts.length === 0;

  async function waive() {
    setBusy(true);
    try {
      const res = await fetch(`${base(requestId)}/waive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.itemId, reason }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Хадгалж чадсангүй");
      setReasonOpen(false);
      setReason("");
      await onChanged();
    } catch (err) {
      push({ kind: "error", title: "Хадгалж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("space-y-2 rounded-lg border p-3", item.missing ? "border-danger/50 bg-danger/5" : item.waiver && noOwn ? "border-danger/30 bg-danger/5" : "border-border")} data-testid={`receipt-item-${item.itemId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-text">
          {item.lineNo}. {item.materialName}
        </p>
        <p className="text-xs text-text-muted">
          Авсан дүн: <span className="font-medium text-text">{money(item.purchasedTotal)}</span>
          {item.receiptAmount !== null && (
            <>
              {" "}
              · Баримтаар: <span className={cn("font-medium", Math.abs(item.receiptAmount - item.purchasedTotal) < 1 ? "text-success" : "text-warning")}>{money(item.receiptAmount)}</span>
            </>
          )}
        </p>
      </div>

      {item.missing && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
          <AlertTriangle className="size-3.5" aria-hidden /> Баримт хавсаргаагүй
        </p>
      )}
      {item.waiver && noOwn && (
        <p className="text-xs font-medium text-danger">
          Баримтгүй — {item.waiver.reason} <span className="font-normal text-text-muted">({item.waiver.byName}, {formatDate(item.waiver.at)})</span>
        </p>
      )}

      <ReceiptList requestId={requestId} receipts={item.receipts} onPreview={onPreview} onRemove={onRemove} />

      {item.canAttach && (
        <div className="space-y-2">
          <AddReceipt requestId={requestId} itemId={item.itemId} onAdded={onChanged} />
          {noOwn && !reasonOpen && (
            <button type="button" className="focus-ring text-xs text-text-muted underline" onClick={() => setReasonOpen(true)}>
              Баримтгүй — шалтгаан бичих
            </button>
          )}
          {reasonOpen && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Яагаад баримт байхгүй вэ?" aria-label="Баримтгүй байгаа шалтгаан" />
              <Button size="sm" variant="secondary" onClick={() => void waive()} loading={busy} disabled={reason.trim().length < 3}>
                Хадгалах
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReceiptList({ requestId, receipts, onPreview, onRemove }: { requestId: string; receipts: ReceiptView[]; onPreview: (r: ReceiptView) => void; onRemove: (r: ReceiptView) => void }) {
  if (receipts.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="receipt-list">
      {receipts.map((r) => {
        const image = r.mimeType.startsWith("image/");
        const href = `${base(requestId)}/${r.id}`;
        const thumb = (
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-surface text-text-muted">
            {image ? (
              // private, authenticated bytes: next/image cannot optimise them
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.hasThumb ? `${href}?thumb=1` : href} alt="" loading="lazy" className="size-full object-cover" />
            ) : (
              <FileText className="size-6" aria-hidden />
            )}
          </div>
        );
        return (
          <li key={r.id} className="flex items-stretch gap-2 rounded-lg border border-border bg-bg-elevated/40 p-2">
            {image ? (
              <button type="button" onClick={() => onPreview(r)} className="focus-ring shrink-0 rounded-md" aria-label={`${r.fileName}: томруулж харах`}>
                {thumb}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer" className="focus-ring shrink-0 rounded-md" aria-label={`${r.fileName}: нээх`}>
                {thumb}
              </a>
            )}
            <div className="min-w-0 flex-1 text-xs">
              <p className="font-medium text-text">{r.kindLabel}</p>
              <p className="truncate text-text-muted">{[r.supplierName, r.receiptNumber && `№${r.receiptNumber}`, r.receiptDate && formatDate(r.receiptDate)].filter(Boolean).join(" · ") || r.fileName}</p>
              <p className="text-text">{r.amount !== null ? money(r.amount) : <span className="text-text-muted">дүн оруулаагүй</span>}</p>
              <p className="text-[11px] text-text-muted">
                {r.uploadedByName} · {formatFileSize(r.sizeBytes)}
              </p>
            </div>
            {r.canRemove && (
              <button type="button" onClick={() => void onRemove(r)} className="focus-ring inline-flex size-11 shrink-0 items-center justify-center self-center rounded-lg text-text-muted hover:text-danger" aria-label={`${r.fileName}: устгах`} title="Устгах">
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Collapsed "+ Баримт нэмэх"; opened: kind, optional details, then camera / gallery / document. */
function AddReceipt({ requestId, itemId, onAdded }: { requestId: string; itemId: string | null; onAdded: () => Promise<void> }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReceiptKind>("WAYBILL");
  const [supplier, setSupplier] = useState("");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const queue = useUploadQueue({ onReject: (message) => push({ kind: "error", title: "Файл хавсаргах боломжгүй", description: message }) });

  const parsedAmount = amount.trim() === "" ? null : Number(amount.replace(/[,\s]/g, ""));
  const amountBad = parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0);

  async function run() {
    const { refs, failed } = await queue.upload({ presignUrl: `${base(requestId)}/presign`, presignExtra: { itemId } });
    if (refs.length > 0) {
      try {
        await finalizeUploads(`${base(requestId)}/finalize`, refs, {
          itemId,
          kind,
          supplierName: supplier.trim() || null,
          receiptNumber: number.trim() || null,
          receiptDate: date || null,
          amount: parsedAmount,
        });
        queue.consume(refs);
        push({ kind: "success", title: "Баримт хавсаргагдлаа" });
        setSupplier("");
        setNumber("");
        setDate("");
        setAmount("");
        setOpen(false);
        await onAdded();
      } catch (err) {
        push({ kind: "error", title: "Баримт хавсаргахад алдаа гарлаа", description: err instanceof Error ? err.message : undefined });
      }
    }
    if (failed > 0) push({ kind: "error", title: `${failed} файл илгээгдсэнгүй`, description: "Жагсаалтаас «Дахин оролдох» товчийг дарна уу" });
  }

  async function pick(files: File[]) {
    if (files.length === 0 || amountBad) return;
    await queue.add(files);
    await run();
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} className="min-h-11">
        <Plus className="size-4" /> Баримт нэмэх
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-accent/30 bg-bg-surface p-3" data-testid="add-receipt">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-text-muted">
          Баримтын төрөл
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as ReceiptKind)}>
            {RECEIPT_KINDS.map((k) => (
              <option key={k} value={k}>
                {RECEIPT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-text-muted">
          Нийлүүлэгчийн нэр (заавал биш)
          <input className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={200} />
        </label>
        <label className="space-y-1 text-xs text-text-muted">
          Баримтын дугаар (заавал биш)
          <input className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={100} />
        </label>
        <label className="space-y-1 text-xs text-text-muted">
          Огноо (заавал биш)
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-text-muted sm:col-span-2">
          Дүн ₮ (заавал биш)
          <input inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amountBad} />
        </label>
      </div>
      {amountBad && <p className="text-xs text-danger">Дүн буруу байна</p>}
      <AttachmentPicker onPick={(files) => void pick(files)} disabled={amountBad} />
      <UploadQueueList items={queue.items} onRemove={queue.remove} onRetry={() => void run()} />
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Хаах
        </Button>
      </div>
    </div>
  );
}

/** Full-screen receipt viewer with a zoom toggle (a printed receipt has to be readable). Escape closes it. */
function Lightbox({ requestId, receipt, onClose }: { requestId: string; receipt: ReceiptView | null; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    setZoom(false);
    if (!receipt) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt]);
  if (typeof document === "undefined" || !receipt) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" role="dialog" aria-label="Баримт">
      <div className="flex items-center justify-between gap-2 p-3 text-xs text-white">
        <span className="min-w-0 truncate">
          {receipt.kindLabel}
          {receipt.receiptNumber ? ` · №${receipt.receiptNumber}` : ""}
          {receipt.amount !== null ? ` · ${money(receipt.amount)}` : ""}
        </span>
        <span className="flex shrink-0 gap-2">
          <button type="button" onClick={() => setZoom((z) => !z)} className="focus-ring inline-flex size-11 items-center justify-center rounded-full bg-white/15" aria-label={zoom ? "Багасгах" : "Томруулах"}>
            {zoom ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
          </button>
          <button type="button" onClick={onClose} className="focus-ring inline-flex size-11 items-center justify-center rounded-full bg-white/15" aria-label="Хаах">
            <X className="size-5" />
          </button>
        </span>
      </div>
      <div className={cn("min-h-0 flex-1", zoom ? "overflow-auto" : "flex items-center justify-center overflow-hidden")} onClick={() => !zoom && onClose()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${base(requestId)}/${receipt.id}`}
          alt={receipt.fileName}
          onClick={(e) => {
            e.stopPropagation();
            setZoom((z) => !z);
          }}
          className={zoom ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}
          style={zoom ? { width: "250%" } : undefined}
        />
      </div>
    </div>,
    document.body
  );
}
