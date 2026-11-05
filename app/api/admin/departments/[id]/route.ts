import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { assignDepartmentHead } from "@/lib/department-head";
import { emitBroadcast, emitUserEvent } from "@/lib/events";
import { invalidate } from "@/lib/cache";

const bodySchema = z.object({ headId: z.string().nullable() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const { id } = await params;
  const result = await assignDepartmentHead(id, parsed.data.headId, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (!result.changed) return NextResponse.json({ id: result.id, headId: result.headId, reassignedRequests: 0 });

  invalidate("departments:list");

  // Admin edits change what other open sessions show (user lists, department
  // heads, approvers) -- tell them to refetch instead of waiting for a reload.
  emitBroadcast({ type: "data-changed" });
  if (result.reassignedRequests > 0) {
    emitBroadcast({ type: "request-changed" });
    if (result.headId) emitUserEvent(result.headId, { type: "notification" });
  }
  return NextResponse.json({ id: result.id, headId: result.headId, reassignedRequests: result.reassignedRequests });
}
