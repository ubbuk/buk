"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { useRequestStore } from "@/lib/store";
import { formatCurrency, formatDate, requestTitle } from "@/lib/utils";
import type { MaterialRequestView } from "@/lib/types";
import { PrintButton } from "@/components/ui/PrintButton";

const columns: DataTableColumn<MaterialRequestView>[] = [
  {
    key: "requestNumber",
    header: "Захиалсан материал",
    sortable: true,
    accessor: (r) => requestTitle(r),
    render: (r) => <span className="font-medium text-text">{requestTitle(r)}</span>,
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
  const { data: session } = useSession();
  const requests = useRequestStore((s) => s.requests);
  const loading = useRequestStore((s) => s.requestsLoading);
  const myRequests = requests.filter((r) => r.requestedBy === session?.user?.name);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Миний захиалгууд</h2>
        <PrintButton />
      </div>
        <Link href="/requests/new">
          <Button>
            <FilePlus2 className="size-4" />
            Шинэ захиалга
          </Button>
        </Link>
      </div>

      <Card>
        {loading ? (
          <SkeletonTable />
        ) : (
          <DataTable
            data={myRequests}
            columns={columns}
            getRowId={(r) => r.id}
            onRowClick={(r) => router.push(`/requests/${r.id}`)}
            emptyTitle="Захиалга байхгүй байна"
            emptyDescription="Шинэ захиалга үүсгэснээр энд харагдана"
          />
        )}
      </Card>
    </div>
  );
}
