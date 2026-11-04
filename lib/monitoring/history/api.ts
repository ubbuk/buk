import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canViewMonitoring } from "@/lib/monitoring/access";
import { logMonitoringDenied } from "@/lib/monitoring/audit";
import { SnapshotError } from "./snapshots";

// Shared plumbing for /api/admin/time-machine/*: the same server-side gate as
// /api/admin/monitoring (ADMIN or DIRECTOR; 401 without a session, 403 -- and an
// audit entry -- for any other role). The client never decides access.

const NO_STORE = { "Cache-Control": "no-store" };
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function authorize(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: json({ error: "Нэвтрээгүй байна" }, 401) } as const;
  if (!canViewMonitoring(session.user.role)) {
    await logMonitoringDenied(req, session.user.id, session.user.role).catch(() => {});
    return { error: json({ error: "Эрхгүй үйлдэл" }, 403) } as const;
  }
  return { session } as const;
}

const MIN_AS_OF = Date.UTC(2000, 0, 1);

/** Parses an ISO timestamp; returns null when invalid or outside the supported window. */
export function parseAsOf(value: unknown, now = new Date()): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const d = new Date(value);
  const t = d.getTime();
  if (Number.isNaN(t) || t < MIN_AS_OF || t > now.getTime() + 60_000) return null;
  return d;
}

export function failure(label: string, err: unknown) {
  if (err instanceof SnapshotError) return json({ error: err.message }, err.status);
  console.error(label, err instanceof Error ? err.message : err);
  return json({ error: "Серверийн алдаа гарлаа" }, 500);
}
