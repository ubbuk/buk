import { ShieldAlert } from "lucide-react";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { MonitoringTabs } from "@/components/monitoring/MonitoringTabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { authOptions } from "@/lib/auth";
import { canViewMonitoring } from "@/lib/monitoring/access";
import { logMonitoringDenied } from "@/lib/monitoring/audit";

export const dynamic = "force-dynamic";

// Server-side gate for every page in this section (Monitoring and Time
// Machine). The client never decides access: for a signed-in user without the
// role nothing below is rendered and the attempt is audit-logged. The data
// endpoints under /api/admin/monitoring enforce the same rule independently.
export default async function MonitoringLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session || !canViewMonitoring(session.user.role)) {
    if (session) {
      const h = await headers();
      const req = new Request("http://internal/admin/monitoring", { headers: { "x-forwarded-for": h.get("x-forwarded-for") ?? "" } });
      await logMonitoringDenied(req, session.user.id, session.user.role).catch(() => {});
    }
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Эрхгүй"
        description="Мониторингийн хуудсыг зөвхөн админ болон захирал харах боломжтой"
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-text">Хяналт, мониторинг</h2>
        <p className="mt-1 text-xs text-text-muted">Системийн идэвхжил, захиалгын урсгал, батлалтын гацаа</p>
      </div>
      <MonitoringTabs />
      {children}
    </div>
  );
}
