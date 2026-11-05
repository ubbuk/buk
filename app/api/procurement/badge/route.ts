import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getProcurementManagers } from "@/lib/procurement";
import { procurementBadgeCount } from "@/lib/procurement-workload";

export const dynamic = "force-dynamic";

// Sidebar / command bar / mobile nav counter for "Худалдан авалт": distinct requests
// with unfinished work for THIS manager (see actionableRequestIds). Only the roles that
// have the procurement page get a number; for everybody else the answer is 403, so
// the counter can never leak request data to EMPLOYEE / BOSS / other roles.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER" && session.user.role !== "ADMIN") return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });

  const managers = await getProcurementManagers();
  return NextResponse.json({ count: await procurementBadgeCount({ id: session.user.id, role: session.user.role }, managers) });
}
