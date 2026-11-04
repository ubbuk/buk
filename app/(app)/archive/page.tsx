"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { PrintButton } from "@/components/ui/PrintButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { useRequestStore } from "@/lib/store";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
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

const APPROVED_STATUSES = ["COMPLETED", "PARTIALLY_COMPLETED", "ACCOUNTING_COMPLETED"];
const REJECTED_STATUSES = ["CANCELLED"];

const FILTERS = [
  { key: "all", label: "Бүгд", statuses: [...APPROVED_STATUSES, ...REJECTED_STATUSES] },
  { key: "approved", label: "Батлагдсан", statuses: APPROVED_STATUSES },
  { key: "rejected", label: "Цуцалсан", statuses: REJECTED_STATUSES },
] as const;

export default function ArchivePage() {
  const router = useRouter();
  const requests = useRequestStore((s) => s.requests);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const active = FILTERS.find((f) => f.key === filter)!;
  const archived = requests.filter((r) => (active.statuses as readonly string[]).includes(r.status));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Захиалгын архив</h2>
        <PrintButton />
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => {
          const count = requests.filter((r) => (f.statuses as readonly string[]).includes(r.status)).length;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "focus-ring rounded-lg border px-3 py-1.5 text-sm",
                filter === f.key ? "border-accent bg-accent/10 text-accent" : "border-border text-text-muted hover:text-text"
              )}
            >
              {f.label} <span className="text-xs opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <DataTable
          data={archived}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/requests/${r.id}`)}
          emptyTitle="Архивт захиалга алга"
        />
      </Card>
    </div>
  );
}
