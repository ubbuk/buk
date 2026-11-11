"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Send, Tag } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ApprovalTimeline, OrderHistory } from "@/components/foreign-trade/ApprovalTimeline";
import { DecisionPanel } from "@/components/foreign-trade/DecisionPanel";
import { DiscussionPanel } from "@/components/foreign-trade/DiscussionPanel";
import { QuotesPanel } from "@/components/foreign-trade/QuotesPanel";
import { checkFilesClient, ftApi } from "@/components/foreign-trade/api";
import { OrderInfoPanel } from "@/components/foreign-trade/holo/OrderInfoPanel";
import { OrderSummary, QuickActions } from "@/components/foreign-trade/holo/OrderSummary";
import { SectionTabs } from "@/components/foreign-trade/holo/SectionTabs";
import s from "@/components/foreign-trade/holo/holo.module.css";
import type { FtOrderView } from "@/lib/foreign-trade";
import { FT_STATUS_LABEL } from "@/lib/foreign-trade-rules";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { cn, formatDateTime } from "@/lib/utils";

export default function ForeignTradeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const toast = useToast();
  const [order, setOrder] = useState<FtOrderView | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const load = useCallback(async () => {
    const r = await ftApi<FtOrderView>(`/api/foreign-trade/${id}`);
    if (r.ok) {
      setOrder(r.data);
      setError(null);
    } else setError({ status: r.status, message: r.error });
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  if (error && !order) {
    return <EmptyState title={error.status === 404 ? "Захиалга олдсонгүй" : "Ачаалж чадсангүй"} description={error.message} action={<Link href="/foreign-trade" className="text-sm text-accent underline">Жагсаалт руу буцах</Link>} />;
  }
  if (!order) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { access } = order;

  async function act(url: string, okTitle: string) {
    if (!order) return;
    setBusy(true);
    const r = await ftApi(url, { json: { expectedVersion: order.version } });
    setBusy(false);
    if (!r.ok) {
      toast.push({ kind: "error", title: "Үйлдэл амжилтгүй", description: r.error });
      if (r.status === 409) void load();
      return;
    }
    toast.push({ kind: "success", title: okTitle });
    void load();
  }

  async function uploadOrderFiles() {
    const fileError = checkFilesClient(files);
    if (fileError) return toast.push({ kind: "error", title: fileError });
    setBusy(true);
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const r = await ftApi(`/api/foreign-trade/${id}/attachments`, { form });
    setBusy(false);
    if (!r.ok) return toast.push({ kind: "error", title: "Файл хавсаргаж чадсангүй", description: r.error });
    setFiles([]);
    void load();
  }

  const canSendToTechnical = access.manageQuotes;
  const technicalBlocked = canSendToTechnical && !order.selection;
  const statusTone = order.status === "APPROVED" ? s.chipGreen : order.status === "RETURNED_TO_BOSS" || order.status === "RETURNED_TO_MANAGER" ? s.chipRed : undefined;

  return (
    <div className={s.root}>
      <div className="space-y-4">
        <header className={s.hero}>
          <div className={s.heroImg} aria-hidden="true" />
          <div className={s.heroEdge} aria-hidden="true" />
          <div className={s.heroBody}>
            <div className="min-w-0 space-y-2.5">
              <Link href="/foreign-trade" className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm text-text hover:text-white md:min-h-0">
                <ArrowLeft className="size-4" /> Гадаад худалдаа
              </Link>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className={s.orderNo}>
                  <span className={s.orderBar} aria-hidden="true" />
                  {order.orderNumber}
                </h2>
                <span className={cn(s.chip, statusTone)}>{FT_STATUS_LABEL[order.status]}</span>
                {order.waitingOnMe && <span className={s.chip}>Таны ээлж</span>}
              </div>
              <p className={s.metaRow}>
                <span className="inline-flex items-center gap-2">
                  <Tag className="size-4" />
                  {order.createdBy.name}
                  {order.createdBy.title ? ` · ${order.createdBy.title}` : ""}
                  {order.departmentName ? ` · ${order.departmentName}` : ""}
                </span>
                <span className="inline-flex items-center gap-2">
                  <CalendarDays className="size-4" />
                  {formatDateTime(order.createdAt)}
                </span>
              </p>
            </div>
            <div className={s.heroActions}>
              {access.submitOrder && (
                <Button loading={busy} onClick={() => act(`/api/foreign-trade/${order.id}/submit`, "Захиалга MANAGER руу илгээгдлээ")}>
                  <Send className="size-4" /> {order.status === "RETURNED_TO_BOSS" ? "Дахин илгээх" : "MANAGER руу илгээх"}
                </Button>
              )}
              {canSendToTechnical && (
                <Button loading={busy} disabled={technicalBlocked} title={technicalBlocked ? "Эхлээд сонгосон нийлүүлэгч, үндэслэлээ бүртгэнэ үү" : undefined} onClick={() => act(`/api/foreign-trade/${order.id}/submit-technical`, "Техникийн хяналтад илгээгдлээ")}>
                  <Send className="size-4" /> Техникийн хяналтад илгээх
                </Button>
              )}
            </div>
          </div>
        </header>

        {(order.status === "RETURNED_TO_MANAGER" || order.status === "RETURNED_TO_BOSS") && order.decisions.length > 0 && (
          <div role="status" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
            <p className="font-medium text-danger">Захиалга буцсан</p>
            <p className="mt-0.5 whitespace-pre-wrap text-text">{order.decisions[order.decisions.length - 1].reason}</p>
            <p className="mt-1 text-xs text-text-muted">{order.decisions[order.decisions.length - 1].decidedBy.name}</p>
          </div>
        )}

        <DecisionPanel order={order} onChange={load} />

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_clamp(17rem,16.4vw,19rem)]">
          <div className="min-w-0 space-y-4">
            <ApprovalTimeline order={order} />
            <OrderInfoPanel order={order} files={files} onFiles={setFiles} busy={busy} onUpload={uploadOrderFiles} />
            <QuotesPanel order={order} onChange={load} />
            <DiscussionPanel order={order} currentUserId={session?.user?.id ?? ""} onChange={load} />
            <OrderHistory order={order} />
          </div>

          <aside className={cn(s.aside, "min-w-0 space-y-4 lg:sticky lg:top-20")}>
            <OrderSummary order={order} />
            <QuickActions order={order} />
          </aside>
        </div>

        <SectionTabs attachments={order.attachments.length} showQuotes={order.quotes !== null} showDiscussion={order.messages !== null} />
      </div>
    </div>
  );
}
