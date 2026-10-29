import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DemoDataBadge } from "@/components/ui/StatusBadge";
import { HorizontalBarChart } from "@/components/ui/HorizontalBarChart";
import { DEMO_DEPARTMENT_SPEND, DEMO_STATUS_BREAKDOWN } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const toneDot: Record<string, string> = {
  neutral: "bg-text-muted",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export default function ReportsPage() {
  const totalRequests = DEMO_STATUS_BREAKDOWN.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Тайлан</h2>
        <DemoDataBadge />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Цех, тасгаар зарцуулалт (сараар)</CardTitle>
          </CardHeader>
          <CardBody>
            <HorizontalBarChart data={DEMO_DEPARTMENT_SPEND.map((d) => ({ label: d.department, value: d.amount }))} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Захиалгын төлөвийн хуваарилалт</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {DEMO_STATUS_BREAKDOWN.map((s) => {
              const pct = Math.round((s.count / totalRequests) * 100);
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
                    <div
                      className={cn("h-full rounded-full", toneDot[s.tone])}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="text-sm text-text-muted">
          Дэлгэрэнгүй шүүлтүүртэй тайлан (огноогоор, материалаар, цехээр экспорт) Phase 6-д
          бодит өгөгдөлтэй холбогдоно.
        </CardBody>
      </Card>
    </div>
  );
}
