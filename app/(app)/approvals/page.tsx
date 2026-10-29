"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { DemoDataBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { useRequestStore } from "@/lib/store";
import { APPROVAL_STEP_LABEL, type ApprovalStepView, type MaterialRequestView } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";

type Row = MaterialRequestView & { pendingStep: ApprovalStepView };

const columns: DataTableColumn<Row>[] = [
  {
    key: "requestNumber",
    header: "Дугаар",
    sortable: true,
    accessor: (r) => r.requestNumber,
    render: (r) => <span className="font-medium text-text">№{r.requestNumber}</span>,
  },
  {
    key: "department",
    header: "Цех, тасаг",
    sortable: true,
    accessor: (r) => r.department,
    render: (r) => r.department,
  },
  {
    key: "stage",
    header: "Шат",
    sortable: true,
    accessor: (r) => r.pendingStep.type,
    render: (r) => APPROVAL_STEP_LABEL[r.pendingStep.type],
  },
  {
    key: "assignee",
    header: "Баталгаажуулагч",
    sortable: true,
    accessor: (r) => r.pendingStep.assignedUserName,
    render: (r) => r.pendingStep.assignedUserName,
  },
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
];

export default function ApprovalsPage() {
  const router = useRouter();
  const requests = useRequestStore((s) => s.requests);

  const queue: Row[] = requests
    .map((r) => ({ ...r, pendingStep: r.approvalSteps.find((s) => s.status === "PENDING") }))
    .filter((r): r is Row => r.pendingStep !== undefined && r.pendingStep.type !== "WAREHOUSE_CHECK");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Батлах хүсэлтүүд</h2>
        <DemoDataBadge />
      </div>

      <Card>
        <DataTable
          data={queue}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/requests/${r.id}`)}
          emptyTitle="Батлах хүсэлт алга"
          emptyDescription="Шинэ хүсэлт ирэхэд энд харагдана"
        />
      </Card>
    </div>
  );
}
