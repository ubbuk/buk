"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { useRequestStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { MaterialRequestView } from "@/lib/types";

const columns: DataTableColumn<MaterialRequestView>[] = [
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

export default function ArchivePage() {
  const router = useRouter();
  const requests = useRequestStore((s) => s.requests);
  const archived = requests.filter((r) => ["COMPLETED", "CANCELLED", "PARTIALLY_COMPLETED"].includes(r.status));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Захиалгын архив</h2>
      </div>

      <Card>
        <DataTable
          data={archived}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/requests/${r.id}`)}
          emptyTitle="Дууссан захиалга алга"
        />
      </Card>
    </div>
  );
}
