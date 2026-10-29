"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FilePlus2,
  ListChecks,
  ShoppingCart,
  Boxes,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { Button } from "@/components/ui/Button";
import { StatusBadge, DemoDataBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import {
  DEMO_ACTIVITY,
  DEMO_KPIS,
  DEMO_MATERIALS,
  DEMO_REQUESTS,
  DEMO_URGENT_ALERTS,
} from "@/lib/mock-data";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
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
    key: "requestedBy",
    header: "Үүсгэсэн",
    sortable: true,
    accessor: (r) => r.requestedBy,
    render: (r) => r.requestedBy,
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

export default function DashboardPage() {
  const pendingApproval = DEMO_REQUESTS.filter((r) =>
    ["PENDING_DEPARTMENT_APPROVAL", "PENDING_ROUTE_APPROVAL", "PENDING_DIRECTOR_APPROVAL"].includes(r.status)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-text">Өнөөдрийн тойм</h2>
            <DemoDataBadge />
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Материалын захиалга, баталгаажуулалт, худалдан авалтын явцын ерөнхий зураглал
          </p>
        </div>
        <Link href="/requests/new">
          <Button>
            <FilePlus2 className="size-4" />
            Шинэ захиалга
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Нийт захиалга" value={DEMO_KPIS.totalRequests} icon={ListChecks} tone="neutral" />
        <KpiCard label="Батлах хүлээлттэй" value={DEMO_KPIS.pendingApproval} icon={Clock} tone="accent" />
        <KpiCard label="Агуулахын шалгалт" value={DEMO_KPIS.warehouseCheck} icon={Boxes} tone="accent" />
        <KpiCard label="Худалдан авах шаардлагатай" value={DEMO_KPIS.needsProcurement} icon={ShoppingCart} tone="warning" />
        <KpiCard label="Дууссан захиалга" value={DEMO_KPIS.completed} icon={CheckCircle2} tone="success" />
        <KpiCard label="Хугацаа хэтэрсэн" value={DEMO_KPIS.overdue} icon={AlertTriangle} tone="danger" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Сүүлийн захиалгууд</CardTitle>
            <Link href="/requests" className="flex items-center gap-1 text-xs text-accent hover:underline">
              Бүгдийг харах <ArrowUpRight className="size-3" />
            </Link>
          </CardHeader>
          <DataTable
            data={DEMO_REQUESTS}
            columns={columns}
            getRowId={(r) => r.id}
            searchPlaceholder="Захиалга хайх..."
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Батлах хүлээлттэй</CardTitle>
            <span className="text-xs text-text-muted">{pendingApproval.length}</span>
          </CardHeader>
          <CardBody className="space-y-3">
            {pendingApproval.map((r) => (
              <Link
                key={r.id}
                href={`/requests/${r.id}`}
                className="focus-ring block rounded-lg border border-border bg-bg-elevated/50 p-3 transition-colors hover:border-accent/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text">№{r.requestNumber}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {r.department} · {formatCurrency(r.totalAmount)}
                </p>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Агуулахын нөөцийн тойм</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {DEMO_MATERIALS.slice(0, 6).map((m) => {
              const low = m.warehouseBalance < 10;
              return (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-text">{m.name}</p>
                    <p className="text-[11px] text-text-muted">{m.code}</p>
                  </div>
                  <span className={low ? "font-medium text-danger" : "text-text-muted"}>
                    {formatNumber(m.warehouseBalance)} {m.unit}
                  </span>
                </div>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Үйл ажиллагааны лог</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-4">
              {DEMO_ACTIVITY.map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="w-10 shrink-0 text-xs text-text-muted">{a.time}</span>
                  <span
                    className={
                      a.type === "approve"
                        ? "text-success"
                        : a.type === "reject"
                        ? "text-danger"
                        : "text-text-muted"
                    }
                  >
                    ●
                  </span>
                  <span className="text-text-muted">{a.text}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Шаардлагатай материалын анхааруулга</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {DEMO_URGENT_ALERTS.map((a) => (
              <div
                key={a.id}
                className={`rounded-lg border p-3 text-xs ${
                  a.severity === "danger"
                    ? "border-danger/30 bg-danger/10 text-danger"
                    : "border-warning/30 bg-warning/10 text-warning"
                }`}
              >
                {a.text}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
