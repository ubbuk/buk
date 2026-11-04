"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Box,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Coins,
  Factory,
  Layers,
  ListChecks,
  Receipt,
  ShieldCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { IndustrialCommandCenter } from "@/components/dashboard/IndustrialCommandCenter";
import { ForkliftPreview } from "@/components/dashboard/ForkliftPreview";
import { DashPanel } from "@/components/dashboard/hud/DashPanel";
import { EmptyHologram } from "@/components/dashboard/hud/EmptyHologram";
import { selectKpis, useRequestStore } from "@/lib/store";
import { formatCurrency, formatDate, requestTitle } from "@/lib/utils";
import type { MaterialRequestView } from "@/lib/types";

// Heavy (three.js) -- dynamically imported with no SSR, and only ever
// *mounted* (see useIsDesktopViewport / useAfterFirstPaintData below) on
// desktop, once the dashboard's own data has arrived, so mobile never downloads
// the chunk or the GLB and desktop never competes with the KPI/table fetches.
// While it loads, a static snapshot of the same scene holds the space.
const loadViewer = () => import("@/components/dashboard/Industrial3DViewer");
const Industrial3DViewer = dynamic(loadViewer, {
  ssr: false,
  loading: () => <ForkliftPreview className="min-h-[220px] flex-1" />,
});

const VIEWER_MOUNT_FALLBACK_MS = 3000;

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

// `value` is null while the request list is still loading: show a pulsing dash
// rather than a misleading 0.
function CompactKpiTile({ label, value, icon: Icon, tone }: Omit<CompactKpi, "value"> & { value: number | null }) {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-3">
      <div className={`flex size-7 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}>
        <Icon className="size-3.5" />
      </div>
      {value === null ? (
        <p aria-busy className="mt-2 animate-pulse text-xl font-semibold leading-none text-text-muted">
          –
        </p>
      ) : (
        <p className="mt-2 text-xl font-semibold leading-none text-text">{value}</p>
      )}
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

// Waits until the dashboard's own data is in (or a fallback timeout fires), then
// until the browser is idle, before letting the heavy 3D viewer mount.
function useAfterFirstPaintData(dataReady: boolean) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (go) return;
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => setGo(true), { timeout: 1500 });
      } else {
        timer = setTimeout(() => setGo(true), 200);
      }
    };
    if (dataReady) start();
    const fallback = setTimeout(() => setGo(true), VIEWER_MOUNT_FALLBACK_MS);
    return () => {
      clearTimeout(fallback);
      if (timer) clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
    };
  }, [dataReady, go]);
  return go;
}

const columns: DataTableColumn<MaterialRequestView>[] = [
  {
    key: "requestNumber",
    headerIcon: <Box className="size-4" />,
    header: "Захиалсан материал",
    sortable: true,
    accessor: (r) => requestTitle(r),
    render: (r) => <span className="font-medium text-text">{requestTitle(r)}</span>,
  },
  {
    key: "department",
    headerIcon: <Factory className="size-4" />,
    header: "Цех, тасаг",
    sortable: true,
    accessor: (r) => r.department,
    render: (r) => r.department,
  },
  {
    key: "requestedBy",
    headerIcon: <User className="size-4" />,
    header: "Үүсгэсэн",
    sortable: true,
    accessor: (r) => r.requestedBy,
    render: (r) => r.requestedBy,
  },
  {
    key: "createdAt",
    headerIcon: <CalendarDays className="size-4" />,
    header: "Огноо",
    sortable: true,
    accessor: (r) => r.createdAt,
    render: (r) => formatDate(r.createdAt),
  },
  {
    key: "totalAmount",
    headerIcon: <Coins className="size-4" />,
    header: "Дүн",
    sortable: true,
    accessor: (r) => r.totalAmount,
    render: (r) => formatCurrency(r.totalAmount),
    className: "text-right",
  },
  {
    key: "status",
    headerIcon: <Activity className="size-4" />,
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
  const kpis = useMemo(() => selectKpis(requests), [requests]);
  const mountViewer = useAfterFirstPaintData(!loading);


  useEffect(() => {
    if (!isDesktop) return;
    const id =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(() => void loadViewer(), { timeout: 2000 })
        : window.setTimeout(() => void loadViewer(), 300);
    return () => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, [isDesktop]);



  const pendingApproval = useMemo(
    () =>
      requests.filter((r) =>
        ["PENDING_DEPARTMENT_APPROVAL", "PENDING_BRANCH_APPROVAL", "PENDING_FINANCE_APPROVAL", "PENDING_EXECUTIVE_APPROVAL"].includes(
          r.status
        )
      ),
    [requests]
  );
  const kpiValue = (n: number) => (loading ? null : n);

  return (
    <div className="space-y-6">

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-stretch">
        <IndustrialCommandCenter
          role={session?.user?.role}
          kpis={{ pendingApproval: kpis.pendingApproval, pendingAccounting: kpis.pendingAccounting }}
        />
        <div className="hidden min-w-0 flex-col gap-3 md:flex">
          {/* The preview is server-rendered, so the slot keeps its size from the first paint (no KPI tiles jumping down). */}
          {isDesktop && mountViewer ? (
            <Industrial3DViewer className="min-h-[220px] flex-1" />
          ) : (
            <ForkliftPreview className="min-h-[220px] flex-1" />
          )}
          <div className="grid grid-cols-3 gap-2.5">
            <CompactKpiTile label="Нийт захиалга" value={kpiValue(kpis.totalRequests)} icon={ListChecks} tone="neutral" />
            <CompactKpiTile label="Батлах хүлээлттэй" value={kpiValue(kpis.pendingApproval)} icon={Clock} tone="accent" />
            <CompactKpiTile label="Агуулахын шалгалт" value={kpiValue(kpis.warehouseCheck)} icon={Boxes} tone="accent" />
            <CompactKpiTile label="Санхүү бүртгэл хүлээгдэж буй" value={kpiValue(kpis.pendingAccounting)} icon={Receipt} tone="warning" />
            <CompactKpiTile label="Дууссан захиалга" value={kpiValue(kpis.completed)} icon={CheckCircle2} tone="success" />
            <CompactKpiTile label="Хугацаа хэтэрсэн" value={kpiValue(kpis.overdue)} icon={AlertTriangle} tone="danger" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[69fr_31fr]">
        <DashPanel
          tone="cyan"
          icon={Layers}
          title="Сүүлийн захиалгууд"
          stripes
          right={
            <Link href="/requests" className="focus-ring ml-auto flex items-center gap-1 text-[11px] font-medium text-accent hover:underline">
              Бүгдийг харах <ArrowUpRight className="size-3" />
            </Link>
          }
          className="min-h-[280px]"
        >
          {loading ? (
            <SkeletonTable />
          ) : (
            <div className="dh-table">
              <DataTable
                data={requests}
                columns={columns}
                getRowId={(r) => r.id}
                searchPlaceholder="Захиалга хайх..."
              />
            </div>
          )}
        </DashPanel>

        <DashPanel
          tone="amber"
          icon={ShieldCheck}
          title="Батлах хүлээлттэй"
          right={<span className="dh-badge">{pendingApproval.length}</span>}
          className="min-h-[280px]"
        >
          {!loading && pendingApproval.length === 0 ? (
            <EmptyHologram
              icon={ClipboardCheck}
              tone="amber"
              title="Батлах хүсэлт алга"
              description="Одоогоор батлах шаардлагатай хүсэлт байхгүй."
            />
          ) : (
            <div className="space-y-3 p-5">
              {pendingApproval.map((r) => (
                <Link
                  key={r.id}
                  href={`/requests/${r.id}`}
                  className="pending-recede focus-ring block rounded-lg border border-border bg-bg-elevated/50 p-3 hover:[animation-play-state:paused]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <span className="text-sm font-semibold text-text">{requestTitle(r)}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {r.department} · {formatCurrency(r.totalAmount)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </DashPanel>
      </div>
    </div>
  );
}
