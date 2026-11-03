import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const { id } = await params;
  // Admin can force a reset but can never see the PIN itself — this just
  // deletes the credential row; the user sets a brand-new PIN next time
  // they need to approve something.
  await prisma.approvalPinCredential.deleteMany({ where: { userId: id } });
  await prisma.auditLog.create({
    data: { entityType: "User", entityId: id, action: "PIN_SETUP", actorId: session.user.id },
  });

  return NextResponse.json({ ok: true });
}
