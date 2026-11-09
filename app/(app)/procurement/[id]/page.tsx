"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, History, PackageCheck } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { ProcurementDetail, ProcurementItemView, ProcurementKind, PurchaseView } from "@/lib/procurement";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { REQUEST_STATUS_LABEL, USER_ROLE_LABEL, type RequestStatus } from "@/lib/types";
import { ExecutiveApprovalPanel } from "@/components/workflow/ExecutiveApprovalPanel";
import { cn, formatDate, formatDateTime, formatNumber } from "@/lib/utils";

const money = (v: number | null) => (v === null ? "—" : `${formatNumber(v, 2)}₮`);
const qty = (v: number) => formatNumber(v, 3);
/** What may be bought right now: the smaller of the shortfall left and the executive-approved quantity left (the server enforces it again). */
const buyable = (item: ProcurementItemView) => Math.min(item.remainingQuantity, item.remainingAuthorizedQuantity);
const KIND_LABEL: Record<ProcurementKind, string> = { DOMESTIC: "Дотоод", INTERNATIONAL: "Олон улс" };
const KIND_TONE: Record<ProcurementKind, string> = { DOMESTIC: "bg-accent/15 text-accent", INTERNATIONAL: "bg-warning/15 text-warning" };
const inputClass = "focus-ring h-9 w-full rounded-lg border border-border bg-bg-surface px-3 text-sm text-text";

type Draft = { quantity: string; unitPrice: string; note: string; key: string };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Серверийн алдаа (${res.status})`);
  return body;
}

export default function ProcurementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const { push } = useToast();
  const [detail, setDetail] = useState<ProcurementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ item: ProcurementItemView; purchase: PurchaseView; mode: "correct" | "void" } | null>(null);
  const [editForm, setEditForm] = useState({ quantity: "", unitPrice: "", reason: "" });
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [abroad, setAbroad] = useState<Record<string, boolean>>({});
  const [confirmClassify, setConfirmClassify] = useState(false);
  const [reassigning, setReassigning] = useState<ProcurementItemView | null>(null);
  const [reassignForm, setReassignForm] = useState<{ kind: ProcurementKind; reason: string }>({ kind: "DOMESTIC", reason: "" });
  const priceRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const isManager = session?.user?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/requests/${id}/procurement`);
      if (res.status === 404) return setNotFound(true);
      if (!res.ok) throw new Error();
      setDetail(await res.json());
    } catch {
      push({ kind: "error", title: "Ачаалж чадсангүй" });
    } finally {
      setLoading(false);
    }
  }, [id, push]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  // Keep one editable draft per item; a fresh idempotency key per attempt that has not succeeded yet.
  const draftFor = (item: ProcurementItemView): Draft =>
    drafts[item.itemId] ?? {
      quantity: buyable(item) ? String(buyable(item)) : "",
      unitPrice: String(item.actualUnitPrice ?? item.estimatedUnitPrice ?? ""),
      note: "",
      key: newKey(),
    };
  const patchDraft = (item: ProcurementItemView, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [item.itemId]: { ...draftFor(item), ...patch } }));

  async function submitPurchase(item: ProcurementItemView, override?: Partial<Draft>) {
    const draft = { ...draftFor(item), ...override };
    const quantity = Number(draft.quantity);
    const unitPrice = Number(draft.unitPrice);
    if (!(quantity > 0) || !(unitPrice > 0)) {
      push({ kind: "error", title: "Тоо хэмжээ болон нэгж үнийг оруулна уу" });
      priceRefs.current[item.itemId]?.focus();
      return;
    }
    setBusy(item.itemId);
    try {
      const next: ProcurementDetail = await call(`/api/requests/${id}/procurement/purchases`, {
        method: "POST",
        body: JSON.stringify({ itemId: item.itemId, quantity, unitPrice, note: draft.note || undefined, clientRequestId: draft.key }),
      });
      setDetail(next);
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== item.itemId)));
      push({ kind: "success", title: "Худалдан авалт бүртгэгдлээ" });
    } catch (err) {
      push({ kind: "error", title: "Бүртгэж чадсангүй", description: err instanceof Error ? err.message : undefined });
      void load();
    } finally {
      setBusy(null);
    }
  }

  async function submitEdit() {
    if (!editing) return;
    const { purchase, mode } = editing;
    const body: Record<string, unknown> = { reason: editForm.reason };
    if (mode === "correct") {
      if (editForm.quantity) body.quantity = Number(editForm.quantity);
      if (editForm.unitPrice) body.unitPrice = Number(editForm.unitPrice);
    }
    setBusy(purchase.id);
    try {
      const next: ProcurementDetail = await call(`/api/requests/${id}/procurement/purchases/${purchase.id}/${mode === "void" ? "void" : "correct"}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDetail(next);
      setEditing(null);
      push({ kind: "success", title: mode === "void" ? "Бичлэг хүчингүй болгогдлоо" : "Бичлэг засагдлаа" });
    } catch (err) {
      push({ kind: "error", title: "Хадгалж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function classify() {
    if (!detail) return;
    setBusy("classify");
    try {
      const internationalItemIds = detail.items.filter((i) => i.requiredQuantity > 0 && abroad[i.itemId]).map((i) => i.itemId);
      setDetail(await call(`/api/requests/${id}/procurement/classify`, { method: "POST", body: JSON.stringify({ internationalItemIds }) }));
      setConfirmClassify(false);
      push({ kind: "success", title: "Ангилал баталгаажлаа", description: "Үлдсэн материал Дотоодын менежерт хуваарилагдлаа" });
    } catch (err) {
      setConfirmClassify(false);
      push({ kind: "error", title: "Баталгаажуулж чадсангүй", description: err instanceof Error ? err.message : undefined });
      void load();
    } finally {
      setBusy(null);
    }
  }

  async function submitReassign() {
    if (!reassigning) return;
    setBusy(`reassign-${reassigning.itemId}`);
    try {
      setDetail(await call(`/api/requests/${id}/procurement/items/${reassigning.itemId}/reassign`, { method: "POST", body: JSON.stringify(reassignForm) }));
      setReassigning(null);
      push({ kind: "success", title: "Дахин хуваарилагдлаа" });
    } catch (err) {
      push({ kind: "error", title: "Дахин хуваарилж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function complete() {
    setBusy("complete");
    try {
      setDetail(await call(`/api/requests/${id}/procurement/complete`, { method: "POST" }));
      setConfirmComplete(false);
      push({ kind: "success", title: "Худалдан авалт дууслаа", description: "Ерөнхий нягтлан бодогчид шилжлээ" });
    } catch (err) {
      setConfirmComplete(false);
      push({ kind: "error", title: "Дуусгах боломжгүй", description: err instanceof Error ? err.message : undefined });
      void load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (notFound || !detail) return <EmptyState title="Захиалга олдсонгүй" description={`Дугаар: ${id}`} />;

  const required = detail.items.filter((i) => i.requiredQuantity > 0);
  const covered = detail.items.filter((i) => i.requiredQuantity === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/procurement" className="focus-ring inline-flex items-center gap-1 text-xs text-text-muted hover:text-text">
            <ArrowLeft className="size-3.5" /> Худалдан авалт
          </Link>
          <h2 className="text-lg font-semibold text-text">№{detail.requestNumber}</h2>
          <p className="text-sm text-text-muted">
            {detail.department} · {detail.requestedBy} · Захиалсан {formatDate(detail.createdAt)}
            {detail.approvedAt && ` · Гүйцэтгэх захирал баталсан ${formatDate(detail.approvedAt)}`}
          </p>
          <p className="text-xs text-text-muted">Төлөв: {REQUEST_STATUS_LABEL[detail.requestStatus as RequestStatus] ?? detail.requestStatus}</p>
        </div>
        {isManager && detail.open && (
          <Button variant="success" size="lg" disabled={!detail.viewerCanComplete} onClick={() => setConfirmComplete(true)}>
            <PackageCheck className="size-4" /> Худалдан авалтыг дуусгах
          </Button>
        )}
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span>
            Авсан материал:{" "}
            <strong className="text-text">
              {detail.completedItemCount}/{detail.requiredItemCount}
            </strong>
          </span>
          {detail.procurementCompletedAt && (
            <span className="text-success">
              Дууссан {formatDateTime(detail.procurementCompletedAt)} · {detail.procurementCompletedByName}
            </span>
          )}
          {isManager && detail.open && !detail.viewerCanComplete && (
            <span className="text-text-muted">
              {detail.mode === "ASSIGNED" && !detail.classified
                ? "Олон улсын менежер ангилалыг баталгаажуулсны дараа"
                : !detail.canComplete
                  ? "Хоёр менежерийн бүх материалыг бүрэн авсны дараа дуусгах боломжтой"
                  : "Энэ захиалгын хариуцсан менежер дуусгана"}
            </span>
          )}
          {!isManager && <span className="text-text-muted">Зөвхөн харах горим</span>}
          {detail.mode === "ASSIGNED" && (
            <span className="text-text-muted">
              Дотоод: {detail.managers.domestic?.name ?? "тохируулаагүй"} · Олон улс: {detail.managers.international?.name ?? "тохируулаагүй"}
              {detail.classified && detail.classifiedAt && ` · Ангилал баталгаажсан ${formatDateTime(detail.classifiedAt)} (${detail.classifiedByName})`}
            </span>
          )}
        </CardBody>
      </Card>

      <ExecutiveApprovalPanel requestId={id} viewerName={session?.user?.name ?? ""} viewerRoleLabel={USER_ROLE_LABEL[session?.user?.role ?? ""] ?? ""} />

      {detail.open && detail.mode === "ASSIGNED" && !detail.classified && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Худалдан авалтын ангилал</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {detail.canClassify ? (
              <>
                <p className="text-sm text-text-muted">Гадаадаас импортлох материалыг тэмдэглээд баталгаажуулна уу. Үлдсэн бүх материал Дотоодын менежерт ({detail.managers.domestic?.name ?? "тохируулаагүй"}) хуваарилагдана.</p>
                <ul className="space-y-1">
                  {required.map((i) => (
                    <li key={i.itemId}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={!!abroad[i.itemId]}
                          onChange={(e) => setAbroad((a) => ({ ...a, [i.itemId]: e.target.checked }))}
                          aria-label={`${i.materialName} олон улсаас авна`}
                        />
                        <span className="min-w-0 flex-1 truncate">{i.materialName}</span>
                        <span className="text-xs text-text-muted">
                          {qty(i.requiredQuantity)} {i.unit}
                        </span>
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", abroad[i.itemId] ? KIND_TONE.INTERNATIONAL : KIND_TONE.DOMESTIC)}>
                          {abroad[i.itemId] ? KIND_LABEL.INTERNATIONAL : KIND_LABEL.DOMESTIC}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <Button disabled={!detail.managers.domestic} onClick={() => setConfirmClassify(true)}>
                  Ангилал баталгаажуулах
                </Button>
                {!detail.managers.domestic && <p className="text-xs text-danger">Дотоодын худалдан авалтын менежер тохируулагдаагүй эсвэл идэвхгүй байна (Админ хуудас).</p>}
              </>
            ) : (
              <p className="text-sm text-text-muted">
                Олон улсын худалдан авалтын менежер ({detail.managers.international?.name ?? "тохируулаагүй"}) материалыг ангилж баталгаажуулах хүртэл худалдан авалт бүртгэх боломжгүй.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {required.length === 0 ? (
        <Card>
          <EmptyState title="Худалдан авах материал алга" description="Бүх материалыг агуулахаас олгосон" />
        </Card>
      ) : (
        <ul className="space-y-3">
          {required.map((item) => {
            const draft = draftFor(item);
            const history = openHistory[item.itemId];
            const active = item.purchases.filter((p) => !p.voided);
            return (
              <li key={item.itemId}>
                <Card>
                  <CardHeader className="flex flex-wrap items-center gap-3">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={!item.canAct || busy === item.itemId || (!item.checked && buyable(item) <= 0)}
                      aria-label={`${item.materialName} бүрэн авсан`}
                      className="size-5 accent-[var(--color-success,#22c55e)]"
                      onChange={() => {
                        if (item.checked) {
                          // Un-checking is a correction: it needs a reason, so route through the purchase history.
                          setOpenHistory((h) => ({ ...h, [item.itemId]: true }));
                          push({ kind: "info", title: "Буцаахын тулд худалдан авалтын бичлэгийг хүчингүй болгоно уу" });
                        } else {
                          void submitPurchase(item, { quantity: String(buyable(item)) });
                        }
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate">
                        {item.assignment && <span className={cn("mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium", KIND_TONE[item.assignment.kind])}>{KIND_LABEL[item.assignment.kind]}</span>}
                        {item.materialName}
                      </CardTitle>
                      <p className="text-xs text-text-muted">
                        Захиалсан {qty(item.requestedQuantity)} {item.unit} · Агуулахаас олгосон {qty(item.issuedQuantity)} · Худалдан авах {qty(item.requiredQuantity)}
                        {item.assignment ? ` · Хариуцсан: ${item.assignment.managerName}` : detail.mode === "ASSIGNED" ? " · Ангилаагүй" : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-medium",
                        item.status === "COMPLETE" ? "bg-success/15 text-success" : item.status === "PARTIAL" ? "bg-warning/15 text-warning" : "bg-text-muted/15 text-text-muted"
                      )}
                    >
                      {item.status === "COMPLETE" ? "Бүгдийг авсан" : item.status === "PARTIAL" ? "Хэсэгчлэн авсан" : "Аваагүй"}
                    </span>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-text-muted">Авсан</dt>
                        <dd className="font-medium text-text">
                          {qty(item.purchasedQuantity)}/{qty(item.requiredQuantity)} {item.unit}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-text-muted">Үлдэгдэл</dt>
                        <dd className="font-medium text-text">
                          {qty(item.remainingQuantity)} {item.unit}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-text-muted">Захирлын баталсан</dt>
                        <dd className="font-medium text-success">
                          {qty(item.authorizedQuantity)} {item.unit}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-text-muted">Одоо авч болох</dt>
                        <dd className="font-medium text-text">
                          {qty(buyable(item))} {item.unit}
                        </dd>
                      </div>
                      {item.deferredQuantity > 0 && (
                        <div>
                          <dt className="text-xs text-text-muted">Хойшлогдсон</dt>
                          <dd className="font-medium text-warning">
                            {qty(item.deferredQuantity)} {item.unit}
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt className="text-xs text-text-muted">Тооцоолсон нэгж үнэ</dt>
                        <dd className="text-text">{money(item.estimatedUnitPrice)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-text-muted">Бодит нэгж үнэ (дундаж)</dt>
                        <dd className="text-text">{money(item.actualUnitPrice)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-text-muted">Нийт дүн</dt>
                        <dd className="text-text">{money(item.actualTotal)}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-text-muted">Сүүлд авсан</dt>
                        <dd className="text-text">{item.lastPurchasedAt ? `${formatDateTime(item.lastPurchasedAt)} · ${item.lastPurchasedByName}` : "—"}</dd>
                      </div>
                    </dl>

                    {item.canAct && item.remainingQuantity > 0 && buyable(item) <= 0 && (
                      <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
                        Гүйцэтгэх захирлын баталсан тоо хэмжээ дууссан. Үлдсэн {qty(item.deferredQuantity)} {item.unit}-д нэмэлт зөвшөөрөл хүсэх шаардлагатай.
                      </p>
                    )}
                    {item.canAct && item.remainingQuantity > 0 && buyable(item) > 0 && (
                      <form
                        className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void submitPurchase(item);
                        }}
                      >
                        <label className="space-y-1 text-xs text-text-muted">
                          Авсан тоо ({item.unit})
                          <input inputMode="decimal" value={draft.quantity} onChange={(e) => patchDraft(item, { quantity: e.target.value })} className={inputClass} />
                        </label>
                        <label className="space-y-1 text-xs text-text-muted">
                          Бодит нэгж үнэ ₮
                          <input
                            ref={(el) => {
                              priceRefs.current[item.itemId] = el;
                            }}
                            inputMode="decimal"
                            value={draft.unitPrice}
                            onChange={(e) => patchDraft(item, { unitPrice: e.target.value })}
                            className={inputClass}
                          />
                        </label>
                        <label className="col-span-2 space-y-1 text-xs text-text-muted sm:col-span-1">
                          Тэмдэглэл
                          <input value={draft.note} onChange={(e) => patchDraft(item, { note: e.target.value })} className={inputClass} />
                        </label>
                        <Button type="submit" loading={busy === item.itemId} className="col-span-2 sm:col-span-1">
                          Бүртгэх
                        </Button>
                      </form>
                    )}

                    <button
                      type="button"
                      onClick={() => setOpenHistory((h) => ({ ...h, [item.itemId]: !h[item.itemId] }))}
                      className="focus-ring inline-flex items-center gap-1 text-xs text-text-muted hover:text-text"
                      aria-expanded={!!history}
                    >
                      <History className="size-3.5" /> Худалдан авалтын түүх ({item.purchases.length})
                    </button>
                    {detail.canReassign && item.assignment && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="ml-3"
                        onClick={() => {
                          setReassigning(item);
                          setReassignForm({ kind: item.assignment!.kind === "DOMESTIC" ? "INTERNATIONAL" : "DOMESTIC", reason: "" });
                        }}
                      >
                        Дахин хуваарилах
                      </Button>
                    )}
                    {history && (
                      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                        {item.purchases.length === 0 && <li className="px-3 py-2 text-text-muted">Бичлэг алга</li>}
                        {item.purchases.map((p) => (
                          <li key={p.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-3 py-2", p.voided && "text-text-muted")}>
                            <div className={cn("min-w-0", p.voided && "opacity-60")}>
                              <p className={cn(p.voided && "line-through")}>
                                {qty(p.quantity)} {item.unit} × {money(p.unitPrice)} = {money(p.total)}
                              </p>
                              <p className="text-xs text-text-muted">
                                {formatDateTime(p.purchasedAt)} · {p.purchasedByName}
                                {p.note && ` · ${p.note}`}
                                {p.replacesId && " · засвар"}
                                {p.voided && ` · Хүчингүй (${p.voidedByName}, ${p.voidedAt ? formatDateTime(p.voidedAt) : ""}): ${p.voidReason}`}
                              </p>
                            </div>
                            {item.canAct && !p.voided && (
                              <div className="flex gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setEditing({ item, purchase: p, mode: "correct" });
                                    setEditForm({ quantity: String(p.quantity), unitPrice: String(p.unitPrice), reason: "" });
                                  }}
                                >
                                  Засах
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => {
                                    setEditing({ item, purchase: p, mode: "void" });
                                    setEditForm({ quantity: "", unitPrice: "", reason: "" });
                                  }}
                                >
                                  Хүчингүй болгох
                                </Button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {active.length === 0 && !history && item.purchases.length > 0 && <p className="text-xs text-text-muted">Бүх бичлэг хүчингүй болсон</p>}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {covered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Агуулахаас бүрэн олгосон (худалдан авах шаардлагагүй)</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm text-text-muted">
              {covered.map((i) => (
                <li key={i.itemId} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-success" />
                  {i.materialName}: {qty(i.issuedQuantity)} {i.unit}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.mode === "void" ? "Бичлэгийг хүчингүй болгох" : "Бичлэгийг засах"}
        description="Хуучин бичлэг устгагдахгүй, шалтгаантай хамт түүхэнд үлдэнэ"
      >
        {editing && (
          <div className="space-y-3">
            {editing.mode === "correct" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-text-muted">
                  Тоо ({editing.item.unit})
                  <input inputMode="decimal" value={editForm.quantity} onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))} className={inputClass} />
                </label>
                <label className="space-y-1 text-xs text-text-muted">
                  Бодит нэгж үнэ ₮
                  <input inputMode="decimal" value={editForm.unitPrice} onChange={(e) => setEditForm((f) => ({ ...f, unitPrice: e.target.value }))} className={inputClass} />
                </label>
              </div>
            )}
            <label className="block space-y-1 text-xs text-text-muted">
              Шалтгаан (заавал)
              <input value={editForm.reason} onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))} className={inputClass} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Болих
              </Button>
              <Button variant={editing.mode === "void" ? "danger" : "primary"} disabled={!editForm.reason.trim()} loading={busy === editing.purchase.id} onClick={() => void submitEdit()}>
                {editing.mode === "void" ? "Хүчингүй болгох" : "Хадгалах"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={confirmClassify}
        onClose={() => setConfirmClassify(false)}
        title="Ангилалыг баталгаажуулах уу?"
        description={`Олон улс: ${required.filter((i) => abroad[i.itemId]).length}, дотоод: ${required.filter((i) => !abroad[i.itemId]).length} материал. Үүнийг дараа нь зөвхөн шалтгаантай «Дахин хуваарилах» үйлдлээр өөрчилнө.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmClassify(false)}>
            Болих
          </Button>
          <Button loading={busy === "classify"} onClick={() => void classify()}>
            Баталгаажуулах
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!reassigning}
        onClose={() => setReassigning(null)}
        title="Материалыг дахин хуваарилах"
        description="Идэвхтэй худалдан авалтын бичлэгтэй материалыг хариуцсан менежер нь бичлэгээ хүчингүй болгохгүй бол сольж болохгүй. Бичлэг устгагдахгүй."
      >
        {reassigning && (
          <div className="space-y-3">
            <p className="text-sm text-text">{reassigning.materialName}</p>
            <label className="block space-y-1 text-xs text-text-muted">
              Шинэ ангилал
              <select value={reassignForm.kind} onChange={(e) => setReassignForm((f) => ({ ...f, kind: e.target.value as ProcurementKind }))} className={inputClass}>
                <option value="DOMESTIC">Дотоод ({detail.managers.domestic?.name ?? "тохируулаагүй"})</option>
                <option value="INTERNATIONAL">Олон улс ({detail.managers.international?.name ?? "тохируулаагүй"})</option>
              </select>
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              Шалтгаан (заавал)
              <input value={reassignForm.reason} onChange={(e) => setReassignForm((f) => ({ ...f, reason: e.target.value }))} className={inputClass} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReassigning(null)}>
                Болих
              </Button>
              <Button disabled={!reassignForm.reason.trim()} loading={busy === `reassign-${reassigning.itemId}`} onClick={() => void submitReassign()}>
                Хуваарилах
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={confirmComplete} onClose={() => setConfirmComplete(false)} title="Худалдан авалтыг дуусгах уу?" description="Захиалга Ерөнхий нягтлан бодогчид бүртгэхээр шилжинэ. Үүнийг буцаах боломжгүй.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmComplete(false)}>
            Болих
          </Button>
          <Button variant="success" loading={busy === "complete"} onClick={() => void complete()}>
            Дуусгах
          </Button>
        </div>
      </Modal>
    </div>
  );
}
