import { prisma } from "@/lib/prisma";

const DENIED_DEDUPE_MS = 60_000;

function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

// Page/API access is recorded once per page load by the client (POST ".../view"),
// not on every 30-second refresh, so the audit trail stays readable.
export async function logMonitoringView(req: Request, actorId: string) {
  await prisma.auditLog.create({
    data: { entityType: "Monitoring", entityId: "view", action: "VIEW_MONITORING", actorId, ipAddress: clientIp(req) },
  });
}

// An authenticated user without the role tried to reach monitoring. De-duplicated
// per actor so repeated polling by a forbidden client cannot flood the log.
export async function logMonitoringDenied(req: Request, actorId: string, role: string) {
  const recent = await prisma.auditLog.findFirst({
    where: {
      actorId,
      action: "MONITORING_ACCESS_DENIED",
      createdAt: { gte: new Date(Date.now() - DENIED_DEDUPE_MS) },
    },
    select: { id: true },
  });
  if (recent) return;
  await prisma.auditLog.create({
    data: {
      entityType: "Monitoring",
      entityId: "denied",
      action: "MONITORING_ACCESS_DENIED",
      actorId,
      afterJson: JSON.stringify({ role }),
      ipAddress: clientIp(req),
    },
  });
}
