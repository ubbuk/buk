"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { HorizontalBarChart } from "@/components/ui/HorizontalBarChart";
import { useRequestStore } from "@/lib/store";
import { REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, type RequestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PrintButton } from "@/components/ui/PrintButton";

const toneDot: Record<string, string> = {
  neutral: "bg-text-muted",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export default function ReportsPage() {
  const requests = useRequestStore((s) => s.requests);

  // Requests with no price yet (null totalAmount) are left out of this sum
  // rather than silently counted as ₮0 — there's no honest number to add
  // for an amount that isn't known yet.
  const spendByDepartment = new Map<string, number>();
  for (const r of requests) {
    if (r.totalAmount === null) continue;
    spendByDepartment.set(r.department, (spendByDepartment.get(r.department) ?? 0) + r.totalAmount);
  }
  const departmentSpend = [...spendByDepartment.entries()]
    .map(([department, amount]) => ({ department, amount }))
    .sort((a, b) => b.amount - a.amount);

  const countByStatus = new Map<RequestStatus, number>();
  for (const r of requests) {
    countByStatus.set(r.status, (countByStatus.get(r.status) ?? 0) + 1);
  }
  const totalRequests = requests.length;
  const statusBreakdown = [...countByStatus.entries()]
    .map(([status, count]) => ({ label: REQUEST_STATUS_LABEL[status], count, tone: REQUEST_STATUS_TONE[status] }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Тайлан</h2>
        <PrintButton />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Цех, тасгаар зарцуулалт</CardTitle>
          </CardHeader>
          <CardBody>
            {departmentSpend.length === 0 ? (
              <p className="py-6 text-center text-xs text-text-muted">Захиалга алга</p>
            ) : (
              <HorizontalBarChart data={departmentSpend.map((d) => ({ label: d.department, value: d.amount }))} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Захиалгын төлөвийн хуваарилалт</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {statusBreakdown.length === 0 && <p className="py-6 text-center text-xs text-text-muted">Захиалга алга</p>}
            {statusBreakdown.map((s) => {
              const pct = totalRequests > 0 ? Math.round((s.count / totalRequests) * 100) : 0;
              return (
                <div key={s.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-text-muted">
                      <span className={cn("size-1.5 rounded-full", toneDot[s.tone])} />
                      {s.label}
                    </span>
                    <span className="font-medium text-text">
                      {s.count} <span className="text-text-muted">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-bg-elevated">
                    <div className={cn("h-full rounded-full", toneDot[s.tone])} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="text-sm text-text-muted">
          Дэлгэрэнгүй шүүлтүүртэй тайлан (огноогоор, материалаар, цехээр экспорт) дараагийн ээлжид нэмэгдэнэ.
        </CardBody>
      </Card>
    </div>
  );
}
