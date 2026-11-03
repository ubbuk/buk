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
    key: "itemCount",
    header: "Мөрийн тоо",
    sortable: true,
    accessor: (r) => r.itemCount,
    render: (r) => r.itemCount,
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

export default function WarehousePage() {
  const router = useRouter();
  const requests = useRequestStore((s) => s.requests);
  const queue = requests.filter((r) => r.status === "PENDING_WAREHOUSE_CHECK");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Агуулахын шалгалт</h2>
      </div>

      <Card>
        <DataTable
          data={queue}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/warehouse/${r.id}`)}
          emptyTitle="Шалгах захиалга алга"
          emptyDescription="Цехийн дарга баталсан захиалгууд энд ирнэ"
        />
      </Card>
    </div>
  );
}
