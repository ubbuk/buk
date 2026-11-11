"use client";

import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FT_MESSAGE_MAX } from "@/lib/foreign-trade-validation";
import type { FtOrderView } from "@/lib/foreign-trade";
import { cn, formatDateTime } from "@/lib/utils";
import { AttachmentList, FilePicker } from "./AttachmentList";
import { checkFilesClient, ftApi, textareaClass } from "./api";
import { HoloEmpty, HoloPanel } from "./holo/HoloPanel";

const ROLE_LABEL: Record<string, string> = { BOSS: "Цехийн дарга", MANAGER: "MANAGER", DIRECTOR: "Захирал", ENGINEERING: "Инженер", CHIEF_ACCOUNTANT: "Санхүү", ADMIN: "Админ" };

export function DiscussionPanel({ order, currentUserId, onChange }: { order: FtOrderView; currentUserId: string; onChange: () => void }) {
  const messages = order.messages;
  const [body, setBody] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const count = messages?.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [count]);

  if (messages === null) return null;
  const quotes = order.quotes ?? [];

  async function send() {
    setError(null);
    const fileError = checkFilesClient(files);
    if (fileError) return setError(fileError);
    if (!body.trim() && files.length === 0) return setError("Мессеж бичих эсвэл файл хавсаргана уу");
    setBusy(true);
    const form = new FormData();
    form.set("body", body);
    if (quoteId) form.set("quoteId", quoteId);
    files.forEach((f) => form.append("files", f));
    const r = await ftApi(`/api/foreign-trade/${order.id}/messages`, { form });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setBody("");
    setFiles([]);
    setQuoteId("");
    onChange();
  }

  return (
    <HoloPanel
      id="discussion"
      icon={<MessagesSquare className="size-6" />}
      title={`Хэлэлцүүлэг (${messages.length})`}
      actions={<span className="text-xs text-text-muted">Цехийн дарга · MANAGER · Үйлдвэр хариуцсан захирал · Ерөнхий инженер</span>}
      bodyClassName="space-y-2.5"
    >
      <>
        {messages.length === 0 ? (
          <HoloEmpty art="chat" icon={<MessagesSquare className="size-9" />} title="Хэлэлцүүлэг эхлээгүй байна.">
            Захиалгатай холбоотой санал, асуулт, тайлбар энд харагдана.
          </HoloEmpty>
        ) : (
          <ul className="max-h-[480px] space-y-3 overflow-y-auto pr-1" aria-live="polite">
            {messages.map((m) => {
              const mine = m.author.id === currentUserId;
              const quote = m.quoteId ? quotes.find((q) => q.id === m.quoteId) : null;
              return (
                <li key={m.id} className={cn("max-w-[92%] space-y-1.5 rounded-xl border px-3 py-2.5", mine ? "ml-auto border-accent/30 bg-accent/10" : "border-border bg-bg-elevated/40")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-text-muted">
                    <span className="font-medium text-text">
                      {m.author.name} <span className="font-normal text-text-muted">· {m.author.title ?? ROLE_LABEL[m.author.role] ?? m.author.role}</span>
                    </span>
                    <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
                  </div>
                  {quote && <div className="rounded-md bg-bg-surface px-2 py-1 text-xs text-accent">Санал: {quote.supplierName} ({quote.country})</div>}
                  {m.body && <p className="whitespace-pre-wrap break-words text-sm text-text">{m.body}</p>}
                  <AttachmentList orderId={order.id} items={m.attachments} />
                </li>
              );
            })}
            <div ref={endRef} />
          </ul>
        )}

        {order.access.postMessage ? (
          <div className="space-y-2 border-t border-border pt-2.5">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={FT_MESSAGE_MAX} placeholder="Санал, асуултаа бичнэ үү" aria-label="Мессеж" className={textareaClass} />
            {quotes.length > 0 && (
              <select value={quoteId} onChange={(e) => setQuoteId(e.target.value)} aria-label="Хэлэлцэж буй нийлүүлэгчийн санал" className="focus-ring h-10 w-full rounded-lg border border-border bg-bg-surface px-3 text-sm text-text">
                <option value="">Нийлүүлэгчийн санал заахгүй</option>
                {quotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.supplierName} ({q.country})
                  </option>
                ))}
              </select>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <FilePicker files={files} onChange={setFiles} disabled={busy} />
              <Button onClick={send} loading={busy}>
                <Send className="size-4" /> Илгээх
              </Button>
            </div>
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-xs text-text-muted">Та хэлэлцүүлгийн түүхийг харах боломжтой, мессеж бичих эрхгүй.</p>
        )}
      </>
    </HoloPanel>
  );
}
