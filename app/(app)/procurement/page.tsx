"use client";

import { Card } from "@/components/ui/Card";
import { DemoDataBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { DEMO_PURCHASE_QUEUE, type PurchaseQueueEntry } from "@/lib/mock-data";
import { PURCHASE_STATUS_LABEL, RECEIVING_STATUS_LABEL } from "@/lib/types";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";

const statusTone: Record<string, string> = {
  PENDING_ROUTE_APPROVAL: "text-accent",
  PENDING_DIRECTOR_APPROVAL: "text-accent",
  APPROVED: "text-success",
  IN_PROCUREMENT: "text-warning",
  FULFILLED: "text-success",
};

const columns: DataTableColumn<PurchaseQueueEntry>[] = [
  {
    key: "requestNumber",
    header: "Эх захиалга",
    sortable: true,
    accessor: (r) => r.requestNumber,
    render: (r) => <span className="font-medium text-text">№{r.requestNumber}</span>,
  },
  {
    key: "materialName",
    header: "Материал",
    sortable: true,
    accessor: (r) => r.materialName,
    render: (r) => r.materialName,
  },
  {
    key: "quantity",
    header: "Шаардлагатай тоо",
    sortable: true,
    accessor: (r) => r.quantity,
    render: (r) => `${formatNumber(r.quantity)} ${r.unit}`,
  },
  {
    key: "supplier",
    header: "Нийлүүлэгч",
    sortable: true,
    accessor: (r) => r.supplier ?? "",
    render: (r) => r.supplier ?? <span className="text-text-muted">Тодорхойгүй</span>,
  },
  {
    key: "estimatedPrice",
    header: "Тооцоолсон үнэ",
    sortable: true,
    accessor: (r) => r.estimatedPrice,
    render: (r) => formatCurrency(r.estimatedPrice),
  },
  {
    key: "actualPrice",
    header: "Бодит үнэ",
    sortable: true,
    accessor: (r) => r.actualPrice ?? 0,
    render: (r) => (r.actualPrice ? formatCurrency(r.actualPrice) : <span className="text-text-muted">—</span>),
  },
  {
    key: "status",
    header: "Худалдан авалтын төлөв",
    sortable: true,
    accessor: (r) => r.status,
    render: (r) => <span className={cn("font-medium", statusTone[r.status])}>{PURCHASE_STATUS_LABEL[r.status]}</span>,
  },
  {
    key: "expectedDelivery",
    header: "Хүргэгдэх огноо",
    sortable: true,
    accessor: (r) => r.expectedDelivery ?? "",
    render: (r) => (r.expectedDelivery ? formatDate(r.expectedDelivery) : "—"),
  },
  {
    key: "receivingStatus",
    header: "Хүлээн авалт",
    sortable: true,
    accessor: (r) => r.receivingStatus,
    render: (r) => RECEIVING_STATUS_LABEL[r.receivingStatus],
  },
];

export default function ProcurementPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Худалдан авалт</h2>
        <DemoDataBadge />
      </div>

      <Card>
        <DataTable
          data={DEMO_PURCHASE_QUEUE}
          columns={columns}
          getRowId={(r) => r.id}
          emptyTitle="Худалдан авах материал алга"
          emptyDescription="Захирлын баталгаа авсны дараа дутуу материал энд ирнэ"
        />
      </Card>
    </div>
  );
}
