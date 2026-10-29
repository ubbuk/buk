"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DemoDataBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { DEMO_REQUESTS } from "@/lib/mock-data";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { MaterialRequestView } from "@/lib/types";
import { DEMO_CURRENT_USER } from "@/lib/mock-session";

const myRequests = DEMO_REQUESTS.filter((r) => r.requestedBy === DEMO_CURRENT_USER.name);

const columns: DataTableColumn<MaterialRequestView>[] = [
  {
    key: "requestNumber",
    header: "Дугаар",
    sortable: true,
    accessor: (r) => r.requestNumber,
    render: (r) => <span className="font-medium text-text">№{r.requestNumber}</span>,
  },
  {
    key: "createdAt",
    header: "Огноо",
    sortable: true,
    accessor: (r) => r.createdAt,
    render: (r) => formatDate(r.createdAt),
  },
  {
    key: "itemCount",
    header: "Мөрийн тоо",
    sortable: true,
    accessor: (r) => r.itemCount,
    render: (r) => r.itemCount,
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

export default function MyRequestsPage() {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text">Миний захиалгууд</h2>
          <DemoDataBadge />
        </div>
        <Link href="/requests/new">
          <Button>
            <FilePlus2 className="size-4" />
            Шинэ захиалга
          </Button>
        </Link>
      </div>

      <Card>
        <DataTable
          data={myRequests.length > 0 ? myRequests : DEMO_REQUESTS}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/requests/${r.id}`)}
          emptyTitle="Захиалга байхгүй байна"
          emptyDescription="Шинэ захиалга үүсгэснээр энд харагдана"
        />
      </Card>
    </div>
  );
}
