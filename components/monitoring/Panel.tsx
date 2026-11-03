"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { formatUBTime } from "./format";

interface PanelState {
  loading: boolean;
  fetching: boolean;
  error: string | null;
  hasData: boolean;
  updatedAt: number | null;
}

// Card with the three states every monitoring section needs: first-load
// skeleton, error (with retry; stale data stays visible underneath), and a
// dimmed body while a refresh/page change is in flight.
export function Panel({
  title,
  state,
  onRetry,
  actions,
  children,
}: {
  title: string;
  state: PanelState;
  onRetry: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-3">
          {state.updatedAt && (
            <span className="hidden text-[11px] text-text-muted sm:inline" title="Улаанбаатарын цаг">
              {formatUBTime(state.updatedAt)}
            </span>
          )}
          {actions}
        </div>
      </CardHeader>

      {state.error && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger/10 px-5 py-2.5 text-xs text-danger">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0" />
            {state.error}
            {state.hasData && " — өмнөх мэдээллийг харуулж байна"}
          </span>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw className="size-3.5" />
            Дахин оролдох
          </Button>
        </div>
      )}

      {state.loading ? (
        <SkeletonTable rows={4} cols={5} />
      ) : state.hasData ? (
        <div aria-busy={state.fetching} className={cn("transition-opacity", state.fetching && "opacity-60")}>
          {children}
        </div>
      ) : (
        !state.error && <p className="px-5 py-10 text-center text-sm text-text-muted">Мэдээлэл алга</p>
      )}
    </Card>
  );
}

export function TileSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-text-muted">
      <span>
        {from}–{to} / {total}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Өмнөх хуудас">
          <ChevronLeft className="size-3.5" />
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Дараагийн хуудас">
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export const Th = ({ children, className }: { children: ReactNode; className?: string }) => (
  <th className={cn("whitespace-nowrap px-5 py-2.5 text-left text-xs font-medium text-text-muted", className)}>{children}</th>
);
export const Td = ({ children, className, title }: { children: ReactNode; className?: string; title?: string }) => (
  <td title={title} className={cn("px-5 py-2.5 align-middle", className)}>
    {children}
  </td>
);

export function DataGrid({ head, children, empty }: { head: ReactNode; children: ReactNode; empty?: string | false }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm text-text">
        <thead className="border-b border-border bg-bg-elevated/40">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty && <p className="px-5 py-8 text-center text-sm text-text-muted">{empty}</p>}
    </div>
  );
}
