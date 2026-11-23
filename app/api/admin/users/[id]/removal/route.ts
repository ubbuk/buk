// GET /api/admin/users/:id/removal — what the person is responsible for and who may take each part over (read-only, ADMIN).
// The screen opens one dialog from this; the answers go to DELETE /api/admin/users/:id.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { inspectRemoval } from "@/lib/user-removal";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  const { id } = await params;
  if (id === session.user.id) return NextResponse.json({ error: "Өөрийгөө устгах боломжгүй", code: "SELF_DELETE" }, { status: 400 });
  const inspection = await inspectRemoval(id);
  if (!inspection) return NextResponse.json({ error: "Хэрэглэгч олдсонгүй" }, { status: 404 });
  return NextResponse.json(inspection, { headers: { "Cache-Control": "no-store" } });
}
