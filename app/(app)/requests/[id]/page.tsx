"use client";

import { useState } from "react";
import { notFound, useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Paperclip, Undo2, Warehouse } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DemoDataBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { ApprovalTimeline } from "@/components/workflow/ApprovalTimeline";
import { AllocationBar } from "@/components/workflow/AllocationBar";
import { useRequestStore } from "@/lib/store";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/utils";

export default function RequestDetailPage() {
  const params = useParams<{ id: string }>();
  const { push } = useToast();
  const requests = useRequestStore((s) => s.requests);
  const approveStep = useRequestStore((s) => s.approveStep);
  const returnStep = useRequestStore((s) => s.returnStep);
  const request = requests.find((r) => r.id === params.id);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!request) notFound();

  const pendingStep = request.approvalSteps.find((s) => s.status === "PENDING");
  const hasAllocation = request.items.some((i) => i.allocatedQuantity !== undefined);

  function approve() {
    if (!pendingStep) return;
    approveStep(request!.id, pendingStep.assignedUserName);
    push({ kind: "success", title: "Хүсэлтийг баталлаа", description: `№${request!.requestNumber}` });
  }

  function returnRequest() {
    if (!reason.trim()) {
      push({ kind: "error", title: "Буцаах шалтгаанаа бичнэ үү" });
      return;
    }
    if (!pendingStep) return;
    returnStep(request!.id, pendingStep.assignedUserName, reason);
    setReturnOpen(false);
    push({ kind: "warning", title: "Хүсэлтийг буцаалаа", description: reason });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-text">№{request.requestNumber}</h2>
            <StatusBadge status={request.status} />
            <DemoDataBadge />
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {request.department} · {request.requestedBy} · {formatDateTime(request.createdAt)}
          </p>
        </div>
        {pendingStep && pendingStep.type === "WAREHOUSE_CHECK" && (
          <Link href={`/warehouse/${request.id}`}>
            <Button>
              <Warehouse className="size-4" />
              Агуулахад шалгах
            </Button>
          </Link>
        )}
        {pendingStep && pendingStep.type !== "WAREHOUSE_CHECK" && (
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => setReturnOpen(true)}>
              <Undo2 className="size-4" />
              Буцаах
            </Button>
            <Button variant="success" onClick={approve}>
              <CheckCircle2 className="size-4" />
              Батлах
            </Button>
          </div>
        )}
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
                      <td className="px-5 py-3 text-text">{item.materialName}</td>
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
                      </td>
                      <td className="px-3 py-3 text-text-muted">{formatCurrency(item.unitPrice)}</td>
                      <td className="px-3 py-3 text-right font-medium text-text">{formatCurrency(item.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="px-5 py-3 text-right text-sm font-medium text-text-muted">
                      Нийт дүн
                    </td>
                    <td className="px-3 py-3 text-right text-base font-semibold text-text">
                      {formatCurrency(request.totalAmount)}
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
              <p className="flex items-center gap-2 text-sm text-text-muted">
                <Paperclip className="size-4" />
                Хавсаргасан файл алга
              </p>
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Баталгаажуулалтын явц</CardTitle>
          </CardHeader>
          <CardBody>
            <ApprovalTimeline steps={request.approvalSteps} />
          </CardBody>
        </Card>
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
          <Button variant="danger" onClick={returnRequest}>
            Буцаах
          </Button>
        </div>
      </Modal>
    </div>
  );
}
