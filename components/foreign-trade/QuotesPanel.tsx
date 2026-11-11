"use client";

import { useState } from "react";
import { BarChart3, CheckCircle2, Pencil, Plus, Send, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { compareQuotes, FT_CURRENCIES } from "@/lib/foreign-trade-rules";
import { ftQuoteSchema } from "@/lib/foreign-trade-validation";
import type { FtOrderView, FtQuoteView } from "@/lib/foreign-trade";
import { cn, formatNumber } from "@/lib/utils";
import { AttachmentList, FilePicker } from "./AttachmentList";
import { checkFilesClient, ftApi, inputClass, textareaClass } from "./api";
import { HoloEmpty, HoloPanel } from "./holo/HoloPanel";

interface Draft {
  supplierName: string;
  country: string;
  currency: string;
  price: string;
  shippingCost: string;
  leadTimeDays: string;
  warranty: string;
  note: string;
}

const emptyDraft: Draft = { supplierName: "", country: "", currency: "USD", price: "", shippingCost: "", leadTimeDays: "", warranty: "", note: "" };
const toDraft = (q: FtQuoteView): Draft => ({
  supplierName: q.supplierName,
  country: q.country,
  currency: q.currency,
  price: String(q.price),
  shippingCost: q.shippingCost ? String(q.shippingCost) : "",
  leadTimeDays: q.leadTimeDays == null ? "" : String(q.leadTimeDays),
  warranty: q.warranty ?? "",
  note: q.note ?? "",
});
const num = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(",", ".")));

function Chip({ tone, children }: { tone: "success" | "accent"; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tone === "success" ? "bg-success/15 text-success" : "bg-accent/15 text-accent")}>{children}</span>;
}

export function QuotesPanel({ order, onChange }: { order: FtOrderView; onChange: () => void }) {
  const toast = useToast();
  const quotes = order.quotes;
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<FtQuoteView | null>(null);
  const [rationale, setRationale] = useState("");

  if (quotes === null) {
    return (
      <HoloPanel id="quotes" icon={<Users className="size-6" />} title="Нийлүүлэгчдийн үнийн судалгаа">
        <HoloEmpty art="chart" icon={<BarChart3 className="size-9" />} title="Үнийн судалгааг MANAGER танилцуулсны дараа энд харагдана." />
      </HoloPanel>
    );
  }

  const { access } = order;
  const metrics = compareQuotes(quotes);
  const selectedId = order.selection?.quoteId ?? null;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  async function saveQuote() {
    if (!editing) return;
    setError(null);
    const d = editing.draft;
    const parsed = ftQuoteSchema.safeParse({
      supplierName: d.supplierName,
      country: d.country,
      currency: d.currency,
      price: num(d.price),
      shippingCost: num(d.shippingCost),
      leadTimeDays: d.leadTimeDays.trim() === "" ? null : Number(d.leadTimeDays),
      warranty: d.warranty,
      note: d.note,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл");
    const fileError = checkFilesClient(files);
    if (fileError) return setError(fileError);

    setBusy(true);
    const r = editing.id
      ? await ftApi<{ selectionCleared: boolean }>(`/api/foreign-trade/${order.id}/quotes/${editing.id}`, { method: "PATCH", json: parsed.data })
      : await ftApi<{ id: string }>(`/api/foreign-trade/${order.id}/quotes`, { json: parsed.data });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    const quoteId = editing.id ?? (r.data as { id: string }).id;
    if (files.length) {
      const form = new FormData();
      form.set("quoteId", quoteId);
      files.forEach((f) => form.append("files", f));
      const up = await ftApi(`/api/foreign-trade/${order.id}/attachments`, { form });
      if (!up.ok) toast.push({ kind: "warning", title: "Санал хадгалагдсан боловч баримт хавсаргаж чадсангүй", description: up.error });
    }
    if (editing.id && (r.data as { selectionCleared: boolean }).selectionCleared) {
      toast.push({ kind: "info", title: "Сонгосон нийлүүлэгчийн санал өөрчлөгдсөн тул сонголт хүчингүй боллоо", description: "Нийлүүлэгчээ дахин сонгож үндэслэлээ бүртгэнэ үү" });
    }
    setBusy(false);
    setEditing(null);
    setFiles([]);
    onChange();
  }

  async function removeQuote(q: FtQuoteView) {
    if (!window.confirm(`«${q.supplierName}»-ийн саналыг устгах уу?`)) return;
    const r = await ftApi(`/api/foreign-trade/${order.id}/quotes/${q.id}`, { method: "DELETE" });
    if (!r.ok) toast.push({ kind: "error", title: "Устгаж чадсангүй", description: r.error });
    onChange();
  }

  async function share(target: "boss" | "technical") {
    const r = await ftApi(`/api/foreign-trade/${order.id}/share`, { json: { [target]: true } });
    if (!r.ok) return toast.push({ kind: "error", title: "Танилцуулж чадсангүй", description: r.error });
    toast.push({ kind: "success", title: target === "boss" ? "Үнийн судалгааг цехийн даргад танилцууллаа" : "Үнийн судалгааг техникийн хяналтад танилцууллаа" });
    onChange();
  }

  async function confirmSelection() {
    if (!selecting) return;
    setBusy(true);
    setError(null);
    const r = await ftApi(`/api/foreign-trade/${order.id}/selection`, { json: { quoteId: selecting.id, rationale } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSelecting(null);
    setRationale("");
    onChange();
  }

  const actions = (q: FtQuoteView) =>
    access.manageQuotes ? (
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={selectedId === q.id ? "success" : "secondary"} onClick={() => { setError(null); setRationale(order.selection?.quoteId === q.id ? order.selection.rationale : ""); setSelecting(q); }}>
          <CheckCircle2 className="size-3.5" /> {selectedId === q.id ? "Сонгосон" : "Сонгох"}
        </Button>
        <Button size="sm" variant="ghost" aria-label="Засах" onClick={() => { setError(null); setFiles([]); setEditing({ id: q.id, draft: toDraft(q) }); }}>
          <Pencil className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" aria-label="Устгах" onClick={() => removeQuote(q)}>
          <Trash2 className="size-3.5 text-danger" />
        </Button>
      </div>
    ) : null;

  const flags = (q: FtQuoteView) => (
    <div className="flex flex-wrap gap-1">
      {selectedId === q.id && <Chip tone="success">Сонгосон</Chip>}
      {metrics.get(q.id)?.cheapestInCurrency && <Chip tone="accent">Хамгийн хямд ({q.currency})</Chip>}
      {metrics.get(q.id)?.fastest && <Chip tone="accent">Хамгийн хурдан</Chip>}
    </div>
  );

  return (
    <>
      <HoloPanel
        id="quotes"
        icon={<Users className="size-6" />}
        title={`Нийлүүлэгчдийн үнийн судалгаа (${quotes.length})`}
        bodyClassName="space-y-3"
        actions={
          access.manageQuotes && (
            <>
            <Button size="sm" variant="secondary" disabled={order.sharedWithBoss} onClick={() => share("boss")}>
              <Send className="size-3.5" /> {order.sharedWithBoss ? "Цехийн даргад танилцуулсан" : "Цехийн даргад танилцуулах"}
            </Button>
            <Button size="sm" variant="secondary" disabled={order.sharedWithTechnical} onClick={() => share("technical")}>
              <Send className="size-3.5" /> {order.sharedWithTechnical ? "Техникийн хяналтад танилцуулсан" : "Техникийн хяналтад танилцуулах"}
            </Button>
            <Button size="sm" onClick={() => { setError(null); setFiles([]); setEditing({ id: null, draft: emptyDraft }); }}>
              <Plus className="size-3.5" /> Нийлүүлэгч нэмэх
            </Button>
            </>
          )
        }
      >
        {access.manageQuotes && quotes.length > 0 && <p className="text-xs text-text-muted">Цехийн даргад танилцуулах нь техникийн хяналтын баталгааг орлохгүй. Үнийг нийлүүлэгч бүрийн валютаар харуулна, валют хөрвүүлэхгүй.</p>}
        {quotes.length === 0 ? (
          <HoloEmpty art="chart" icon={<BarChart3 className="size-9" />} title="Нийлүүлэгчийн санал бүртгэгдээгүй байна.">
            {access.manageQuotes ? "Цехийн даргад танилцуулах нь техникийн хяналтын баталгааг орлохгүй. Үнийг нийлүүлэгч бүрийн валютаар харуулна, валют хөрвүүлэхгүй." : undefined}
          </HoloEmpty>
        ) : (
          <>
            {/* desktop: comparison table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="py-2 pr-3 font-medium">Нийлүүлэгч</th>
                    <th className="py-2 pr-3 font-medium">Улс</th>
                    <th className="py-2 pr-3 text-right font-medium">Үнэ</th>
                    <th className="py-2 pr-3 text-right font-medium">Тээвэр</th>
                    <th className="py-2 pr-3 text-right font-medium">Нийт</th>
                    <th className="py-2 pr-3 text-right font-medium">Хугацаа</th>
                    <th className="py-2 pr-3 font-medium">Баталгаа</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id} className={cn("border-b border-border/60 align-top", selectedId === q.id && "bg-success/5")}>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-text">{q.supplierName}</div>
                        <div className="mt-1">{flags(q)}</div>
                        {q.note && <div className="mt-1 max-w-xs text-xs text-text-muted">{q.note}</div>}
                        {q.attachments.length > 0 && <div className="mt-2 max-w-xs"><AttachmentList orderId={order.id} items={q.attachments} /></div>}
                      </td>
                      <td className="py-2.5 pr-3 text-text-muted">{q.country}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(q.price)} {q.currency}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(q.shippingCost)}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{formatNumber(metrics.get(q.id)!.total)} {q.currency}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{q.leadTimeDays == null ? "—" : `${q.leadTimeDays} өдөр`}</td>
                      <td className="py-2.5 pr-3 text-text-muted">{q.warranty ?? "—"}</td>
                      <td className="py-2.5">{actions(q)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* phone: one card per supplier */}
            <ul className="space-y-3 md:hidden">
              {quotes.map((q) => (
                <li key={q.id} className={cn("space-y-2 rounded-lg border border-border p-3", selectedId === q.id && "border-success/40 bg-success/5")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-text">{q.supplierName}</div>
                      <div className="text-xs text-text-muted">{q.country}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-semibold tabular-nums">{formatNumber(metrics.get(q.id)!.total)} {q.currency}</div>
                      <div className="text-xs text-text-muted">үнэ {formatNumber(q.price)} + тээвэр {formatNumber(q.shippingCost)}</div>
                    </div>
                  </div>
                  {flags(q)}
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div><dt className="text-text-muted">Нийлүүлэх хугацаа</dt><dd>{q.leadTimeDays == null ? "—" : `${q.leadTimeDays} өдөр`}</dd></div>
                    <div><dt className="text-text-muted">Баталгаат нөхцөл</dt><dd>{q.warranty ?? "—"}</dd></div>
                  </dl>
                  {q.note && <p className="text-xs text-text-muted">{q.note}</p>}
                  <AttachmentList orderId={order.id} items={q.attachments} />
                  {actions(q)}
                </li>
              ))}
            </ul>
          </>
        )}

        {order.selection && (
          <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
            <div className="font-medium text-success">Сонгосон нийлүүлэгч: {quotes.find((q) => q.id === order.selection!.quoteId)?.supplierName ?? "—"}</div>
            <p className="mt-1 whitespace-pre-wrap text-text">{order.selection.rationale}</p>
            <p className="mt-1 text-xs text-text-muted">Бүртгэсэн: {order.selection.by ?? "—"}</p>
          </div>
        )}
      </HoloPanel>

      <Modal open={editing !== null} onClose={() => !busy && setEditing(null)} title={editing?.id ? "Нийлүүлэгчийн санал засах" : "Нийлүүлэгч нэмэх"} description="Нийт захиалгын тоо хэмжээний үнэ, нийлүүлэгчийн валютаар">
        {editing && (
          <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
            <input value={editing.draft.supplierName} onChange={(e) => set({ supplierName: e.target.value })} placeholder="Нийлүүлэгчийн нэр" aria-label="Нийлүүлэгчийн нэр" className={inputClass} />
            <div className="grid grid-cols-2 gap-2">
              <input value={editing.draft.country} onChange={(e) => set({ country: e.target.value })} placeholder="Улс" aria-label="Улс" className={inputClass} />
              <input value={editing.draft.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 3) })} list="ft-currencies" placeholder="Валют" aria-label="Валют" className={inputClass} />
              <datalist id="ft-currencies">{FT_CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
              <input value={editing.draft.price} onChange={(e) => set({ price: e.target.value })} inputMode="decimal" placeholder="Үнэ" aria-label="Үнэ" className={inputClass} />
              <input value={editing.draft.shippingCost} onChange={(e) => set({ shippingCost: e.target.value })} inputMode="decimal" placeholder="Тээврийн зардал" aria-label="Тээврийн зардал" className={inputClass} />
              <input value={editing.draft.leadTimeDays} onChange={(e) => set({ leadTimeDays: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="Нийлүүлэх хугацаа (өдөр)" aria-label="Нийлүүлэх хугацаа" className={inputClass} />
              <input value={editing.draft.warranty} onChange={(e) => set({ warranty: e.target.value })} placeholder="Баталгаат нөхцөл" aria-label="Баталгаат нөхцөл" className={inputClass} />
            </div>
            <textarea value={editing.draft.note} onChange={(e) => set({ note: e.target.value })} rows={2} placeholder="Тэмдэглэл" aria-label="Тэмдэглэл" className={textareaClass} />
            <FilePicker files={files} onChange={setFiles} disabled={busy} label="Үнийн саналын баримт" />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Болих</Button>
              <Button onClick={saveQuote} loading={busy}>Хадгалах</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={selecting !== null} onClose={() => !busy && setSelecting(null)} title="Эцсийн нийлүүлэгч бүртгэх" description="Хэлэлцүүлгээр тохиролцсон нийлүүлэгч болон шийдвэрийн үндэслэлийг бүртгэнэ">
        {selecting && (
          <div className="space-y-3">
            <p className="text-sm text-text">{selecting.supplierName} · {selecting.country} · {formatNumber(selecting.price + selecting.shippingCost)} {selecting.currency}</p>
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={4} maxLength={4000} placeholder="Шийдвэрийн үндэслэл" aria-label="Шийдвэрийн үндэслэл" className={textareaClass} />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelecting(null)} disabled={busy}>Болих</Button>
              <Button onClick={confirmSelection} loading={busy} disabled={rationale.trim().length < 5}>Бүртгэх</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
