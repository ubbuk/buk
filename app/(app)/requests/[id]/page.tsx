"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { CheckCircle2, PenLine, Receipt, ShieldAlert, Undo2, Warehouse } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PrintButton } from "@/components/ui/PrintButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { ApprovalTimeline } from "@/components/workflow/ApprovalTimeline";
import { AllocationBar } from "@/components/workflow/AllocationBar";
import { AttachmentsPanel } from "@/components/workflow/AttachmentsPanel";
import { MaterialDetailModal } from "@/components/workflow/MaterialDetailModal";
import { PinModal } from "@/components/workflow/PinModal";
import { ResubmitShortfallModal } from "@/components/workflow/ResubmitShortfallModal";
import { useRequestStore } from "@/lib/store";
import { USER_ROLE_LABEL } from "@/lib/types";
import { formatDateTime, formatNumber, formatPriceOrPending } from "@/lib/utils";

const RETURNED_STATUSES = new Set(["RETURNED_BY_DEPARTMENT", "RETURNED_BY_BRANCH_APPROVER", "RETURNED_BY_FINANCE", "RETURNED_BY_EXECUTIVE"]);
const TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "ACCOUNTING_COMPLETED"]);

export default function RequestDetailPage() {
  const params = useParams<{ id: string }>();
  const { push } = useToast();
  const { data: session } = useSession();
  const requests = useRequestStore((s) => s.requests);
  const loading = useRequestStore((s) => s.requestsLoading);
  const approveDepartmentHead = useRequestStore((s) => s.approveDepartmentHead);
  const returnDepartmentHead = useRequestStore((s) => s.returnDepartmentHead);
  const branchApprove = useRequestStore((s) => s.branchApprove);
  const branchReturn = useRequestStore((s) => s.branchReturn);
  const financeApprove = useRequestStore((s) => s.financeApprove);
  const financeReturn = useRequestStore((s) => s.financeReturn);
  const executiveApprove = useRequestStore((s) => s.executiveApprove);
  const executiveReturn = useRequestStore((s) => s.executiveReturn);
  const resubmitPositionStep = useRequestStore((s) => s.resubmitPositionStep);
  const updateItemPrice = useRequestStore((s) => s.updateItemPrice);
  const warehouseCheck = useRequestStore((s) => s.warehouseCheck);
  const request = requests.find((r) => r.id === params.id);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);
  const [markingUnavailableItemId, setMarkingUnavailableItemId] = useState<string | null>(null);

  if (loading && !request) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!request) {
    return <EmptyState title="Захиалга олдсонгүй" description={`Дугаар: ${params.id}`} />;
  }

  const pendingStep = request.approvalSteps.find((s) => s.status === "PENDING");
  const hasAllocation = request.items.some((i) => i.allocatedQuantity !== undefined);
  const isAuthorizedApprover = session?.user?.id === pendingStep?.assignedUserId;
  const isRequester = session?.user?.id === request.requestedById;
  const canResubmit = isRequester && RETURNED_STATUSES.has(request.status);
  const canEditPrice = session?.user?.role === "MANAGER" && !TERMINAL_STATUSES.has(request.status);
  const canMarkUnavailable = isAuthorizedApprover && pendingStep?.type === "WAREHOUSE_CHECK";
  const viewingItem = request.items.find((i) => i.id === viewingItemId) ?? null;

  async function savePrice(itemId: string) {
    if (!request) return;
    const parsed = Number(priceDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      push({ kind: "error", title: "Үнэ буруу байна" });
      return;
    }
    try {
      await updateItemPrice(request.id, itemId, session?.user?.name ?? "Manager", parsed, request.version);
      setEditingPriceItemId(null);
      push({ kind: "success", title: "Үнэ шинэчлэгдлээ" });
    } catch (err) {
      push({ kind: "error", title: "Үнэ шинэчилж чадсангүй", description: err instanceof Error ? err.message : undefined });
    }
  }

  function openMarkUnavailable(itemId: string) {
    setMarkingUnavailableItemId(itemId);
    setViewingItemId(null);
    setPinError(null);
    setPinOpen(true);
  }

  async function approveWithPin(pin: string) {
    if (!pendingStep || !request) return;
    setProcessing(true);
    setPinError(null);
    try {
      if (markingUnavailableItemId) {
        // Same shape as the dedicated /warehouse/[id] check: every item
        // defaults to its known warehouse balance, except the one the
        // storekeeper just flagged as unavailable, forced to 0 -- the
        // shortfall carries forward to the branch/finance/executive/
        // accounting stages exactly like a normal warehouse check would.
        const items = request.items.map((i) => ({
          requestItemId: i.id,
          availableQuantity: i.id === markingUnavailableItemId ? 0 : i.warehouseBalance ?? 0,
        }));
        await warehouseCheck(request.id, items, pendingStep.assignedUserName, pin, request.version);
        setPinOpen(false);
        setMarkingUnavailableItemId(null);
        push({ kind: "success", title: "Агуулахын шалгалт баталгаажлаа", description: "Дутуу материал дараагийн шатанд шилжлээ" });
        return;
      }
      if (pendingStep.type === "DEPARTMENT_HEAD") {
        await approveDepartmentHead(request.id, pendingStep.assignedUserName, pin, request.version);
      } else if (pendingStep.type === "BRANCH_APPROVAL") {
        await branchApprove(request.id, pendingStep.assignedUserName, pin, request.version);
      } else if (pendingStep.type === "FINANCE_APPROVAL") {
        await financeApprove(request.id, pendingStep.assignedUserName, pin, request.version);
      } else if (pendingStep.type === "EXECUTIVE_APPROVAL") {
        await executiveApprove(request.id, pendingStep.assignedUserName, pin, request.version);
      }
      setPinOpen(false);
      push({ kind: "success", title: "Хүсэлтийг баталлаа", description: `№${request.requestNumber}` });
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Баталгаажуулж чадсангүй");
    } finally {
      setProcessing(false);
    }
  }

  async function returnRequest() {
    if (!reason.trim()) {
      push({ kind: "error", title: "Буцаах шалтгаанаа бичнэ үү" });
      return;
    }
    if (!pendingStep || !request) return;
    setProcessing(true);
    try {
      if (pendingStep.type === "DEPARTMENT_HEAD") {
        await returnDepartmentHead(request.id, pendingStep.assignedUserName, reason, request.version);
      } else if (pendingStep.type === "BRANCH_APPROVAL") {
        await branchReturn(request.id, pendingStep.assignedUserName, reason, request.version);
      } else if (pendingStep.type === "FINANCE_APPROVAL") {
        await financeReturn(request.id, pendingStep.assignedUserName, reason, request.version);
      } else if (pendingStep.type === "EXECUTIVE_APPROVAL") {
        await executiveReturn(request.id, pendingStep.assignedUserName, reason, request.version);
      }
      setReturnOpen(false);
      push({ kind: "warning", title: "Хүсэлтийг буцаалаа", description: reason });
    } catch (err) {
      push({
        kind: "error",
        title: "Буцааж чадсангүй",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setProcessing(false);
    }
  }

  async function submitResubmit(adjustments: { requestItemId: string; quantity: number }[]) {
    if (!request) return;
    setProcessing(true);
    try {
      await resubmitPositionStep(request.id, session?.user?.name ?? "Ажилтан", request.version, adjustments);
      setResubmitOpen(false);
      push({ kind: "success", title: "Захиалгыг дахин илгээлээ" });
    } catch (err) {
      push({ kind: "error", title: "Дахин илгээж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="hidden text-sm font-semibold print:block">
        УБ БҮК ХК — Материалын захиалга (Маягт №1) · Хэвлэсэн: {formatDateTime(new Date().toISOString())}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-text">№{request.requestNumber}</h2>
            <StatusBadge status={request.status} />
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {request.department} · {request.requestedBy} · {formatDateTime(request.createdAt)}
          </p>
        </div>
        <div className="no-print flex flex-wrap items-start gap-2">
        <PrintButton />
        {pendingStep && pendingStep.type === "WAREHOUSE_CHECK" && isAuthorizedApprover && (
          <Link href={`/warehouse/${request.id}`}>
            <Button>
              <Warehouse className="size-4" />
              Агуулахад шалгах
            </Button>
          </Link>
        )}
        {pendingStep && pendingStep.type === "ACCOUNTING_RECORD" && isAuthorizedApprover && (
          <Link href={`/accounting?requestId=${request.id}`}>
            <Button>
              <Receipt className="size-4" />
              Санхүүгийн бүртгэл хийх
            </Button>
          </Link>
        )}
        {pendingStep && pendingStep.type !== "WAREHOUSE_CHECK" && pendingStep.type !== "ACCOUNTING_RECORD" && isAuthorizedApprover && (
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => setReturnOpen(true)} disabled={processing}>
              <Undo2 className="size-4" />
              Буцаах
            </Button>
            <Button
              variant="success"
              onClick={() => {
                setPinError(null);
                setPinOpen(true);
              }}
            >
              <CheckCircle2 className="size-4" />
              Батлах
            </Button>
          </div>
        )}
        {pendingStep && !isAuthorizedApprover && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-elevated/50 px-3 py-2 text-xs text-text-muted">
            <ShieldAlert className="size-3.5" />
            Зөвхөн {pendingStep.assignedUserName} баталгаажуулах боломжтой
          </div>
        )}
        {!pendingStep && canResubmit && request.status === "RETURNED_BY_DEPARTMENT" && (
          <Link href={`/requests/new?editRequestId=${request.id}`}>
            <Button>
              <PenLine className="size-4" />
              Засварлаж дахин илгээх
            </Button>
          </Link>
        )}
        {!pendingStep && canResubmit && request.status !== "RETURNED_BY_DEPARTMENT" && (
          <Button onClick={() => setResubmitOpen(true)}>
            <PenLine className="size-4" />
            Засварлаж дахин илгээх
          </Button>
        )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Захиалсан материал</CardTitle>
              <span className="text-xs text-text-muted">{request.items.length} мөр</span>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="px-5 py-2.5 font-medium">Материал</th>
                    <th className="px-3 py-2.5 font-medium">Агуулахын үлдэгдэл</th>
                    <th className="px-3 py-2.5 font-medium">Хүссэн тоо</th>
                    <th className="px-3 py-2.5 font-medium">Нэгж үнэ</th>
                    <th className="px-3 py-2.5 font-medium text-right">Бүгд үнэ</th>
                  </tr>
                </thead>
                <tbody>
                  {request.items.map((item) => (
                    <tr key={item.id} className="border-b border-border/60 align-top last:border-0">
                      <td className="px-5 py-3 text-text">
                        <button
                          type="button"
                          onClick={() => setViewingItemId(item.id)}
                          className="focus-ring rounded-md text-left underline decoration-dotted hover:text-accent"
                        >
                          {item.materialName}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-text-muted">
                        {item.warehouseBalance !== null ? `${formatNumber(item.warehouseBalance)} ${item.unit}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-text-muted">
                        {formatNumber(item.requestedQuantity)} {item.unit}
                        {hasAllocation && item.allocatedQuantity !== undefined && (
                          <div className="mt-2 max-w-[180px]">
                            <AllocationBar
                              requested={item.requestedQuantity}
                              allocated={item.allocatedQuantity}
                              unit={item.unit}
                            />
                          </div>
                        )}
                        {item.missingQuantity !== undefined && item.missingQuantity > 0 && (
                          <p className="mt-1.5 text-[11px] text-warning">
                            Дутуу {formatNumber(item.missingQuantity)} {item.unit}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-text-muted">
                        {canEditPrice && editingPriceItemId === item.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              type="number"
                              min={0}
                              step="0.01"
                              value={priceDraft}
                              onChange={(e) => setPriceDraft(e.target.value)}
                              className="focus-ring h-8 w-24 rounded-md border border-border bg-bg-elevated px-2 text-sm text-text"
                            />
                            <Button size="sm" onClick={() => savePrice(item.id)}>
                              Хадгалах
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditingPriceItemId(null)}>
                              Болих
                            </Button>
                          </div>
                        ) : canEditPrice ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPriceItemId(item.id);
                              setPriceDraft(item.unitPrice === null ? "" : String(item.unitPrice));
                            }}
                            className="focus-ring rounded-md underline decoration-dotted hover:text-text"
                            title="Үнэ засах"
                          >
                            {formatPriceOrPending(item.unitPrice)}
                          </button>
                        ) : (
                          formatPriceOrPending(item.unitPrice)
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-text">{formatPriceOrPending(item.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="px-5 py-3 text-right text-sm font-medium text-text-muted">
                      Нийт дүн
                    </td>
                    <td className="px-3 py-3 text-right text-base font-semibold text-text">
                      {formatPriceOrPending(request.totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Хавсралт</CardTitle>
            </CardHeader>
            <CardBody>
              <AttachmentsPanel
                requestId={request.id}
                attachments={request.attachments}
                canUpload={isRequester && !TERMINAL_STATUSES.has(request.status)}
              />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Баталгаажуулалтын явц</CardTitle>
            </CardHeader>
            <CardBody>
              <ApprovalTimeline steps={request.approvalSteps} />
            </CardBody>
          </Card>

          {request.accountingRecord && (
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Санхүүгийн бүртгэл</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-text-muted">Бүртгэлийн дугаар</span>
                  <span className="font-medium text-text">{request.accountingRecord.ledgerNumber}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-text-muted">Огноо</span>
                  <span className="text-text">{formatDateTime(request.accountingRecord.recordDate)}</span>
                </div>
                {request.accountingRecord.note && (
                  <div className="flex justify-between gap-2">
                    <span className="text-text-muted">Тайлбар</span>
                    <span className="text-right text-text">{request.accountingRecord.note}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-text-muted">Бүртгэсэн</span>
                  <span className="text-text">{request.accountingRecord.recordedByName}</span>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Хүсэлтийг буцаах"
        description="Буцаах шалтгаанаа тодорхой бичнэ үү. Энэ тайлбарыг захиалга үүсгэгч харах болно."
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Жишээ: Тоо хэмжээг тодруулж дахин илгээнэ үү"
          className="focus-ring w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text placeholder:text-text-muted"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReturnOpen(false)}>
            Болих
          </Button>
          <Button variant="danger" onClick={returnRequest} loading={processing}>
            Буцаах
          </Button>
        </div>
      </Modal>

      {pendingStep && (
        <PinModal
          open={pinOpen}
          onClose={() => {
            setPinOpen(false);
            setMarkingUnavailableItemId(null);
          }}
          onConfirm={approveWithPin}
          approverName={pendingStep.assignedUserName}
          approverRole={USER_ROLE_LABEL[session?.user?.role ?? ""] ?? pendingStep.type}
          processing={processing}
          error={pinError}
        />
      )}

      <ResubmitShortfallModal
        open={resubmitOpen}
        onClose={() => setResubmitOpen(false)}
        items={request.items}
        onSubmit={submitResubmit}
        processing={processing}
      />

      <MaterialDetailModal
        item={viewingItem}
        requestId={request.id}
        attachments={request.attachments}
        onClose={() => setViewingItemId(null)}
        canMarkUnavailable={canMarkUnavailable}
        onMarkUnavailable={openMarkUnavailable}
      />
    </div>
  );
}
