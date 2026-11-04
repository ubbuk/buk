"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Receipt } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useRequestStore } from "@/lib/store";
import { formatCurrency, formatDate, requestTitle } from "@/lib/utils";
import type { MaterialRequestView } from "@/lib/types";

const inputClass =
  "focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";

export default function AccountingPage() {
  return (
    <Suspense>
      <AccountingPageInner />
    </Suspense>
  );
}

function AccountingPageInner() {
  const { push } = useToast();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const requests = useRequestStore((s) => s.requests);
  const loading = useRequestStore((s) => s.requestsLoading);
  const recordAccounting = useRequestStore((s) => s.recordAccounting);

  const queue = requests.filter((r) => r.status === "PENDING_ACCOUNTING");

  const [target, setTarget] = useState<MaterialRequestView | null>(null);
  const [ledgerNumber, setLedgerNumber] = useState("");
  const [recordDate, setRecordDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const requestId = searchParams.get("requestId");
    if (!requestId) return;
    const found = queue.find((r) => r.id === requestId);
    if (found) openModal(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, requests]);

  function openModal(request: MaterialRequestView) {
    setTarget(request);
    setLedgerNumber("");
    setRecordDate(new Date().toISOString().slice(0, 10));
    setNote("");
  }

  async function submit() {
    if (!target) return;
    if (!ledgerNumber.trim()) {
      push({ kind: "error", title: "Бүртгэлийн дугаар оруулна уу" });
      return;
    }
    setSubmitting(true);
    try {
      await recordAccounting(
        target.id,
        session?.user?.name ?? "Нягтлан бодогч",
        { ledgerNumber, recordDate, note: note || undefined },
        target.version
      );
      push({ kind: "success", title: "Санхүүгийн бүртгэл хийгдлээ", description: `№${target.requestNumber}` });
      setTarget(null);
    } catch (err) {
      push({ kind: "error", title: "Бүртгэж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  const columns: DataTableColumn<MaterialRequestView>[] = [
    {
      key: "requestNumber",
      header: "Захиалсан материал",
      sortable: true,
      accessor: (r) => requestTitle(r),
      render: (r) => <span className="font-medium text-text">{requestTitle(r)}</span>,
    },
    { key: "department", header: "Цех, тасаг", sortable: true, accessor: (r) => r.department, render: (r) => r.department },
    { key: "requestedBy", header: "Үүсгэсэн", sortable: true, accessor: (r) => r.requestedBy, render: (r) => r.requestedBy },
    {
      key: "createdAt",
      header: "Огноо",
      sortable: true,
      accessor: (r) => r.createdAt,
      render: (r) => formatDate(r.createdAt),
    },
    {
      key: "totalAmount",
      header: "Дүн",
      sortable: true,
      accessor: (r) => r.totalAmount,
      render: (r) => formatCurrency(r.totalAmount),
      className: "text-right",
    },
    {
      key: "status",
      header: "Төлөв",
      sortable: true,
      accessor: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      accessor: () => "",
      render: (r) => (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => openModal(r)}>
            <Receipt className="size-3.5" />
            Бүртгэх
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text">Санхүүгийн бүртгэл</h2>

      <Card>
        {loading ? (
          <SkeletonTable />
        ) : (
          <DataTable
            data={queue}
            columns={columns}
            getRowId={(r) => r.id}
            searchPlaceholder="Захиалга хайх..."
            emptyTitle="Бүртгэх захиалга алга"
            emptyDescription="Гүйцэтгэх захирлаар батлагдсан захиалгууд энд ирнэ"
          />
        )}
      </Card>

      <Modal open={!!target} onClose={() => setTarget(null)} title="Санхүүгийн бүртгэл хийх">
        {target && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              №{target.requestNumber} — {formatCurrency(target.totalAmount)}
            </p>
            <input
              value={ledgerNumber}
              onChange={(e) => setLedgerNumber(e.target.value)}
              placeholder="Санхүүгийн бүртгэлийн дугаар"
              className={inputClass}
            />
            <input type="date" value={recordDate} onChange={(e) => setRecordDate(e.target.value)} className={inputClass} />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Тайлбар (заавал биш)"
              rows={3}
              className={inputClass}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTarget(null)}>
                Болих
              </Button>
              <Button onClick={submit} loading={submitting}>
                Бүртгээд шилжүүлэх
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
