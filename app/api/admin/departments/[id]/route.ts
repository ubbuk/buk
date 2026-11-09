import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { announce, authorizeGrant, grantFailureResponse, type GrantContext } from "@/lib/authority-grant";
import { clientIp } from "@/lib/client-ip";
import { departmentHeadError } from "@/lib/department-access";
import { assignDepartmentHead } from "@/lib/department-head";
import { prisma } from "@/lib/prisma";
import { emitBroadcast, emitUserEvent } from "@/lib/events";
import { invalidate } from "@/lib/cache";

const bodySchema = z.object({
  headId: z.string().nullable(),
  // Step-up: naming a (different) head grants approval authority (lib/authority-grant.ts)
  adminPassword: z.string().optional(),
  reason: z.string().optional(),
  confirmed: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;

  // Only naming a different head GRANTS authority; clearing the head or repeating the current one does not.
  let grant: GrantContext | undefined;
  if (parsed.data.headId) {
    const department = await prisma.department.findUnique({ where: { id }, select: { headId: true } });
    if (department && department.headId !== parsed.data.headId) {
      const candidate = await prisma.user.findUnique({ where: { id: parsed.data.headId }, select: { role: true, isActive: true } });
      const ineligible = departmentHeadError(candidate);
      if (ineligible) return NextResponse.json({ error: ineligible }, { status: 400 });
      const authorised = await authorizeGrant({
        adminId: session.user.id,
        stepUp: { adminPassword: parsed.data.adminPassword, reason: parsed.data.reason, confirmed: parsed.data.confirmed },
        kind: "DEPARTMENT_HEAD",
        targetUserId: parsed.data.headId,
        ip: clientIp(req.headers),
        checkCustody: true,
      });
      if (!authorised.ok) return grantFailureResponse(authorised);
      grant = authorised.grant;
    }
  }

  let result;
  try {
    result = await assignDepartmentHead(id, parsed.data.headId, session.user.id, grant);
  } catch (err) {
    if (!grant) throw err;
    // the record or a notification could not be written: the head was not changed
    console.error("[admin] department head grant failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Эрх олгох үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй, дахин оролдоно уу" }, { status: 500 });
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (!result.changed) return NextResponse.json({ id: result.id, headId: result.headId, reassignedRequests: 0 });

  invalidate("departments:list");
  announce(result.notified ?? []);

  // Admin edits change what other open sessions show (user lists, department
  // heads, approvers) -- tell them to refetch instead of waiting for a reload.
  emitBroadcast({ type: "data-changed" });
  if (result.reassignedRequests > 0) {
    emitBroadcast({ type: "request-changed" });
    if (result.headId) emitUserEvent(result.headId, { type: "notification" });
  }
  return NextResponse.json({ id: result.id, headId: result.headId, reassignedRequests: result.reassignedRequests });
}
