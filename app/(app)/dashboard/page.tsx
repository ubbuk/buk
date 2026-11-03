"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Clock,
  ListChecks,
  Receipt,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { IndustrialCommandCenter } from "@/components/dashboard/IndustrialCommandCenter";
import { selectKpis, useRequestStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { MaterialCatalogEntry, MaterialRequestView } from "@/lib/types";

// Heavy (three.js) -- dynamically imported with no SSR, and only ever
// *mounted* (see useIsDesktopViewport below) on desktop, so mobile never
// downloads the chunk or the GLB model.
const Industrial3DViewer = dynamic(() => import("@/components/dashboard/Industrial3DViewer"), { ssr: false });

const LOW_STOCK_THRESHOLD = 5;
const CRITICAL_STOCK_THRESHOLD = 2;

interface CompactKpi {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: "neutral" | "accent" | "success" | "warning" | "danger";
}

const TONE_CLASSES: Record<CompactKpi["tone"], string> = {
  neutral: "bg-bg-elevated text-text-muted",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
};

function CompactKpiTile({ label, value, icon: Icon, tone }: CompactKpi) {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-3">
      <div className={`flex size-7 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}>
        <Icon className="size-3.5" />
      </div>
      <p className="mt-2 text-xl font-semibold leading-none text-text">{value}</p>
      <p className="mt-1 truncate text-[11px] text-text-muted">{label}</p>
    </div>
  );
}

// Mounting a dynamic-import()'d R3F Canvas inside a `hidden md:block` element
// still fetches the chunk + GLB on mobile (CSS alone doesn't stop React from
// rendering it) -- this hook gates that at the JS level instead.
function useIsDesktopViewport() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

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
  const { data: session } = useSession();
  const isDesktop = useIsDesktopViewport();
  const requests = useRequestStore((s) => s.requests);
  const loading = useRequestStore((s) => s.requestsLoading);
  const activity = useRequestStore((s) => s.activity);
  const kpis = selectKpis(requests);
  const [materials, setMaterials] = useState<MaterialCatalogEntry[]>([]);

  useEffect(() => {
    fetch("/api/materials")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: MaterialCatalogEntry[]) => setMaterials(data))
      .catch(() => setMaterials([]));
  }, []);

  const lowStockAlerts = materials
    .filter((m) => m.warehouseBalance <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.warehouseBalance - b.warehouseBalance);

  const pendingApproval = requests.filter((r) =>
    ["PENDING_DEPARTMENT_APPROVAL", "PENDING_BRANCH_APPROVAL", "PENDING_FINANCE_APPROVAL", "PENDING_EXECUTIVE_APPROVAL"].includes(
      r.status
    )
  );

  return (
    <div className="space-y-6">

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-stretch">
        <IndustrialCommandCenter
          role={session?.user?.role}
          kpis={{ pendingApproval: kpis.pendingApproval, pendingAccounting: kpis.pendingAccounting }}
        />
        <div className="hidden min-w-0 flex-col gap-3 md:flex">
          {isDesktop && <Industrial3DViewer className="min-h-[220px] flex-1" />}
          <div className="grid grid-cols-3 gap-2.5">
            <CompactKpiTile label="Нийт захиалга" value={kpis.totalRequests} icon={ListChecks} tone="neutral" />
            <CompactKpiTile label="Батлах хүлээлттэй" value={kpis.pendingApproval} icon={Clock} tone="accent" />
            <CompactKpiTile label="Агуулахын шалгалт" value={kpis.warehouseCheck} icon={Boxes} tone="accent" />
            <CompactKpiTile label="Санхүү бүртгэл хүлээгдэж буй" value={kpis.pendingAccounting} icon={Receipt} tone="warning" />
            <CompactKpiTile label="Дууссан захиалга" value={kpis.completed} icon={CheckCircle2} tone="success" />
            <CompactKpiTile label="Хугацаа хэтэрсэн" value={kpis.overdue} icon={AlertTriangle} tone="danger" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Сүүлийн захиалгууд</CardTitle>
            <Link href="/requests" className="flex items-center gap-1 text-xs text-accent hover:underline">
              Бүгдийг харах <ArrowUpRight className="size-3" />
            </Link>
          </CardHeader>
          {loading ? (
            <SkeletonTable />
          ) : (
            <DataTable
              data={requests}
              columns={columns}
              getRowId={(r) => r.id}
              searchPlaceholder="Захиалга хайх..."
            />
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Батлах хүлээлттэй</CardTitle>
            <span className="text-xs text-text-muted">{pendingApproval.length}</span>
          </CardHeader>
          <CardBody className="space-y-3">
            {!loading && pendingApproval.length === 0 && (
              <p className="py-6 text-center text-xs text-text-muted">Батлах хүсэлт алга</p>
            )}
            {pendingApproval.map((r) => (
              <Link
                key={r.id}
                href={`/requests/${r.id}`}
                className="pending-recede focus-ring block rounded-lg border border-border bg-bg-elevated/50 p-3 hover:[animation-play-state:paused]"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Үйл ажиллагааны лог</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-4">
              {activity.map((a) => (
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
            {lowStockAlerts.length === 0 && (
              <p className="py-6 text-center text-xs text-text-muted">Нөөц хүрэлцэхгүй материал алга</p>
            )}
            {lowStockAlerts.map((m) => {
              const critical = m.warehouseBalance <= CRITICAL_STOCK_THRESHOLD;
              return (
                <div
                  key={m.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-xs ${
                    critical ? "border-danger/30 bg-danger/10 text-danger" : "border-warning/30 bg-warning/10 text-warning"
                  }`}
                >
                  <span>
                    {m.name} — агуулахад {m.warehouseBalance}
                    {m.unit} үлдсэн
                  </span>
                  <Link href={`/requests/new?material=${m.id}&urgent=1`} className="shrink-0">
                    <Button size="sm" variant={critical ? "danger" : "secondary"}>
                      <Zap className="size-3.5" />
                      Яаралтай захиалга
                    </Button>
                  </Link>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
