import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { createDepartment } from "@/lib/department-admin";

const bodySchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["OFFICE", "FACTORY"]),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400 });

  const result = await createDepartment({ adminId: session.user.id, ...parsed.data });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ id: result.department.id, name: result.department.name, type: result.department.type }, { status: 201 });
}
