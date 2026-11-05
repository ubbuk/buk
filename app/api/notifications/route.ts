import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRequestHiddenFrom, visibilitySelect } from "@/lib/request-visibility";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  // A notification's link must never lead to a request the user can't open
  // (e.g. after a department head was reassigned): drop those.
  const relatedIds = [...new Set(notifications.map((n) => n.relatedRequestId).filter((id): id is string => !!id))];
  const related = relatedIds.length
    ? await prisma.materialRequest.findMany({ where: { id: { in: relatedIds } }, select: { id: true, ...visibilitySelect } })
    : [];
  const hidden = new Set(
    related.filter((r) => isRequestHiddenFrom(r, session.user.id, session.user.role)).map((r) => r.id)
  );

  return NextResponse.json(
    notifications
      .filter((n) => !n.relatedRequestId || !hidden.has(n.relatedRequestId))
      .map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        relatedRequestId: n.relatedRequestId,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      }))
  );
}
